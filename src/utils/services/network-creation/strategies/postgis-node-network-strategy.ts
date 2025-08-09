import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

/**
 * PostGIS-based network creation strategy.
 *
 * - Uses native PostGIS to split a combined network at all intersections via ST_Node(ST_Collect(...)).
 * - Builds pgRouting topology with pgr_createTopology to assign source/target.
 * - Leaves trails 3D in upstream tables, but enforces 2D for edges per pgRouting requirements.
 * - Keeps pgRouting domain integer IDs only.
 */
export class PostgisNodeNetworkStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema, tolerances } = config;

    try {
      // Clean previous artifacts
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded CASCADE`);
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr CASCADE`);

      // Prepare 2D clean copy from ways (which the orchestrator already materializes)
      await pgClient.query(`
        CREATE TEMP TABLE _ways_2d AS
        SELECT 
          id, 
          ST_Force2D(
            ST_LineMerge(
              ST_CollectionHomogenize(
                ST_MakeValid(the_geom)
              )
            )
          ) AS geom,
          app_uuid,
          name,
          length_km,
          elevation_gain,
          elevation_loss
        FROM ${stagingSchema}.ways
        WHERE the_geom IS NOT NULL
      `);

      // Optional light snap to grid to reduce near-coincident duplicates
      await pgClient.query(`
        UPDATE _ways_2d
        SET geom = ST_SnapToGrid(geom, 0.000009)
      `);

      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx__ways_2d_geom ON _ways_2d USING GIST(geom)`);

      // Node the network using PostGIS only, then associate back to original metadata via spatial join
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        WITH noded AS (
          SELECT (ST_Dump(ST_Node(ST_Collect(geom)))).geom::geometry(LineString, 4326) AS the_geom
          FROM _ways_2d
        )
        SELECT 
          ROW_NUMBER() OVER () AS id,
          o.id AS old_id,
          1 AS sub_id,
          n.the_geom,
          o.app_uuid,
          o.name,
          o.length_km,
          o.elevation_gain,
          o.elevation_loss
        FROM noded n
        JOIN _ways_2d o
          ON ST_Intersects(n.the_geom, o.geom)
      `);

      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);

      // Create topology: ensure source/target columns exist, then assign and build vertices table
      const nodeTolDeg = tolerances.intersectionDetectionTolerance / 111000.0;
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        ADD COLUMN IF NOT EXISTS source INTEGER,
        ADD COLUMN IF NOT EXISTS target INTEGER
      `);
      await pgClient.query(`
        SELECT pgr_createTopology('${stagingSchema}.ways_noded', ${nodeTolDeg}, 'the_geom', 'id', 'source', 'target')
      `);

      // Add cost columns
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        ADD COLUMN IF NOT EXISTS is_bidirectional BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS length_km DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS reverse_cost DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS geojson TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
      `);

      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded 
        SET length_km = COALESCE(length_km, ST_Length(the_geom::geography) / 1000.0),
            cost = GREATEST(ST_Length(the_geom::geography) / 1000.0, 1e-6),
            reverse_cost = GREATEST(ST_Length(the_geom::geography) / 1000.0, 1e-6),
            geojson = COALESCE(geojson, ST_AsGeoJSON(the_geom, 6, 0))
      `);

      // Ensure vertices table exists and is indexed
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_vertices_geom ON ${stagingSchema}.ways_noded_vertices_pgr USING GIST(the_geom)`);

      // Do not create mapping tables here; let higher-level helper build them uniformly

      // Stats
      const nodeCountResult = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr`);
      const edgeCountResult = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.ways_noded`);
      const isolatedNodesResult = await pgClient.query(`
        SELECT COUNT(*) AS isolated_count
        FROM ${stagingSchema}.ways_noded_vertices_pgr n
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded e
          WHERE e.source = n.id OR e.target = n.id
        )
      `);
      const orphanedEdgesResult = await pgClient.query(`
        SELECT COUNT(*) AS orphaned_count
        FROM ${stagingSchema}.ways_noded e
        WHERE e.source NOT IN (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr)
           OR e.target NOT IN (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr)
      `);

      return {
        success: true,
        stats: {
          nodesCreated: parseInt(nodeCountResult.rows[0].count, 10),
          edgesCreated: parseInt(edgeCountResult.rows[0].count, 10),
          isolatedNodes: parseInt(isolatedNodesResult.rows[0].isolated_count, 10),
          orphanedEdges: parseInt(orphanedEdgesResult.rows[0].orphaned_count, 10)
        }
      };
    } catch (error) {
      console.error('❌ PostGIS node network strategy failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: {
          nodesCreated: 0,
          edgesCreated: 0,
          isolatedNodes: 0,
          orphanedEdges: 0
        }
      };
    }
  }
}


