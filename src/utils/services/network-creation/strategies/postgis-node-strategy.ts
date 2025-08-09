import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

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

      // Node the network at all at-grade intersections
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails_noded`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.split_trails_noded AS
        SELECT row_number() OVER () AS id,
               (ST_Dump(ST_Node(ST_UnaryUnion(ST_Collect(geom))))).geom::geometry(LINESTRING,4326) AS the_geom
        FROM ${stagingSchema}.ways_2d
      `);

      // Attribute join: map back to nearest original way by intersection
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
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded wn
        SET source = v1.id, target = v2.id
        FROM ${stagingSchema}.ways_noded_vertices_pgr v1, ${stagingSchema}.ways_noded_vertices_pgr v2
        WHERE ST_Equals(ST_StartPoint(wn.the_geom), v1.the_geom) AND ST_Equals(ST_EndPoint(wn.the_geom), v2.the_geom)
      `);

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


