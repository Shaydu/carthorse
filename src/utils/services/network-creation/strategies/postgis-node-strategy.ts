import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
import { runGapMidpointBridging } from '../gap-midpoint-bridging';
import { runTrailLevelBridging } from '../trail-level-bridging';
import { runPostNodingSnap } from '../post-noding-snap';
import { runConnectorEdgeSpanning } from '../connector-edge-spanning';
import { runPostNodingVertexMerge } from '../post-noding-merge';
import { runConnectorEdgeCollapse } from '../connector-edge-collapse';
import { getPgRoutingTolerances, getConstants, getBridgingConfig, getRouteGenerationFlags } from '../../../config-loader';
import { runEdgeCompaction } from '../edge-compaction';

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
          ST_Force2D(geom)::geometry(Point,4326) AS the_geom,
          0::int AS cnt,
          0::int AS chk,
          0::int AS ein,
          0::int AS eout
        FROM (
          SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
          UNION ALL
          SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_noded
        ) pts
      `);

      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer`);
      // Assign nearest vertex IDs to every edge endpoint (robust to tiny numeric differences)
      // Build nearest start/end vertex maps using temp tables (avoid WITH-UPDATE syntax issues)
      await pgClient.query(`DROP TABLE IF EXISTS tmp_start_nearest`);
      await pgClient.query(`CREATE TEMP TABLE tmp_start_nearest AS
        SELECT wn.id AS edge_id,
               (
                 SELECT v.id
                 FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 ORDER BY ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) ASC
                 LIMIT 1
               ) AS node_id
        FROM ${stagingSchema}.ways_noded wn`);
      await pgClient.query(`DROP TABLE IF EXISTS tmp_end_nearest`);
      await pgClient.query(`CREATE TEMP TABLE tmp_end_nearest AS
        SELECT wn.id AS edge_id,
               (
                 SELECT v.id
                 FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 ORDER BY ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) ASC
                 LIMIT 1
               ) AS node_id
        FROM ${stagingSchema}.ways_noded wn`);
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded wn
        SET source = sn.node_id,
            target = en.node_id
        FROM tmp_start_nearest sn
        JOIN tmp_end_nearest en ON en.edge_id = sn.edge_id
        WHERE wn.id = sn.edge_id
      `);

      // Remove degenerate/self-loop/invalid edges before proceeding
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE the_geom IS NULL OR ST_NumPoints(the_geom) < 2 OR ST_Length(the_geom) = 0`);
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE source IS NULL OR target IS NULL OR source = target`);

      // Recompute node degree after cleanup
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);

      // Recompute node degree (cnt) to ensure accuracy before contraction
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);

      // Harden 2D everywhere prior to snapping/welding
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Force2D(the_geom)`);
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr SET the_geom = ST_Force2D(the_geom)`);

      // (Old complex chain-walk removed in favor of final greedy spanning below)

      // Trail-level bridging: defaults from config, env can override
      try {
        const bridgingCfg = getBridgingConfig();
        const tolMeters = Number(bridgingCfg.trailBridgingToleranceMeters);
        // Use trail bridging if enabled in config
        const tlb = await runTrailLevelBridging(pgClient, stagingSchema, getBridgingConfig().trailBridgingToleranceMeters);
        if (tlb.connectorsInserted > 0) {
          console.log(`🧵 Trail-level connectors inserted: ${tlb.connectorsInserted}`);
          // Rebuild ways_2d and downstream since trails changed
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_2d`);
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails_noded`);
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded`);
          // Preserve 3D trail geometries in staging.trails; keep derived edges/nodes strictly 2D
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
          // Re-enforce 2D before subsequent operations
          await pgClient.query(`UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Force2D(the_geom)`);
          await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr SET the_geom = ST_Force2D(the_geom)`);
        }
        const { midpointsInserted, edgesInserted } = await runGapMidpointBridging(pgClient, stagingSchema, Number(getBridgingConfig().trailBridgingToleranceMeters));
        if (midpointsInserted > 0 || edgesInserted > 0) {
          console.log(`🔗 Midpoint gap-bridging: vertices=${midpointsInserted}, edges=${edgesInserted}`);
        } else {
          console.log('🔗 Midpoint gap-bridging: no gaps within tolerance');
        }
      } catch (e) {
        console.warn('⚠️ Midpoint gap-bridging step skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Post-noding snap to ensure connectors align with vertices (defaults from config)
      try {
        const bridgingCfg = getBridgingConfig();
        // Use edge snap/weld tolerance (meters) for post-noding snap/merge/spanning steps
        const tolMeters = Number(bridgingCfg.edgeSnapToleranceMeters);
        const snapRes = await runPostNodingSnap(pgClient, stagingSchema, tolMeters);
        console.log(`🔧 Post-noding snap: start=${snapRes.snappedStart}, end=${snapRes.snappedEnd}`);

        // Ensure an explicit connector-spanning edge exists between nearest vertices
        const spanRes = await runConnectorEdgeSpanning(pgClient, stagingSchema, tolMeters);
        console.log(`🧵 Connector edge spanning: matched=${spanRes.matched}, inserted=${spanRes.inserted}`);

        // Topological vertex clustering/merge (in-session) to ensure shared vertex ids
        const epsDeg = Number(getBridgingConfig().edgeSnapToleranceMeters) / 111320.0;
        await pgClient.query(`DROP TABLE IF EXISTS "__vertex_clusters"`);
        await pgClient.query(`CREATE TEMP TABLE "__vertex_clusters" AS
          SELECT id AS vertex_id,
                 ST_ClusterDBSCAN(the_geom, eps := $1, minpts := 1) OVER () AS cluster_id
          FROM ${stagingSchema}.ways_noded_vertices_pgr`, [epsDeg]);

        await pgClient.query(`DROP TABLE IF EXISTS "__vertex_cluster_reps"`);
        await pgClient.query(`CREATE TEMP TABLE "__vertex_cluster_reps" AS
          SELECT c.cluster_id,
                 MIN(c.vertex_id) AS rep_id,
                 ST_Force2D(ST_Centroid(ST_Collect(v.the_geom)))::geometry(Point,4326) AS rep_geom
          FROM "__vertex_clusters" c
          JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON v.id = c.vertex_id
          GROUP BY c.cluster_id`);

        // Update representative vertex geometry
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
          SET the_geom = r.rep_geom
          FROM "__vertex_cluster_reps" r
          JOIN "__vertex_clusters" c ON c.cluster_id = r.cluster_id AND v.id = r.rep_id`);

        // Remap edges' source/target to representative ids
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded e
          SET source = r.rep_id
          FROM "__vertex_clusters" c
          JOIN "__vertex_cluster_reps" r ON r.cluster_id = c.cluster_id
          WHERE e.source = c.vertex_id AND e.source <> r.rep_id`);
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded e
          SET target = r.rep_id
          FROM "__vertex_clusters" c
          JOIN "__vertex_cluster_reps" r ON r.cluster_id = c.cluster_id
          WHERE e.target = c.vertex_id AND e.target <> r.rep_id`);

        // Recompute cnt after merge
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
          SET cnt = (
            SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
            WHERE e.source = v.id OR e.target = v.id
          )`);

        // Collapse connectors by spanning them with neighboring edges and removing the standalone connector edge
        const collapseRes = await runConnectorEdgeCollapse(pgClient, stagingSchema);
        console.log(`🧵 Connector collapse: collapsed=${collapseRes.collapsed}, deleted=${collapseRes.deletedConnectors}`);

      // Edge compaction: merge degree-2 chains into long edges to maximize edge length
      const compactRes = await runEdgeCompaction(pgClient, stagingSchema);
      console.log(`🧱 Edge compaction: chains=${compactRes.chainsCreated}, compacted=${compactRes.edgesCompacted}, remaining=${compactRes.edgesRemaining}, finalEdges=${compactRes.finalEdges}`);
      } catch (e) {
        console.warn('⚠️ Post-noding snap step skipped due to error:', e instanceof Error ? e.message : e);
      }

      // FINAL: Greedy decision-to-decision spanning using PostGIS only (no renames)
      console.log('🔗 Final topological spanning (pgr_contraction)...');
      // Snap edge endpoints to nearest vertex union within configured tolerance (2D)
      try {
        const spanCfg = getBridgingConfig();
        if (!spanCfg.edgeBridgingEnabled) {
          console.log('ℹ️ Edge snap/weld disabled by config');
        }
        const spanTolMeters = Number(spanCfg.edgeSnapToleranceMeters);
        const spanTolDegrees = spanTolMeters / 111320.0;
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Force2D(the_geom)`);
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr SET the_geom = ST_Force2D(the_geom)`);
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Snap(
              the_geom,
              (SELECT ST_UnaryUnion(ST_Collect(the_geom)) FROM ${stagingSchema}.ways_noded_vertices_pgr),
              $1
           )`,
          [spanTolDegrees]
        );
      } catch (e) {
        console.warn('⚠️ Span-time snap skipped due to error:', e instanceof Error ? e.message : e);
      }
      // Run contraction (degree-2 collapse)
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.contracted_graph`);
      await pgClient.query(`CREATE TABLE ${stagingSchema}.contracted_graph AS
        SELECT * FROM pgr_contraction(
          $$SELECT id, source, target, length_km AS cost FROM ${stagingSchema}.ways_noded$$::text,
          ARRAY(SELECT id::bigint FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt = 2),
          0,
          ARRAY[]::bigint[],
          false
        )`);

      // Expand contracted path into ordered node list and pair consecutive nodes
      await pgClient.query(`DROP TABLE IF EXISTS tmp_cg_nodes`);
      await pgClient.query(`CREATE TEMP TABLE tmp_cg_nodes AS
        SELECT c.id AS cid, 0 AS ord, c.source AS node FROM ${stagingSchema}.contracted_graph c
        UNION ALL
        SELECT c.id AS cid, gs AS ord, c.contracted_vertices[gs] AS node
        FROM ${stagingSchema}.contracted_graph c, generate_subscripts(c.contracted_vertices, 1) AS gs
        UNION ALL
        SELECT c.id AS cid, COALESCE(array_length(c.contracted_vertices, 1), 0) + 1 AS ord, c.target AS node
        FROM ${stagingSchema}.contracted_graph c`);

      await pgClient.query(`DROP TABLE IF EXISTS tmp_cg_pairs`);
      await pgClient.query(`CREATE TEMP TABLE tmp_cg_pairs AS
        SELECT cid, node AS a, LEAD(node) OVER (PARTITION BY cid ORDER BY ord) AS b, ord
        FROM tmp_cg_nodes`);

      // Build spanned edges from original edges between node pairs
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_spanned_tmp`);
      await pgClient.query(`CREATE TABLE ${stagingSchema}.ways_spanned_tmp AS
        SELECT ROW_NUMBER() OVER () AS id,
               c.source,
               c.target,
               ST_LineMerge(ST_Collect(e.the_geom ORDER BY p.ord)) AS the_geom
        FROM ${stagingSchema}.contracted_graph c
        JOIN tmp_cg_pairs p ON p.cid = c.id
        JOIN ${stagingSchema}.ways_noded e
          ON (e.source = p.a AND e.target = p.b) OR (e.source = p.b AND e.target = p.a)
        WHERE p.b IS NOT NULL
        GROUP BY c.id, c.source, c.target`);

      // Rebuild vertices from start/end points
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      await pgClient.query(`CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT row_number() OVER () AS id, geom AS the_geom, 0::int AS cnt, 0::int AS chk, 0::int AS ein, 0::int AS eout
        FROM (
          SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_spanned_tmp
          UNION ALL
          SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_spanned_tmp
        ) pts`);

      // Map source/target by nearest vertex (robust to tiny numeric diffs)
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_spanned_tmp ADD COLUMN IF NOT EXISTS source int`);
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_spanned_tmp ADD COLUMN IF NOT EXISTS target int`);
      await pgClient.query(`DROP TABLE IF EXISTS tmp_start_map`);
      await pgClient.query(`CREATE TEMP TABLE tmp_start_map AS
        SELECT w.id AS edge_id,
               (
                 SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 ORDER BY ST_Distance(v.the_geom, ST_StartPoint(w.the_geom)) ASC
                 LIMIT 1
               ) AS node_id
        FROM ${stagingSchema}.ways_spanned_tmp w`);
      await pgClient.query(`DROP TABLE IF EXISTS tmp_end_map`);
      await pgClient.query(`CREATE TEMP TABLE tmp_end_map AS
        SELECT w.id AS edge_id,
               (
                 SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 ORDER BY ST_Distance(v.the_geom, ST_EndPoint(w.the_geom)) ASC
                 LIMIT 1
               ) AS node_id
        FROM ${stagingSchema}.ways_spanned_tmp w`);
      await pgClient.query(`UPDATE ${stagingSchema}.ways_spanned_tmp w
        SET source = s.node_id, target = t.node_id
        FROM tmp_start_map s JOIN tmp_end_map t ON t.edge_id = s.edge_id
        WHERE w.id = s.edge_id`);

      // Recompute cnt on the new vertices
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_spanned_tmp e
          WHERE e.source = v.id OR e.target = v.id
        )`);

      // Replace contents of ways_noded in-place, but only if spanning produced edges
      const preEdgeCountRes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
      const contractedCountRes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.contracted_graph`);
      const spannedCountRes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_spanned_tmp`);
      const preEdgeCount = preEdgeCountRes.rows[0]?.c ?? 0;
      const contractedCount = contractedCountRes.rows[0]?.c ?? 0;
      const spannedCount = spannedCountRes.rows[0]?.c ?? 0;
      console.log(`📊 Spanning summary: preEdges=${preEdgeCount}, contractedRows=${contractedCount}, spannedEdges=${spannedCount}`);

      if (spannedCount === 0) {
        console.warn(`⚠️ Topological spanning produced 0 edges (preEdges=${preEdgeCount}, contractedRows=${contractedCount}). Retaining pre-spanned network.`);

        // Rebuild vertices from existing ways_noded and remap sources/targets to ensure routability
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
        await pgClient.query(`CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
          SELECT row_number() OVER () AS id,
                 geom AS the_geom,
                 0::int AS cnt,
                 0::int AS chk,
                 0::int AS ein,
                 0::int AS eout
          FROM (
            SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
            UNION ALL
            SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_noded
          ) pts`);
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Force2D(the_geom)`);
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr SET the_geom = ST_Force2D(the_geom)`);

        // Remap to nearest vertex ids (robust to tiny numeric differences)
        await pgClient.query(`DROP TABLE IF EXISTS tmp_start_map_prespan`);
        await pgClient.query(`CREATE TEMP TABLE tmp_start_map_prespan AS
          SELECT w.id AS edge_id,
                 (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v
                  ORDER BY ST_Distance(v.the_geom, ST_StartPoint(w.the_geom)) ASC LIMIT 1) AS node_id
          FROM ${stagingSchema}.ways_noded w`);
        await pgClient.query(`DROP TABLE IF EXISTS tmp_end_map_prespan`);
        await pgClient.query(`CREATE TEMP TABLE tmp_end_map_prespan AS
          SELECT w.id AS edge_id,
                 (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v
                  ORDER BY ST_Distance(v.the_geom, ST_EndPoint(w.the_geom)) ASC LIMIT 1) AS node_id
          FROM ${stagingSchema}.ways_noded w`);
        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded w
          SET source = s.node_id, target = t.node_id
          FROM tmp_start_map_prespan s JOIN tmp_end_map_prespan t ON t.edge_id = s.edge_id
          WHERE w.id = s.edge_id`);

        // Cleanup degenerate edges again after remap
        await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE the_geom IS NULL OR ST_NumPoints(the_geom) < 2 OR ST_Length(the_geom) = 0`);
        await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE source IS NULL OR target IS NULL OR source = target`);

        await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
          SET cnt = (
            SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
            WHERE e.source = v.id OR e.target = v.id
          )`);

        // Final counts and return
        const edges = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
        const nodes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded_vertices_pgr`);
        return {
          success: true,
          stats: {
            nodesCreated: nodes.rows[0].c,
            edgesCreated: edges.rows[0].c,
            isolatedNodes: 0,
            orphanedEdges: 0
          }
        };
      }

      await pgClient.query(`TRUNCATE ${stagingSchema}.ways_noded`);
      await pgClient.query(`INSERT INTO ${stagingSchema}.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
        SELECT row_number() OVER () AS id,
               NULL::bigint,
               1,
               the_geom,
               NULL::text,
               NULL::text,
               ST_Length(the_geom::geography)/1000.0,
               0.0::double precision,
               0.0::double precision,
               source,
               target
        FROM ${stagingSchema}.ways_spanned_tmp`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);

      // Edge coverage verification: ensure every staged trail is covered by the spanned edges
      try {
        const verifyCfg = getBridgingConfig();
        const meters = Number(verifyCfg.edgeSnapToleranceMeters);
        const minGapMeters = Math.max(0.5, meters * 0.1);
        const verification = await pgClient.query(
          `SELECT COUNT(*)::int AS gaps
           FROM ${stagingSchema}.trails t
           WHERE ST_Length(
             ST_Difference(
               ST_Force2D(t.geometry),
               (SELECT ST_UnaryUnion(ST_Collect(the_geom)) FROM ${stagingSchema}.ways_noded)
             )::geography
           ) > $1`,
          [minGapMeters]
        );
        const gaps = verification.rows?.[0]?.gaps ?? 0;
        if (gaps > 0) {
          throw new Error(`Edge coverage verification failed: ${gaps} trail geometries have uncovered segments > ${minGapMeters}m`);
        }
        console.log('✅ Edge coverage verification passed (all trails covered by spanned edges)');
      } catch (e) {
        console.error('❌ Edge coverage verification failed:', e instanceof Error ? e.message : e);
        throw e;
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


