import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
import { runGapMidpointBridging } from '../gap-midpoint-bridging';
import { getPgRoutingTolerances, getConstants } from '../../../config-loader';

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
          name,
          length_km,
          elevation_gain,
          elevation_loss
        FROM ${stagingSchema}.ways
      `);
      console.log('✅ Created ways_noded table without splitting');

      // Step 1.5: Populate trail_id_mapping table for UUID ↔ Integer ID conversion
      console.log('🔄 Populating trail_id_mapping table...');
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.trail_id_mapping (app_uuid, trail_id)
        SELECT app_uuid, id as trail_id
        FROM ${stagingSchema}.ways_noded
        ORDER BY id
      `);
      console.log('✅ Populated trail_id_mapping table');

      // Step 2: Create vertices table with manual intersection detection
      console.log('📍 Creating vertices from trail endpoints only...');
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

      // Default gap bridging via midpoint insertion within configured tolerance
      try {
        const constants: any = getConstants();
        const bridgingCfg = (constants && (constants as any).bridging) || { toleranceMeters: 20 };
        const tolMeters = Number(bridgingCfg.toleranceMeters || 20);
        const { midpointsInserted, edgesInserted } = await runGapMidpointBridging(pgClient, stagingSchema, tolMeters);
        if (midpointsInserted > 0 || edgesInserted > 0) {
          console.log(`🔗 Midpoint gap-bridging: vertices=${midpointsInserted}, edges=${edgesInserted}`);
        } else {
          console.log('🔗 Midpoint gap-bridging: no gaps within tolerance');
        }
      } catch (e) {
        console.warn('⚠️ Midpoint gap-bridging step skipped due to error:', e instanceof Error ? e.message : e);
      }

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

      // Step 7: Create routing edges from ways_noded
      console.log('🛤️ Creating routing edges...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.routing_edges`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.routing_edges AS
        SELECT 
          wn.id,
          wn.source,
          wn.target,
          wn.app_uuid as trail_id, -- Use app_uuid (UUID) instead of integer ID
          COALESCE(wn.name, 'Trail ' || wn.app_uuid) as trail_name,
          wn.length_km as length_km,
          wn.elevation_gain,
          COALESCE(wn.elevation_loss, 0) as elevation_loss,
          true as is_bidirectional,
          wn.the_geom as geometry,
          ST_AsGeoJSON(wn.the_geom) as geojson
        FROM ${stagingSchema}.ways_noded wn
        WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
      `);
      console.log('✅ Created routing edges');

      // Step 8: Get statistics
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