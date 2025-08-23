import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class PgrCreateTopologyStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    
    try {
      console.log('🔄 Using pgr_createTopology strategy (matching working commit f66282bf)...');

      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways WHERE the_geom IS NOT NULL
      `);
      console.log(`📊 Input ways table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in ways table');
      }

      // Prepare 2D, valid, simple input
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_2d`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_2d AS
        SELECT id AS old_id, ST_Force2D(the_geom) AS geom, app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${stagingSchema}.ways
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
      `);
      
      const ways2dCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_2d`);
      console.log(`📊 Created ways_2d table with ${ways2dCount.rows[0].count} rows`);

      // Create ways_split directly from the already-split trails from Layer 1
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_split CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_split AS
        SELECT 
          geom as the_geom,
          old_id,
          app_uuid,
          name,
          length_km,
          elevation_gain,
          elevation_loss
        FROM ${stagingSchema}.ways_2d
        WHERE geom IS NOT NULL AND ST_NumPoints(geom) > 1
      `);
      
      // Add required columns for pgRouting
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_split ADD COLUMN id serial PRIMARY KEY`);
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_split ADD COLUMN source integer`);
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_split ADD COLUMN target integer`);
      
      // Use pgRouting to create topology (nodes and edges) from already-split trails
      console.log('🔧 Creating topology with pgr_createTopology...');
      const topologyResult = await pgClient.query(`
        SELECT pgr_createTopology('${stagingSchema}.ways_split', 0.00001, 'the_geom', 'id')
      `);
      console.log(`   ✅ pgr_createTopology result: ${topologyResult.rows[0].pgr_createtopology}`);
      
      // Create ways_noded from the split and topologized table
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          id,
          the_geom,
          length_km,
          app_uuid,
          name,
          elevation_gain,
          elevation_loss,
          old_id,
          1 AS sub_id,
          source,
          target
        FROM ${stagingSchema}.ways_split
        WHERE the_geom IS NOT NULL AND ST_NumPoints(the_geom) > 1
      `);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);
      
      // pgr_createTopology already created the vertices table, so we just need to copy it
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT * FROM ${stagingSchema}.ways_split_vertices_pgr
      `);
      
      console.log('✅ Vertices table created from pgr_createTopology output');
      console.log('✅ Source/target assignment completed by pgr_createTopology');

      // Remove degenerate/self-loop/invalid edges before proceeding
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE the_geom IS NULL OR ST_NumPoints(the_geom) < 2 OR ST_Length(the_geom::geography) = 0`);
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE source IS NULL OR target IS NULL OR source = target`);

      // Recompute node degree after cleanup (ignore edges <= 1m)
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
          WHERE (e.source = v.id OR e.target = v.id)
            AND ST_Length(e.the_geom::geography) > 1.0
        )
      `);

      // Verify connectivity counts are properly set
      const connectivityCheck = await pgClient.query(`
        SELECT COUNT(*) as total_vertices, 
               COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
               MIN(cnt) as min_degree, 
               MAX(cnt) as max_degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      `);
      
      const stats = connectivityCheck.rows[0];
      console.log(`🔗 Connectivity check: ${stats.total_vertices} total vertices, ${stats.connected_vertices} connected, degree range ${stats.min_degree}-${stats.max_degree}`);
      
      if (stats.connected_vertices === 0) {
        console.warn('⚠️ No connected vertices found! Recalculating connectivity counts...');
        // Force recalculation of connectivity counts
        await pgClient.query(`
          UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
          SET cnt = (
            SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
            WHERE e.source = v.id OR e.target = v.id
          )
        `);
        
        // Check again
        const recheck = await pgClient.query(`
          SELECT COUNT(*) as connected_vertices
          FROM ${stagingSchema}.ways_noded_vertices_pgr
          WHERE cnt > 0
        `);
        console.log(`✅ After recalculation: ${recheck.rows[0].connected_vertices} connected vertices`);
      }

      // Harden 2D everywhere
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Force2D(the_geom)`);
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr SET the_geom = ST_Force2D(the_geom)`);

      // Final connectivity check and fix
      console.log('🔗 Performing final connectivity check...');
      const finalConnectivityCheck = await pgClient.query(`
        SELECT COUNT(*) as total_vertices, 
               COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
               MIN(cnt) as min_degree, 
               MAX(cnt) as max_degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      `);
      
      const finalStats = finalConnectivityCheck.rows[0];
      console.log(`🔗 Final connectivity: ${finalStats.total_vertices} total vertices, ${finalStats.connected_vertices} connected, degree range ${finalStats.min_degree}-${finalStats.max_degree}`);
      
      if (finalStats.connected_vertices === 0) {
        console.warn('⚠️ Final connectivity check failed! Forcing connectivity recalculation...');
        // Force final recalculation of connectivity counts
        await pgClient.query(`
          UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
          SET cnt = (
            SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
            WHERE e.source = v.id OR e.target = v.id
          )
        `);
        
        // Final verification
        const finalRecheck = await pgClient.query(`
          SELECT COUNT(*) as connected_vertices, MIN(cnt) as min_degree, MAX(cnt) as max_degree
          FROM ${stagingSchema}.ways_noded_vertices_pgr
          WHERE cnt > 0
        `);
        console.log(`✅ Final connectivity fix: ${finalRecheck.rows[0].connected_vertices} connected vertices, degree range ${finalRecheck.rows[0].min_degree}-${finalRecheck.rows[0].max_degree}`);
      }

      // Stats
      const edges = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
      const nodes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded_vertices_pgr`);

      console.log(`📊 Final network stats: ${edges.rows[0].c} edges, ${nodes.rows[0].c} nodes`);
      console.log('✅ pgr_createTopology strategy completed successfully!');
      
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
      console.error('❌ pgr_createTopology strategy failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error), 
        stats: { nodesCreated: 0, edgesCreated: 0, isolatedNodes: 0, orphanedEdges: 0 } 
      };
    }
  }
}
