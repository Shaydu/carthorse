import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class PgNodeNetworkStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    console.log('🔄 Using pgr_nodeNetwork strategy (enhanced approach)...');
    
    try {
      const { stagingSchema, tolerances } = config;
      
      // Step 1: Use pgr_nodeNetwork() to create nodes from ALL intersection points
      console.log('🔗 Using pgr_nodeNetwork() to create vertices from all intersection points...');
      
      // First, create a ways table in the staging schema for pgr_nodeNetwork input
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.temp_ways AS
        SELECT id, the_geom FROM ${stagingSchema}.ways
      `);

      // Preprocess to prevent linear-intersection errors inside pgr_nodeNetwork
      // 1) Force 2D + MakeValid
      await pgClient.query(`
        UPDATE ${stagingSchema}.temp_ways
        SET the_geom = ST_Force2D(ST_MakeValid(the_geom))
      `);

      // 2) Snap to small grid (~1m) to deduplicate near-coincident vertices
      await pgClient.query(`
        UPDATE ${stagingSchema}.temp_ways
        SET the_geom = ST_SnapToGrid(the_geom, 0.000009)  -- ~1m grid
      `);

      // 3) Remove duplicates and zero-length segments
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.temp_ways a
        USING ${stagingSchema}.temp_ways b
        WHERE a.id < b.id AND ST_Equals(a.the_geom, b.the_geom);
      `);
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.temp_ways WHERE ST_Length(the_geom) < 0.000001;
      `);
      
      // Since we're using both-split-algos, the segments should already be clean LineStrings
      // Just do a light validation to ensure compatibility
      console.log('🔍 Validating already-split segments for pgr_nodeNetwork...');
      
      // Remove any remaining problematic geometries (should be minimal after our splitting)
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.temp_ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR ST_IsEmpty(the_geom)
          OR NOT ST_IsValid(the_geom)
          OR NOT ST_IsSimple(the_geom)
          OR ST_NumPoints(the_geom) < 2
          OR ST_Length(the_geom) < 0.0001
      `);
      
      // OPTIMIZATION: Add spatial index for faster pgr_nodeNetwork processing
      console.log('🔍 Adding spatial index for optimized processing...');
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_temp_ways_geom ON ${stagingSchema}.temp_ways USING GIST(the_geom)
      `);
      
      // Verify the temp table was created
      const tempTableCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.temp_ways
      `);
      console.log(`✅ Created ${stagingSchema}.temp_ways table with ${tempTableCheck.rows[0].count} already-split segments`);
      
      // Final validation: ensure all geometries are simple LineStrings
      const finalValidation = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.temp_ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
      `);
      
      if (finalValidation.rows[0].count > 0) {
        throw new Error(`Found ${finalValidation.rows[0].count} non-LineString geometries after cleanup. pgr_nodeNetwork requires simple LineStrings.`);
      }
      
      console.log('✅ All already-split segments validated as simple LineStrings for pgr_nodeNetwork');
      
      // OPTIMIZATION: Call pgr_nodeNetwork() (or v2 wrapper) ONCE and store results in a regular table
      console.log('🎯 Running pgr_nodeNetwork() on already-split segments...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.node_network_results`);
      const useV2 = process.env.PGNN_V2 === '1';
      const gridDeg = process.env.PGNN_GRID_DEG || '0.000009';
      const func = useV2 
        ? `public.carthorse_pgr_node_network_v2('${stagingSchema}.temp_ways'::regclass, ${tolerances.intersectionDetectionTolerance}, ${gridDeg})`
        : `pgr_nodeNetwork('${stagingSchema}.temp_ways', ${tolerances.intersectionDetectionTolerance}, 'id', 'the_geom')`;
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.node_network_results AS
        SELECT id, old_id, sub_id, ${useV2 ? 'the_geom' : 'geom AS the_geom'}, cnt, chk, ein, eout
        FROM ${func}
      `);
      
      console.log('✅ pgr_nodeNetwork() completed successfully');
      
      // OPTIMIZATION: Add spatial index to node_network_results for faster joins
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_node_network_geom ON ${stagingSchema}.node_network_results USING GIST(the_geom)
      `);

      // Step 2: Create ways_noded table from stored pgr_nodeNetwork results
      console.log('📋 Creating ways_noded table from pgr_nodeNetwork results...');
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          old_id,
          sub_id,
          the_geom,
          app_uuid,
          name,
          length_km,
          elevation_gain,
          elevation_loss
        FROM (
          SELECT 
            wn.id,
            w.app_uuid,
            w.name,
            w.length_km,
            w.elevation_gain,
            w.elevation_loss,
            wn.old_id,
            wn.sub_id,
            wn.the_geom
          FROM ${stagingSchema}.node_network_results wn
          JOIN ${stagingSchema}.ways w ON wn.old_id = w.id
        ) subquery
      `);
      console.log('✅ Created ways_noded table from pgr_nodeNetwork results');

      // Populate trail_id_mapping table for UUID ↔ Integer ID conversion
      console.log('🔄 Populating trail_id_mapping table...');
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.trail_id_mapping (app_uuid, trail_id)
        SELECT DISTINCT app_uuid, id as trail_id
        FROM ${stagingSchema}.ways_noded
        ORDER BY id
      `);
      console.log('✅ Populated trail_id_mapping table');

      // OPTIMIZATION: Add spatial index to ways_noded for faster spatial operations
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)
      `);

      // Step 3: Create ways_noded_vertices_pgr from stored pgr_nodeNetwork results
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
        FROM ${stagingSchema}.node_network_results
      `);
      console.log('✅ Created vertices table from pgr_nodeNetwork results');

      // OPTIMIZATION: Add spatial index to vertices table for faster spatial joins
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_vertices_geom ON ${stagingSchema}.ways_noded_vertices_pgr USING GIST(the_geom)
      `);

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

      // Step 8: Add missing metadata columns to ways_noded for export compatibility
      console.log('🛤️ Adding metadata columns to ways_noded...');
      await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded 
        ADD COLUMN IF NOT EXISTS is_bidirectional BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS geojson TEXT
      `);
      
      // Update geojson column with computed GeoJSON
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded 
        SET geojson = ST_AsGeoJSON(the_geom, 6, 0)
        WHERE geojson IS NULL
      `);
      
      console.log('✅ Added metadata columns to ways_noded');

      // Step 9: Clean up temporary tables
      console.log('🧹 Cleaning up temporary tables...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.temp_ways`);
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.node_network_results`);
      console.log('✅ Cleaned up temporary tables');

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