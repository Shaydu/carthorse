import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
import { runGapMidpointBridging } from '../gap-midpoint-bridging';
import { runTrailLevelBridging } from '../trail-level-bridging';
import { runPostNodingSnap } from '../post-noding-snap';
import { runConnectorEdgeSpanning } from '../connector-edge-spanning';
import { runPostNodingVertexMerge } from '../post-noding-merge';
import { runConnectorEdgeCollapse } from '../connector-edge-collapse';
import { getPgRoutingTolerances } from '../../../config-loader';

export class PostgisNodeStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    const diagUnsplit = process.env.DIAG_UNSPLIT_X === '1';
    try {
      console.log('🔄 Using PostGIS ST_Node pipeline to split at at-grade crossings...');

      // Prepare 2D, valid, simple input
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_2d`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_2d AS
        SELECT id AS old_id, ST_Force2D(the_geom) AS geom, app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${stagingSchema}.ways
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
      `);

      if (diagUnsplit) {
        console.log('🔎 Diagnosing unsplit X crossings (pre-noding)...');
        const diag = await pgClient.query(`
          WITH pairs AS (
            SELECT a.old_id AS a_id, b.old_id AS b_id,
                   ST_Crosses(a.geom, b.geom) AS crosses,
                   ST_Touches(a.geom, b.geom) AS touches
            FROM ${stagingSchema}.ways_2d a
            JOIN ${stagingSchema}.ways_2d b ON a.old_id < b.old_id
          )
          SELECT COUNT(*)::int AS unsplit_count FROM pairs WHERE crosses AND NOT touches
        `);
        console.log(`🧭 Unsplit crossings before ST_Node: ${diag.rows[0].unsplit_count}`);
      }

      // Node per feature; carry attributes through without global dissolve
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails_noded`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.split_trails_noded AS
        SELECT 
          row_number() OVER () AS id,
          seg.geom::geometry(LINESTRING,4326) AS the_geom,
          w.old_id,
          w.app_uuid,
          w.name,
          ST_Length(seg.geom::geography)/1000.0 AS length_km,
          w.elevation_gain,
          w.elevation_loss
        FROM ${stagingSchema}.ways_2d w
        CROSS JOIN LATERAL (
          SELECT (ST_Dump(ST_Node(w.geom))).geom AS geom
        ) AS seg
        WHERE GeometryType(seg.geom) = 'LINESTRING' AND ST_NumPoints(seg.geom) > 1
      `);

      // Build routing tables
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT row_number() OVER () AS id, old_id, 1 AS sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${stagingSchema}.split_trails_noded
        WHERE the_geom IS NOT NULL AND ST_NumPoints(the_geom) > 1
      `);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);

      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          row_number() OVER () AS id,
          geom AS the_geom,
          0::int AS cnt,
          0::int AS chk,
          0::int AS ein,
          0::int AS eout
        FROM (
          SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
          UNION
          SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_noded
        ) pts
      `);

      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer`);
      // Assign nearest vertex IDs to every edge endpoint (robust to tiny numeric differences)
      await pgClient.query(`
        WITH start_nearest AS (
          SELECT wn.id AS edge_id,
                 (
                   SELECT v.id
                   FROM ${stagingSchema}.ways_noded_vertices_pgr v
                   ORDER BY ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) ASC
                   LIMIT 1
                 ) AS node_id
          FROM ${stagingSchema}.ways_noded wn
        ),
        end_nearest AS (
          SELECT wn.id AS edge_id,
                 (
                   SELECT v.id
                   FROM ${stagingSchema}.ways_noded_vertices_pgr v
                   ORDER BY ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) ASC
                   LIMIT 1
                 ) AS node_id
          FROM ${stagingSchema}.ways_noded wn
        )
        UPDATE ${stagingSchema}.ways_noded wn
        SET source = sn.node_id,
            target = en.node_id
        FROM start_nearest sn
        JOIN end_nearest en ON en.edge_id = sn.edge_id
        WHERE wn.id = sn.edge_id
      `);

      // Trail-level bridging: add connector trail rows so downstream structures span gaps
      try {
        const tolerances = getPgRoutingTolerances();
        const tolMeters = typeof tolerances?.trueLoopTolerance === 'number'
          ? Math.max(1, Math.min(100, tolerances.trueLoopTolerance))
          : 20; // fallback to 20m
        const tlb = await runTrailLevelBridging(pgClient, stagingSchema, tolMeters);
        if (tlb.connectorsInserted > 0) {
          console.log(`🧵 Trail-level connectors inserted: ${tlb.connectorsInserted}`);
          // Rebuild ways_2d and downstream since trails changed
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_2d`);
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails_noded`);
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded`);
          // Recreate ways_2d from updated trails
          await pgClient.query(`
            CREATE TABLE ${stagingSchema}.ways_2d AS
            SELECT id AS old_id, ST_Force2D(geometry) AS geom, app_uuid, name,
                   length_km, 0.0::double precision AS elevation_gain, 0.0::double precision AS elevation_loss
            FROM ${stagingSchema}.trails
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
          `);
          // Re-run noding pipeline from this point
          await pgClient.query(`
            CREATE TABLE ${stagingSchema}.split_trails_noded AS
            SELECT row_number() OVER () AS id,
                   (ST_Dump(ST_Node(ST_UnaryUnion(ST_Collect(geom))))).geom::geometry(LINESTRING,4326) AS the_geom
            FROM ${stagingSchema}.ways_2d
          `);
          await pgClient.query(`
            ALTER TABLE ${stagingSchema}.split_trails_noded ADD COLUMN old_id bigint, ADD COLUMN app_uuid text, ADD COLUMN name text,
              ADD COLUMN length_km double precision, ADD COLUMN elevation_gain double precision, ADD COLUMN elevation_loss double precision;
          `);
          await pgClient.query(`
            UPDATE ${stagingSchema}.split_trails_noded n
            SET old_id = w.old_id,
                app_uuid = w.app_uuid,
                name = w.name,
                length_km = ST_Length(n.the_geom::geography)/1000.0,
                elevation_gain = w.elevation_gain,
                elevation_loss = w.elevation_loss
            FROM ${stagingSchema}.ways_2d w
            WHERE ST_Intersects(n.the_geom, w.geom)
          `);
          await pgClient.query(`
            CREATE TABLE ${stagingSchema}.ways_noded AS
            SELECT row_number() OVER () AS id, old_id, 1 AS sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss
            FROM ${stagingSchema}.split_trails_noded
            WHERE the_geom IS NOT NULL AND ST_NumPoints(the_geom) > 1
          `);
          await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);
          await pgClient.query(`
            CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
            SELECT DISTINCT
              row_number() OVER () AS id,
              pt AS the_geom,
              0::int AS cnt,
              0::int AS chk,
              0::int AS ein,
              0::int AS eout
            FROM (
              SELECT ST_StartPoint(the_geom) AS pt FROM ${stagingSchema}.ways_noded
              UNION ALL
              SELECT ST_EndPoint(the_geom) AS pt FROM ${stagingSchema}.ways_noded
            ) s
          `);
          await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer`);
          // Assign nearest vertices for start/endpoints (robust to tiny coordinate differences)
          await pgClient.query(`
            WITH start_nearest AS (
              SELECT wn.id AS edge_id,
                     (
                       SELECT v.id
                       FROM ${stagingSchema}.ways_noded_vertices_pgr v
                       ORDER BY ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) ASC
                       LIMIT 1
                     ) AS node_id
              FROM ${stagingSchema}.ways_noded wn
            ),
            end_nearest AS (
              SELECT wn.id AS edge_id,
                     (
                       SELECT v.id
                       FROM ${stagingSchema}.ways_noded_vertices_pgr v
                       ORDER BY ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) ASC
                       LIMIT 1
                     ) AS node_id
              FROM ${stagingSchema}.ways_noded wn
            )
            UPDATE ${stagingSchema}.ways_noded wn
            SET source = sn.node_id,
                target = en.node_id
            FROM start_nearest sn
            JOIN end_nearest en ON en.edge_id = sn.edge_id
            WHERE wn.id = sn.edge_id
          `);
        }
        const { midpointsInserted, edgesInserted } = await runGapMidpointBridging(pgClient, stagingSchema, tolMeters);
        if (midpointsInserted > 0 || edgesInserted > 0) {
          console.log(`🔗 Midpoint gap-bridging: vertices=${midpointsInserted}, edges=${edgesInserted}`);
        } else {
          console.log('🔗 Midpoint gap-bridging: no gaps within tolerance');
        }
      } catch (e) {
        console.warn('⚠️ Midpoint gap-bridging step skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Post-noding snap to ensure connectors align with vertices
      try {
        const tolerances = getPgRoutingTolerances();
        const constants: any = (await import('../../../config-loader')).getConstants();
        const bridgingCfg = (constants && (constants as any).bridging) || { toleranceMeters: 20 };
        const tolMeters = Number(bridgingCfg.toleranceMeters || 20);
        const snapRes = await runPostNodingSnap(pgClient, stagingSchema, tolMeters);
        console.log(`🔧 Post-noding snap: start=${snapRes.snappedStart}, end=${snapRes.snappedEnd}`);

        // Ensure an explicit connector-spanning edge exists between nearest vertices
        const spanRes = await runConnectorEdgeSpanning(pgClient, stagingSchema, tolMeters);
        console.log(`🧵 Connector edge spanning: matched=${spanRes.matched}, inserted=${spanRes.inserted}`);

        // Merge vertices within tolerance to ensure edges share a single vertex id
        const mergeRes = await runPostNodingVertexMerge(pgClient, stagingSchema, tolMeters);
        console.log(`🧩 Vertex merge: merged=${mergeRes.mergedVertices}, srcRemap=${mergeRes.remappedSources}, tgtRemap=${mergeRes.remappedTargets}, deletedOrphans=${mergeRes.deletedOrphans}`);

        // Collapse connectors by spanning them with neighboring edges and removing the standalone connector edge
        const collapseRes = await runConnectorEdgeCollapse(pgClient, stagingSchema);
        console.log(`🧵 Connector collapse: collapsed=${collapseRes.collapsed}, deleted=${collapseRes.deletedConnectors}`);
      } catch (e) {
        console.warn('⚠️ Post-noding snap step skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Stats
      const edges = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
      const nodes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded_vertices_pgr`);

      if (diagUnsplit) {
        const postDiag = await pgClient.query(`
          WITH pairs AS (
            SELECT a.id AS a_id, b.id AS b_id,
                   ST_Crosses(a.the_geom, b.the_geom) AS crosses,
                   ST_Touches(a.the_geom, b.the_geom) AS touches
            FROM ${stagingSchema}.ways_noded a
            JOIN ${stagingSchema}.ways_noded b ON a.id < b.id
          )
          SELECT COUNT(*)::int AS remaining_unsplit FROM pairs WHERE crosses AND NOT touches
        `);
        console.log(`🧭 Unsplit crossings after ST_Node: ${postDiag.rows[0].remaining_unsplit}`);
      }

      return {
        success: true,
        stats: {
          nodesCreated: nodes.rows[0].c,
          edgesCreated: edges.rows[0].c,
          isolatedNodes: 0,
          orphanedEdges: 0
        }
      };
    } catch (error) {
      console.error('❌ PostGIS noding failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error), stats: { nodesCreated: 0, edgesCreated: 0, isolatedNodes: 0, orphanedEdges: 0 } };
    }
  }
}


