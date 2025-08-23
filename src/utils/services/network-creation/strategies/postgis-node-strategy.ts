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

      // Step 1: Extract all unique vertices from trail endpoints
      console.log('📍 Step 1: Extracting all unique vertices from trail endpoints...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.all_vertices`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.all_vertices AS
        WITH trail_endpoints AS (
          SELECT 
            id as trail_id,
            app_uuid as trail_uuid,
            name as trail_name,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point
          FROM ${stagingSchema}.trails
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        all_points AS (
          SELECT ST_SnapToGrid(start_point, 0.000045) as snapped_point FROM trail_endpoints  -- 5m tolerance
          UNION ALL
          SELECT ST_SnapToGrid(end_point, 0.000045) as snapped_point FROM trail_endpoints   -- 5m tolerance
        ),
        unique_vertices AS (
          SELECT 
            snapped_point,
            COUNT(*) as usage_count
          FROM all_points
          GROUP BY snapped_point
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY snapped_point) as id,
          snapped_point as the_geom,
          ST_X(snapped_point) as x,
          ST_Y(snapped_point) as y,
          usage_count,
          CASE 
            WHEN usage_count >= 3 THEN 'intersection'
            WHEN usage_count = 2 THEN 'connector'
            ELSE 'endpoint'
          END as node_type
        FROM unique_vertices
      `);
      
      const verticesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.all_vertices`);
      console.log(`📍 Extracted ${verticesCount.rows[0].count} unique vertices`);

      // Step 2: Create edges directly from trails with snapped geometries
      console.log('🛤️ Step 2: Creating edges from trails with vertex snapping...');
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        WITH trail_edges AS (
        SELECT 
            t.id,
            t.app_uuid,
            t.name,
            t.app_uuid as original_trail_uuid,
            t.name as original_trail_name,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.source as trail_source,
            -- Find closest vertices and snap trail geometry to them
            (SELECT v.id FROM ${stagingSchema}.all_vertices v 
             ORDER BY ST_Distance(ST_StartPoint(t.geometry), v.the_geom) 
             LIMIT 1) as source,
            (SELECT v.id FROM ${stagingSchema}.all_vertices v 
             ORDER BY ST_Distance(ST_EndPoint(t.geometry), v.the_geom) 
             LIMIT 1) as target,
            -- Snap trail geometry to vertices
            (SELECT 
               CASE 
                 WHEN ST_NumPoints(t.geometry) = 2 THEN 
                   -- For simple 2-point lines, replace endpoints entirely
                   ST_MakeLine(
                     (SELECT v1.the_geom FROM ${stagingSchema}.all_vertices v1 
                      ORDER BY ST_Distance(ST_StartPoint(t.geometry), v1.the_geom) LIMIT 1),
                     (SELECT v2.the_geom FROM ${stagingSchema}.all_vertices v2 
                      ORDER BY ST_Distance(ST_EndPoint(t.geometry), v2.the_geom) LIMIT 1)
                   )
                 ELSE
                   -- For complex geometries, snap just the endpoints
                   ST_SetPoint(
                     ST_SetPoint(
                       t.geometry,
                       0,  -- First point
                       (SELECT v1.the_geom FROM ${stagingSchema}.all_vertices v1 
                        ORDER BY ST_Distance(ST_StartPoint(t.geometry), v1.the_geom) LIMIT 1)
                     ),
                     ST_NumPoints(t.geometry) - 1,  -- Last point
                     (SELECT v2.the_geom FROM ${stagingSchema}.all_vertices v2 
                      ORDER BY ST_Distance(ST_EndPoint(t.geometry), v2.the_geom) LIMIT 1)
                   )
               END
            ) as the_geom
          FROM ${stagingSchema}.trails t
          WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        )
        SELECT * FROM trail_edges
        WHERE source IS NOT NULL AND target IS NOT NULL AND source != target
      `);

      const edgesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
      console.log(`🛤️ Created ${edgesCount.rows[0].count} edges`);

      // Step 3: Create vertices table from all_vertices
      console.log('📍 Step 3: Creating vertices table...');
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

      // Step 4: Calculate vertex degrees
      console.log('🔗 Step 4: Calculating vertex degrees...');
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

      // Step 5: Create routing_nodes table
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
          'intersection' as node_type,
          v.cnt as connected_trails
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        ORDER BY v.id
      `);

      // Step 6: Create routing_edges table
      console.log('🛤️ Step 6: Creating routing_edges table...');
        await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${stagingSchema}.routing_edges (
          id INTEGER PRIMARY KEY,
          from_node_id INTEGER NOT NULL,
          to_node_id INTEGER NOT NULL,
          trail_id TEXT,
          trail_name TEXT,
          length_km DOUBLE PRECISION NOT NULL,
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
          id, from_node_id, to_node_id, trail_id, trail_name, length_km, 
          elevation_gain, elevation_loss, geometry
        )
        SELECT 
          id,
          source as from_node_id,
          target as to_node_id,
          original_trail_uuid as trail_id,
          original_trail_name as trail_name,
          COALESCE(length_km, 0) as length_km,
          COALESCE(elevation_gain, 0) as elevation_gain,
          COALESCE(elevation_loss, 0) as elevation_loss,
          ST_Force2D(the_geom) as geometry
        FROM ${stagingSchema}.ways_noded
        ORDER BY id
      `);

      // Step 7: Create edge_trail_composition table for export compatibility
      console.log('📋 Step 7: Creating edge_trail_composition table...');
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${stagingSchema}.edge_trail_composition AS
        SELECT 
          e.id as edge_id,
          e.app_uuid as trail_uuid,
          e.name as trail_name,
          e.length_km as distance_km,
          COALESCE(e.elevation_gain, 0) as elevation_gain,
          COALESCE(e.elevation_loss, 0) as elevation_loss,
          'primary' as composition_type,
          1 as segment_sequence,
          100.0 as segment_percentage
        FROM ${stagingSchema}.ways_noded e
        ORDER BY e.id
      `);

      const compositionCount = await pgClient.query(`SELECT COUNT(*) as c FROM ${stagingSchema}.edge_trail_composition`);
      console.log(`📋 Created edge_trail_composition table with ${compositionCount.rows[0].c} rows`);

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


