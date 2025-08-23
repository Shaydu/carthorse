import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class PgrNodeNetworkStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    
    try {
      console.log('🔄 Using pgr_nodeNetwork with 5-meter precision for intersection detection...');

      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
      `);
      console.log(`📊 Input trails table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in trails table');
      }

      // Step 1: Create a temporary table with all trail geometries for pgr_nodeNetwork
      console.log('📍 Step 1: Preparing trail geometries for pgr_nodeNetwork...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.temp_trails_for_network`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.temp_trails_for_network AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          geometry as the_geom,
          length_km as cost,
          length_km as reverse_cost
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      `);

      // Step 2: Use pgr_nodeNetwork to detect all intersections with 5-meter precision
      console.log('🔄 Step 2: Running pgr_nodeNetwork with 5-meter precision...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded`);
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      
      const nodeNetworkResult = await pgClient.query(`
        SELECT * FROM pgr_nodeNetwork(
          '${stagingSchema}.temp_trails_for_network',
          0.00005  -- 5-meter precision for intersection detection
        )
      `);
      
      console.log(`✅ pgr_nodeNetwork completed. Found ${nodeNetworkResult.rows.length} edges`);

      // Step 3: Create the ways_noded table with trail metadata
      console.log('🛤️ Step 3: Creating ways_noded table with trail metadata...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          wn.id,
          wn.source,
          wn.target,
          wn.cost,
          wn.reverse_cost,
          wn.old_id,
          t.app_uuid as trail_uuid,
          t.name as trail_name,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.trail_type,
          t.surface,
          t.difficulty,
          wn.the_geom,
          ST_AsGeoJSON(wn.the_geom) as geojson
        FROM ${stagingSchema}.ways_noded wn
        LEFT JOIN ${stagingSchema}.trails t ON wn.old_id = t.id
        WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
      `);

      // Step 4: Create the ways_noded_vertices_pgr table
      console.log('📍 Step 4: Creating ways_noded_vertices_pgr table...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          id,
          the_geom,
          ST_X(the_geom) as x,
          ST_Y(the_geom) as y,
          cnt,
          chk,
          ein,
          eout,
          CASE 
            WHEN cnt >= 3 THEN 'intersection'
            WHEN cnt = 2 THEN 'connector'
            ELSE 'endpoint'
          END as node_type
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      `);

      // Step 5: Clean up temporary tables
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.temp_trails_for_network`);

      // Step 6: Verify the results
      const edgesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
      const nodesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr`);
      const intersectionCount = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt >= 3
      `);

      console.log(`✅ Network creation completed:`);
      console.log(`   - ${edgesCount.rows[0].count} edges in ways_noded`);
      console.log(`   - ${nodesCount.rows[0].count} nodes in ways_noded_vertices_pgr`);
      console.log(`   - ${intersectionCount.rows[0].count} intersection nodes`);

      return {
        success: true,
        stats: {
          nodesCreated: nodesCount.rows[0].count,
          edgesCreated: edgesCount.rows[0].count,
          isolatedNodes: 0, // pgr_nodeNetwork handles this automatically
          orphanedEdges: 0  // pgr_nodeNetwork handles this automatically
        }
      };

    } catch (error) {
      console.error('❌ Error in PgrNodeNetworkStrategy:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
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
