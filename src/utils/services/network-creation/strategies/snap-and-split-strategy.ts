import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class SnapAndSplitStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema, tolerances } = config;
    
    try {
      console.log('🔄 Using snap-and-split strategy for trail network creation...');

      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
      `);
      console.log(`📊 Input trails table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in trails table');
      }

      // Step 1: Use the snap-and-split function to create clean splits
      console.log('📍 Step 1: Snapping nodes to trails and creating clean splits...');
      const snapSplitResult = await pgClient.query(`
        SELECT * FROM split_trails_at_snapped_nodes($1, $2)
      `, [stagingSchema, tolerances.intersectionDetectionTolerance]);

      if (snapSplitResult.rows.length === 0) {
        throw new Error('Snap-and-split function failed to return results');
      }

      const result = snapSplitResult.rows[0];
      console.log(`✅ Snap-and-split completed:`);
      console.log(`   📍 Original trails: ${result.original_count}`);
      console.log(`   🔄 Trails split: ${result.split_count}`);
      console.log(`   📊 Final trails: ${result.final_count}`);
      console.log(`   🎯 Unique nodes: ${result.node_count}`);

      // Step 2: Create routing nodes from intersection points
      console.log('📍 Step 2: Creating routing nodes from intersection points...');
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${stagingSchema}.routing_nodes (
          id INTEGER PRIMARY KEY,
          node_uuid TEXT UNIQUE NOT NULL,
          lat DOUBLE PRECISION NOT NULL,
          lng DOUBLE PRECISION NOT NULL,
          elevation REAL DEFAULT 0,
          node_type TEXT DEFAULT 'intersection',
          connected_trails INTEGER DEFAULT 0
        )
      `);
      
      await pgClient.query(`DELETE FROM ${stagingSchema}.routing_nodes`);
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.routing_nodes (
          id, node_uuid, lat, lng, elevation, node_type, connected_trails
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY point) as id,
          'node-' || ROW_NUMBER() OVER (ORDER BY point) as node_uuid,
          ST_Y(point) as lat,
          ST_X(point) as lng,
          COALESCE(ST_Z(point_3d), 0) as elevation,
          'intersection' as node_type,
          array_length(connected_trail_ids, 1) as connected_trails
        FROM ${stagingSchema}.intersection_points
        ORDER BY point
      `);

      const nodeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
      console.log(`📍 Created ${nodeCount.rows[0].count} routing nodes`);

      // Step 3: Create routing edges from split trails
      console.log('🛤️ Step 3: Creating routing edges from split trails...');
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${stagingSchema}.routing_edges (
          id INTEGER PRIMARY KEY,
          from_node_id INTEGER NOT NULL,
          to_node_id INTEGER NOT NULL,
          trail_id TEXT,
          trail_name TEXT,
          distance_km DOUBLE PRECISION NOT NULL,
          elevation_gain REAL DEFAULT 0,
          elevation_loss REAL DEFAULT 0,
          geometry GEOMETRY(LINESTRING, 4326),
          FOREIGN KEY (from_node_id) REFERENCES ${stagingSchema}.routing_nodes(id),
          FOREIGN KEY (to_node_id) REFERENCES ${stagingSchema}.routing_nodes(id)
        )
      `);
      
      await pgClient.query(`DELETE FROM ${stagingSchema}.routing_edges`);
      
      // Create edges by finding the closest nodes to trail endpoints
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.routing_edges (
          id, from_node_id, to_node_id, trail_id, trail_name, distance_km, 
          elevation_gain, elevation_loss, geometry
        )
        WITH trail_endpoints AS (
          SELECT 
            t.app_uuid as trail_uuid,
            t.name as trail_name,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.geometry,
            ST_StartPoint(t.geometry) as start_point,
            ST_EndPoint(t.geometry) as end_point
          FROM ${stagingSchema}.trails t
          WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trail_with_nodes AS (
          SELECT 
            te.*,
            -- Find closest node to start point
            (SELECT rn.id 
             FROM ${stagingSchema}.routing_nodes rn
             ORDER BY ST_Distance(ST_MakePoint(rn.lng, rn.lat), te.start_point)
             LIMIT 1) as from_node_id,
            -- Find closest node to end point
            (SELECT rn.id 
             FROM ${stagingSchema}.routing_nodes rn
             ORDER BY ST_Distance(ST_MakePoint(rn.lng, rn.lat), te.end_point)
             LIMIT 1) as to_node_id
          FROM trail_endpoints te
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY trail_uuid) as id,
          from_node_id,
          to_node_id,
          trail_uuid as trail_id,
          trail_name,
          length_km as distance_km,
          COALESCE(elevation_gain, 0) as elevation_gain,
          COALESCE(elevation_loss, 0) as elevation_loss,
          ST_Force2D(geometry) as geometry
        FROM trail_with_nodes
        WHERE from_node_id IS NOT NULL 
          AND to_node_id IS NOT NULL 
          AND from_node_id != to_node_id
        ORDER BY trail_uuid
      `);

      const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
      console.log(`🛤️ Created ${edgeCount.rows[0].count} routing edges`);

      // Step 4: Create edge_trail_composition table for export compatibility
      console.log('📋 Step 4: Creating edge_trail_composition table...');
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${stagingSchema}.edge_trail_composition AS
        SELECT 
          re.id as edge_id,
          re.trail_id as trail_uuid,
          re.trail_name,
          re.distance_km,
          re.elevation_gain,
          re.elevation_loss,
          'primary' as composition_type,
          1 as segment_sequence,
          100.0 as segment_percentage
        FROM ${stagingSchema}.routing_edges re
        ORDER BY re.id
      `);

      const compositionCount = await pgClient.query(`SELECT COUNT(*) as c FROM ${stagingSchema}.edge_trail_composition`);
      console.log(`📋 Created edge_trail_composition table with ${compositionCount.rows[0].c} rows`);

      // Step 5: Calculate connectivity statistics
      console.log('🔗 Step 5: Calculating connectivity statistics...');
      const isolatedNodes = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.routing_nodes rn
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.routing_edges re
          WHERE re.from_node_id = rn.id OR re.to_node_id = rn.id
        )
      `);

      const orphanedEdges = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.routing_edges re
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.routing_nodes rn
          WHERE rn.id = re.from_node_id OR rn.id = re.to_node_id
        )
      `);

      console.log(`✅ Snap-and-split network creation completed successfully!`);
      console.log(`📊 Final network: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
      console.log(`🔗 Isolated nodes: ${isolatedNodes.rows[0].count}`);
      console.log(`🚫 Orphaned edges: ${orphanedEdges.rows[0].count}`);
      
      return {
        success: true,
        stats: {
          nodesCreated: nodeCount.rows[0].count,
          edgesCreated: edgeCount.rows[0].count,
          isolatedNodes: isolatedNodes.rows[0].count,
          orphanedEdges: orphanedEdges.rows[0].count
        }
      };

    } catch (error) {
      console.error('❌ Snap-and-split network creation failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error), 
        stats: { nodesCreated: 0, edgesCreated: 0, isolatedNodes: 0, orphanedEdges: 0 } 
      };
    }
  }
}

