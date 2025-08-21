import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from './types/network-types';

export class VertexBasedNetworkStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    
    try {
      console.log('🔄 Using vertex-based network creation strategy...');
      
      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
      `);
      console.log(`📊 Input trails table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in trails table');
      }

      // Step 1: Create 2D version of trails for network creation
      console.log('🔧 Step 1: Creating 2D version of trails...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.trails_2d`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.trails_2d AS
        SELECT 
          id,
          app_uuid,
          name,
          ST_Force2D(geometry) AS geom,
          length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      `);
      
      const trails2dCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails_2d`);
      console.log(`📊 Created trails_2d table with ${trails2dCount.rows[0].count} rows`);

      // Step 2: Extract all unique vertices from trail endpoints
      console.log('📍 Step 2: Extracting unique vertices from trail endpoints...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.network_vertices`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.network_vertices AS
        WITH all_endpoints AS (
          SELECT ST_StartPoint(geom) as vertex_point FROM ${stagingSchema}.trails_2d
          UNION
          SELECT ST_EndPoint(geom) as vertex_point FROM ${stagingSchema}.trails_2d
        ),
        unique_vertices AS (
          SELECT 
            ST_SnapToGrid(vertex_point, 0.00001) as snapped_vertex,
            COUNT(*) as usage_count
          FROM all_endpoints
          GROUP BY ST_SnapToGrid(vertex_point, 0.00001)
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          snapped_vertex as geom,
          ST_X(snapped_vertex) as lng,
          ST_Y(snapped_vertex) as lat,
          usage_count,
          CASE 
            WHEN usage_count > 2 THEN 'intersection'
            WHEN usage_count = 2 THEN 'connector'
            ELSE 'endpoint'
          END as node_type
        FROM unique_vertices
      `);
      
      const verticesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.network_vertices`);
      console.log(`📍 Created ${verticesCount.rows[0].count} unique network vertices`);

      // Validate that we have vertices to work with
      if (verticesCount.rows[0].count === 0) {
        throw new Error('No network vertices created - check if trails have valid geometries');
      }

      // Step 3: Create edges that connect vertices
      console.log('🛤️ Step 3: Creating edges between vertices...');
      
      // Debug: Check what we're working with
      const trails2dDebug = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails_2d`);
      console.log(`   📊 Working with ${trails2dDebug.rows[0].count} 2D trails`);
      
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.network_edges`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.network_edges AS
        WITH trail_vertex_mapping AS (
          SELECT 
            t.id as trail_id,
            t.app_uuid as trail_uuid,
            t.name as trail_name,
            t.geom as trail_geom,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.source,
            v1.id as start_vertex_id,
            v2.id as end_vertex_id
          FROM ${stagingSchema}.trails_2d t
          JOIN ${stagingSchema}.network_vertices v1 ON ST_DWithin(ST_StartPoint(t.geom), v1.geom, 0.001)
          JOIN ${stagingSchema}.network_vertices v2 ON ST_DWithin(ST_EndPoint(t.geom), v2.geom, 0.001)
          WHERE v1.id != v2.id  -- Avoid self-loops
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          trail_id,
          trail_uuid,
          trail_name,
          start_vertex_id as source,
          end_vertex_id as target,
          trail_geom as geom,
          length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source as trail_source
        FROM trail_vertex_mapping
      `);
      
      const edgesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.network_edges`);
      console.log(`🛤️ Created ${edgesCount.rows[0].count} network edges`);

      // Validate that we have edges to work with
      if (edgesCount.rows[0].count === 0) {
        throw new Error('No network edges created - check if trails have valid geometries and endpoints');
      }

      // Step 4: Create spatial indexes for performance
      console.log('📍 Step 4: Creating spatial indexes...');
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_network_vertices_geom ON ${stagingSchema}.network_vertices USING GIST(geom)`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_network_edges_geom ON ${stagingSchema}.network_edges USING GIST(geom)`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_network_edges_source ON ${stagingSchema}.network_edges(source)`);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_network_edges_target ON ${stagingSchema}.network_edges(target)`);

      // Step 5: Create routing_nodes table if it doesn't exist
      console.log('📍 Step 5: Creating routing_nodes table...');
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
      
      // Clear existing data and populate routing_nodes table
      await pgClient.query(`DELETE FROM ${stagingSchema}.routing_nodes`);
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.routing_nodes (
          id, node_uuid, lat, lng, elevation, node_type, connected_trails
        )
        SELECT 
          id,
          'node-' || id as node_uuid,
          lat,
          lng,
          0 as elevation,
          node_type,
          0 as connected_trails
        FROM ${stagingSchema}.network_vertices
      `);
      
      const nodesCreated = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
      console.log(`📍 Created ${nodesCreated.rows[0].count} routing nodes`);

      // Step 6: Create routing_edges table if it doesn't exist
      console.log('🛤️ Step 6: Creating routing_edges table...');
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
      
      // Clear existing data and populate routing_edges table
      await pgClient.query(`DELETE FROM ${stagingSchema}.routing_edges`);
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.routing_edges (
          id, from_node_id, to_node_id, trail_id, trail_name, distance_km, 
          elevation_gain, elevation_loss, geometry
        )
        SELECT 
          id,
          source as from_node_id,
          target as to_node_id,
          trail_uuid as trail_id,
          trail_name,
          length_km as distance_km,
          elevation_gain,
          elevation_loss,
          geom as geometry
        FROM ${stagingSchema}.network_edges
      `);
      
      const edgesCreated = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
      console.log(`🛤️ Created ${edgesCreated.rows[0].count} routing edges`);

      // Step 7: Calculate node degrees and identify isolated nodes
      console.log('🔗 Step 7: Calculating node connectivity...');
      await pgClient.query(`
        UPDATE ${stagingSchema}.routing_nodes 
        SET connected_trails = (
          SELECT COUNT(*) 
          FROM ${stagingSchema}.routing_edges 
          WHERE from_node_id = routing_nodes.id OR to_node_id = routing_nodes.id
        )
      `);
      
      const isolatedNodes = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.routing_nodes 
        WHERE connected_trails = 0
      `);
      
      const orphanedEdges = await pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.routing_edges e
        LEFT JOIN ${stagingSchema}.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN ${stagingSchema}.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
      `);

      console.log(`✅ Vertex-based network creation completed successfully`);
      
      return {
        success: true,
        stats: {
          nodesCreated: nodesCreated.rows[0].count,
          edgesCreated: edgesCreated.rows[0].count,
          isolatedNodes: isolatedNodes.rows[0].count,
          orphanedEdges: orphanedEdges.rows[0].count
        }
      };
      
    } catch (error) {
      console.error('❌ Vertex-based network creation failed:', error);
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
