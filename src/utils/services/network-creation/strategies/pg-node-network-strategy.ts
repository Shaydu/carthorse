import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class PgNodeNetworkStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    console.log('🔄 Using pgr_nodeNetwork strategy (enhanced approach)...');
    
    try {
      const { stagingSchema, tolerances } = config;
      
      // Step 1: Use pgr_nodeNetwork() to create nodes from ALL intersection points
      console.log('🔗 Using pgr_nodeNetwork() to create vertices from all intersection points...');
      
      // First, create a temporary ways table for pgr_nodeNetwork input
      await pgClient.query(`
        CREATE TEMP TABLE temp_ways AS
        SELECT id, the_geom FROM ${stagingSchema}.ways
      `);
      
      // Run pgr_nodeNetwork() to create nodes from all intersection points
      const nodeNetworkResult = await pgClient.query(`
        SELECT pgr_nodeNetwork('SELECT id, the_geom FROM temp_ways', ${tolerances.intersectionDetectionTolerance})
      `);
      
      console.log('✅ pgr_nodeNetwork() completed successfully');
      
      // Step 2: Create ways_noded table from pgr_nodeNetwork results
      console.log('📋 Creating ways_noded table from pgr_nodeNetwork results...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          old_id,
          sub_id,
          the_geom,
          app_uuid,
          length_km,
          elevation_gain
        FROM (
          SELECT 
            wn.id,
            w.app_uuid,
            w.length_km,
            w.elevation_gain,
            wn.old_id,
            wn.sub_id,
            wn.the_geom
          FROM pgr_nodeNetwork('SELECT id, the_geom FROM temp_ways', ${tolerances.intersectionDetectionTolerance}) wn
          JOIN ${stagingSchema}.ways w ON wn.old_id = w.id
        ) subquery
      `);
      console.log('✅ Created ways_noded table from pgr_nodeNetwork results');

      // Step 3: Create ways_noded_vertices_pgr from pgr_nodeNetwork results
      console.log('📍 Creating vertices table from pgr_nodeNetwork results...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          id,
          the_geom,
          cnt,
          chk,
          ein,
          eout,
          CASE 
            WHEN cnt >= 2 THEN 'intersection'
            WHEN cnt = 1 THEN 'endpoint'
            ELSE 'endpoint'
          END as node_type
        FROM pgr_nodeNetwork('SELECT id, the_geom FROM temp_ways', ${tolerances.intersectionDetectionTolerance})
      `);
      console.log('✅ Created vertices table from pgr_nodeNetwork results');

      // Step 4: Add source and target columns to ways_noded
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        ADD COLUMN source INTEGER,
        ADD COLUMN target INTEGER
      `);

      // Step 5: Update source and target based on vertex proximity
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded wn
        SET 
          source = (
            SELECT v.id 
            FROM ${stagingSchema}.ways_noded_vertices_pgr v 
            WHERE ST_DWithin(ST_StartPoint(wn.the_geom), v.the_geom, ${tolerances.edgeToVertexTolerance})
            LIMIT 1
          ),
          target = (
            SELECT v.id 
            FROM ${stagingSchema}.ways_noded_vertices_pgr v 
            WHERE ST_DWithin(ST_EndPoint(wn.the_geom), v.the_geom, ${tolerances.edgeToVertexTolerance})
            LIMIT 1
          )
      `);

      // Step 6: Remove edges that couldn't be connected to vertices
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log('✅ Connected edges to vertices');

      // Step 7: Preserve true loop trails but remove problematic self-loops
      console.log('🔄 Preserving true loop trails...');
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        ADD COLUMN is_true_loop BOOLEAN DEFAULT FALSE
      `);
      
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded 
        SET is_true_loop = TRUE
        WHERE ST_Distance(ST_StartPoint(the_geom)::geography, ST_EndPoint(the_geom)::geography) < ${tolerances.trueLoopTolerance}
      `);
      
      const selfLoopResult = await pgClient.query(`
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE source = target AND NOT is_true_loop
      `);
      console.log(`✅ Removed ${selfLoopResult.rowCount} problematic self-loop edges, preserved true loops`);
      
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        DROP COLUMN is_true_loop
      `);

      // Step 8: Clean up temporary table
      await pgClient.query(`DROP TABLE temp_ways`);

      // Step 9: Get statistics
      const nodeCountResult = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr`);
      const edgeCountResult = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.ways_noded`);
      
      const isolatedNodesResult = await pgClient.query(`
        SELECT COUNT(*) as isolated_count
        FROM ${stagingSchema}.ways_noded_vertices_pgr n
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.ways_noded e
          WHERE e.source = n.id OR e.target = n.id
        )
      `);
      
      const orphanedEdgesResult = await pgClient.query(`
        SELECT COUNT(*) as orphaned_count
        FROM ${stagingSchema}.ways_noded e
        WHERE e.source NOT IN (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr)
          OR e.target NOT IN (SELECT id FROM ${stagingSchema}.ways_noded_vertices_pgr)
      `);

      console.log('✅ pgr_nodeNetwork strategy completed successfully');
      
      return {
        success: true,
        stats: {
          nodesCreated: parseInt(nodeCountResult.rows[0].count),
          edgesCreated: parseInt(edgeCountResult.rows[0].count),
          isolatedNodes: parseInt(isolatedNodesResult.rows[0].isolated_count),
          orphanedEdges: parseInt(orphanedEdgesResult.rows[0].orphaned_count)
        }
      };

    } catch (error) {
      console.error('❌ pgr_nodeNetwork strategy failed:', error);
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