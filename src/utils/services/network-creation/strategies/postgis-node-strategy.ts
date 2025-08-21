import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';

export class PostgisNodeStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    
    try {
      console.log('🔄 Using simplified vertex-based trail splitting approach...');

      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails WHERE geometry IS NOT NULL
      `);
      console.log(`📊 Input trails table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in trails table');
      }

      // Step 1: Extract all unique vertices from trail geometries
      console.log('📍 Step 1: Extracting all unique vertices from trail geometries...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.all_vertices`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.all_vertices AS
        WITH trail_points AS (
          SELECT 
            id as trail_id,
            app_uuid as trail_uuid,
            name as trail_name,
            (ST_DumpPoints(geometry)).geom as point,
            (ST_DumpPoints(geometry)).path[1] as point_index
          FROM ${stagingSchema}.trails
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        unique_vertices AS (
          SELECT 
            ST_SnapToGrid(point, 0.00001) as snapped_point,
            COUNT(*) as usage_count,
            array_agg(DISTINCT trail_uuid) as connected_trails,
            array_agg(DISTINCT trail_name) as connected_trail_names
          FROM trail_points
          GROUP BY ST_SnapToGrid(point, 0.00001)
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY snapped_point) as id,
          snapped_point as the_geom,
          ST_X(snapped_point) as x,
          ST_Y(snapped_point) as y,
          usage_count,
          connected_trails,
          connected_trail_names,
          CASE 
            WHEN usage_count >= 3 THEN 'intersection'
            WHEN usage_count = 2 THEN 'connector'
            ELSE 'endpoint'
          END as node_type
        FROM unique_vertices
      `);
      
      const verticesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.all_vertices`);
      console.log(`📍 Extracted ${verticesCount.rows[0].count} unique vertices`);

      // Step 2: Split trails at all vertices
      console.log('✂️ Step 2: Splitting trails at all vertices...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.split_trails AS
        WITH trail_vertex_splits AS (
          SELECT 
            t.id as original_trail_id,
            t.app_uuid as original_trail_uuid,
            t.name as original_trail_name,
            t.geometry as original_geometry,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.source,
            v.id as vertex_id,
            v.the_geom as vertex_geom,
            ST_LineLocatePoint(t.geometry, v.the_geom) as split_location
          FROM ${stagingSchema}.trails t
          CROSS JOIN ${stagingSchema}.all_vertices v
          WHERE ST_DWithin(t.geometry, v.the_geom, 0.0001)
            AND ST_LineLocatePoint(t.geometry, v.the_geom) > 0.001  -- Not at start
            AND ST_LineLocatePoint(t.geometry, v.the_geom) < 0.999  -- Not at end
        ),
        split_segments AS (
          SELECT 
            original_trail_id,
            original_trail_uuid,
            original_trail_name,
            length_km,
            elevation_gain,
            elevation_loss,
            trail_type,
            surface,
            difficulty,
            source,
            vertex_id,
            vertex_geom,
            split_location,
            -- Create segment before this vertex
            ST_LineSubstring(original_geometry, 
              LAG(split_location) OVER (PARTITION BY original_trail_id ORDER BY split_location),
              split_location
            ) as segment_before,
            -- Create segment after this vertex  
            ST_LineSubstring(original_geometry,
              split_location,
              LEAD(split_location) OVER (PARTITION BY original_trail_id ORDER BY split_location)
            ) as segment_after
          FROM trail_vertex_splits
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          original_trail_id,
          original_trail_uuid,
          original_trail_name,
          segment_before as geometry,
          ST_Length(segment_before::geography) / 1000.0 as length_km,
          elevation_gain * (ST_Length(segment_before::geography) / ST_Length(original_geometry::geography)) as elevation_gain,
          elevation_loss * (ST_Length(segment_before::geography) / ST_Length(original_geometry::geography)) as elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          'before' as segment_type,
          vertex_id
        FROM split_segments
        WHERE segment_before IS NOT NULL AND ST_Length(segment_before::geography) > 1.0
        
        UNION ALL
        
        SELECT 
          ROW_NUMBER() OVER () + (SELECT COUNT(*) FROM split_segments WHERE segment_before IS NOT NULL) as id,
          original_trail_id,
          original_trail_uuid,
          original_trail_name,
          segment_after as geometry,
          ST_Length(segment_after::geography) / 1000.0 as length_km,
          elevation_gain * (ST_Length(segment_after::geography) / ST_Length(original_geometry::geography)) as elevation_gain,
          elevation_loss * (ST_Length(segment_after::geography) / ST_Length(original_geometry::geography)) as elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          'after' as segment_type,
          vertex_id
        FROM split_segments
        WHERE segment_after IS NOT NULL AND ST_Length(segment_after::geography) > 1.0
      `);

      // Also add original trails that weren't split (no intersections)
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.split_trails (
          id, original_trail_id, original_trail_uuid, original_trail_name, geometry, 
          length_km, elevation_gain, elevation_loss, trail_type, surface, difficulty, source,
          segment_type, vertex_id
        )
        SELECT 
          ROW_NUMBER() OVER () + (SELECT COALESCE(MAX(id), 0) FROM ${stagingSchema}.split_trails) as id,
          t.id as original_trail_id,
          t.app_uuid as original_trail_uuid,
          t.name as original_trail_name,
          t.geometry,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.source,
          'original' as segment_type,
          NULL as vertex_id
        FROM ${stagingSchema}.trails t
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.split_trails st 
          WHERE st.original_trail_id = t.id
        )
      `);

      const splitTrailsCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.split_trails`);
      console.log(`✂️ Created ${splitTrailsCount.rows[0].count} split trail segments`);

      // Step 3: Create edges from split trails
      console.log('🛤️ Step 3: Creating edges from split trails...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        WITH trail_edges AS (
          SELECT 
            st.id,
            st.original_trail_id,
            st.original_trail_uuid,
            st.original_trail_name,
            st.geometry as the_geom,
            st.length_km,
            st.elevation_gain,
            st.elevation_loss,
            st.trail_type,
            st.surface,
            st.difficulty,
            st.source,
            -- Find closest vertex to start point
            (SELECT v.id FROM ${stagingSchema}.all_vertices v 
             ORDER BY ST_Distance(ST_StartPoint(st.geometry), v.the_geom) 
             LIMIT 1) as source,
            -- Find closest vertex to end point
            (SELECT v.id FROM ${stagingSchema}.all_vertices v 
             ORDER BY ST_Distance(ST_EndPoint(st.geometry), v.the_geom) 
             LIMIT 1) as target
          FROM ${stagingSchema}.split_trails st
          WHERE st.geometry IS NOT NULL AND ST_NumPoints(st.geometry) > 1
        )
        SELECT * FROM trail_edges
        WHERE source IS NOT NULL AND target IS NOT NULL AND source != target
      `);

      const edgesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
      console.log(`🛤️ Created ${edgesCount.rows[0].count} edges`);

      // Step 4: Create vertices table from all_vertices
      console.log('📍 Step 4: Creating vertices table...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          id,
          the_geom,
          x,
          y,
          0 as cnt,  -- Will be calculated below
          0 as chk,
          0 as ein,
          0 as eout
        FROM ${stagingSchema}.all_vertices
        ORDER BY id
      `);

      // Step 5: Calculate vertex degrees
      console.log('🔗 Step 5: Calculating vertex degrees...');
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*)
          FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);

      const degreeDistribution = await pgClient.query(`
        SELECT cnt as degree, COUNT(*) as node_count
        FROM ${stagingSchema}.ways_noded_vertices_pgr
        GROUP BY cnt
        ORDER BY cnt
      `);
      
      console.log('📊 Vertex degree distribution:');
      degreeDistribution.rows.forEach(row => {
        console.log(`   - Degree ${row.degree}: ${row.node_count} nodes`);
      });

      // Step 6: Create routing_nodes table
      console.log('📍 Step 6: Creating routing_nodes table...');
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
          v.id,
          'node-' || v.id as node_uuid,
          v.y as lat,
          v.x as lng,
          COALESCE(ST_Z(v.the_geom), 0) as elevation,
          av.node_type,
          v.cnt as connected_trails
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${stagingSchema}.all_vertices av ON v.id = av.id
        ORDER BY v.id
      `);

      // Step 7: Create routing_edges table
      console.log('🛤️ Step 7: Creating routing_edges table...');
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
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.routing_edges (
          id, from_node_id, to_node_id, trail_id, trail_name, distance_km, 
          elevation_gain, elevation_loss, geometry
        )
        SELECT 
          id,
          source as from_node_id,
          target as to_node_id,
          original_trail_uuid as trail_id,
          original_trail_name as trail_name,
          length_km as distance_km,
          COALESCE(elevation_gain, 0) as elevation_gain,
          COALESCE(elevation_loss, 0) as elevation_loss,
          the_geom as geometry
        FROM ${stagingSchema}.ways_noded
        ORDER BY id
      `);

      // Final stats
      const finalNodes = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
      const finalEdges = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
      
      console.log(`✅ Simplified vertex-based approach completed successfully!`);
      console.log(`📊 Final network: ${finalNodes.rows[0].count} nodes, ${finalEdges.rows[0].count} edges`);
      
      return {
        success: true,
        stats: {
          nodesCreated: finalNodes.rows[0].count,
          edgesCreated: finalEdges.rows[0].count,
          isolatedNodes: 0,
          orphanedEdges: 0
        }
      };

    } catch (error) {
      console.error('❌ Simplified vertex-based approach failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error), 
        stats: { nodesCreated: 0, edgesCreated: 0, isolatedNodes: 0, orphanedEdges: 0 } 
      };
    }
  }
}


