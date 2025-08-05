import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class ManualNetworkStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    console.log('🔄 Using manual network creation strategy (current approach)...');
    
    try {
      const { stagingSchema, tolerances } = config;
      
      // Step 1: Create ways_noded table directly from ways without splitting
      console.log('📋 Creating ways_noded table without further splitting...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          id as old_id,
          1 as sub_id,
          the_geom,
          app_uuid,
          length_km,
          elevation_gain
        FROM ${stagingSchema}.ways
      `);
      console.log('✅ Created ways_noded table without splitting');

      // Step 2: Create vertices table with manual intersection detection
      console.log('📍 Creating vertices from trail endpoints and endpoint connections...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT DISTINCT 
          ROW_NUMBER() OVER (ORDER BY point) as id,
          point as the_geom,
          COUNT(*) as cnt,
          'f' as chk,
          COUNT(CASE WHEN is_start THEN 1 END) as ein,
          COUNT(CASE WHEN is_end THEN 1 END) as eout,
          CASE 
            WHEN COUNT(*) >= 2 THEN 'intersection'
            WHEN COUNT(*) = 1 THEN 'endpoint'
            WHEN COUNT(*) = 0 THEN 'endpoint'
            WHEN COUNT(*) IS NULL THEN 'endpoint'
            ELSE 'endpoint'
          END as node_type
        FROM (
          -- Start and end points of all trails
          SELECT 
            ST_StartPoint(the_geom) as point,
            true as is_start,
            false as is_end
          FROM ${stagingSchema}.ways_noded
          UNION ALL
          SELECT 
            ST_EndPoint(the_geom) as point,
            false as is_start,
            true as is_end
          FROM ${stagingSchema}.ways_noded
          UNION ALL
          -- Only create intersection points when trails actually meet at their endpoints
          SELECT DISTINCT
            w1_end as point,
            false as is_start,
            false as is_end
          FROM (
            SELECT 
              w1.id as w1_id,
              w2.id as w2_id,
              ST_EndPoint(w1.the_geom) as w1_end,
              ST_StartPoint(w2.the_geom) as w2_start,
              ST_EndPoint(w2.the_geom) as w2_end,
              ST_StartPoint(w1.the_geom) as w1_start
            FROM ${stagingSchema}.ways_noded w1
            JOIN ${stagingSchema}.ways_noded w2 ON w1.id != w2.id
            WHERE (
              -- Trail 1 end connects to Trail 2 start
              ST_DWithin(ST_EndPoint(w1.the_geom), ST_StartPoint(w2.the_geom), ${tolerances.intersectionDetectionTolerance})
              OR
              -- Trail 1 end connects to Trail 2 end  
              ST_DWithin(ST_EndPoint(w1.the_geom), ST_EndPoint(w2.the_geom), ${tolerances.intersectionDetectionTolerance})
              OR
              -- Trail 1 start connects to Trail 2 start
              ST_DWithin(ST_StartPoint(w1.the_geom), ST_StartPoint(w2.the_geom), ${tolerances.intersectionDetectionTolerance})
              OR
              -- Trail 1 start connects to Trail 2 end
              ST_DWithin(ST_StartPoint(w1.the_geom), ST_EndPoint(w2.the_geom), ${tolerances.intersectionDetectionTolerance})
            )
          ) intersections
          WHERE ST_Distance(w1_end, w2_start) > 0.0001
        ) points
        GROUP BY point
      `);
      console.log('✅ Created vertices table from trail endpoints');

      // Step 3: Add source and target columns to ways_noded
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        ADD COLUMN source INTEGER,
        ADD COLUMN target INTEGER
      `);

      // Step 4: Update source and target based on vertex proximity
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

      // Step 5: Remove edges that couldn't be connected to vertices
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log('✅ Connected edges to vertices');

      // Step 6: Preserve true loop trails but remove problematic self-loops
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

      // Step 7: Get statistics
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

      console.log('✅ Manual network creation completed successfully');
      
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
      console.error('❌ Manual network creation failed:', error);
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