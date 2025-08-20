#!/usr/bin/env node

/**
 * Debug script to investigate out-and-back routes issue
 * 
 * This script helps identify why out-and-back routes are not being exported to GeoJSON
 * and why they're missing geometry.
 */

const { Pool } = require('pg');
const fs = require('fs');

// Database configuration - update these values
const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'postgres',
  password: process.env.PGPASSWORD || 'your_password'
};

async function debugOutAndBackRoutes() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Debugging out-and-back routes issue...\n');
    
    // Get the most recent staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}\n`);
    
    // Check if route_recommendations table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'route_recommendations'
      ) as exists
    `, [stagingSchema]);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ route_recommendations table does not exist');
      return;
    }
    
    // Check route count and types
    const routeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_routes,
        COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
        COUNT(CASE WHEN route_geometry IS NOT NULL THEN 1 END) as routes_with_geometry,
        COUNT(CASE WHEN route_shape = 'out-and-back' AND route_geometry IS NOT NULL THEN 1 END) as out_and_back_with_geometry
      FROM ${stagingSchema}.route_recommendations
    `);
    
    const stats = routeStats.rows[0];
    console.log('📊 Route Statistics:');
    console.log(`   - Total routes: ${stats.total_routes}`);
    console.log(`   - Out-and-back routes: ${stats.out_and_back_routes}`);
    console.log(`   - Routes with geometry: ${stats.routes_with_geometry}`);
    console.log(`   - Out-and-back routes with geometry: ${stats.out_and_back_with_geometry}\n`);
    
    // Check specific out-and-back routes
    const outAndBackRoutes = await pool.query(`
      SELECT 
        route_uuid,
        route_name,
        route_type,
        route_shape,
        recommended_length_km,
        recommended_elevation_gain,
        route_score,
        route_geometry IS NOT NULL as has_geometry,
        route_edges IS NOT NULL as has_edges,
        route_path IS NOT NULL as has_path,
        created_at
      FROM ${stagingSchema}.route_recommendations
      WHERE route_shape = 'out-and-back'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log('🛤️ Out-and-back routes details:');
    outAndBackRoutes.rows.forEach((route, index) => {
      console.log(`   ${index + 1}. ${route.route_name}`);
      console.log(`      - UUID: ${route.route_uuid}`);
      console.log(`      - Type: ${route.route_type}, Shape: ${route.route_shape}`);
      console.log(`      - Distance: ${route.recommended_length_km?.toFixed(2)}km, Elevation: ${route.recommended_elevation_gain?.toFixed(0)}m`);
      console.log(`      - Score: ${route.route_score}`);
      console.log(`      - Has geometry: ${route.has_geometry}`);
      console.log(`      - Has edges: ${route.has_edges}`);
      console.log(`      - Has path: ${route.has_path}`);
      console.log(`      - Created: ${route.created_at}`);
      console.log('');
    });
    
    // Check ways_noded table for edge geometries
    const edgeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN the_geom IS NOT NULL THEN 1 END) as edges_with_geometry,
        COUNT(CASE WHEN the_geom IS NOT NULL AND ST_IsValid(the_geom) THEN 1 END) as valid_geometries
      FROM ${stagingSchema}.ways_noded
    `);
    
    const edgeStatsData = edgeStats.rows[0];
    console.log('🔗 Edge Statistics:');
    console.log(`   - Total edges: ${edgeStatsData.total_edges}`);
    console.log(`   - Edges with geometry: ${edgeStatsData.edges_with_geometry}`);
    console.log(`   - Valid geometries: ${edgeStatsData.valid_geometries}\n`);
    
    // Check if there are any routes with missing geometries
    const routesWithoutGeometry = await pool.query(`
      SELECT 
        route_uuid,
        route_name,
        route_shape,
        route_edges
      FROM ${stagingSchema}.route_recommendations
      WHERE route_geometry IS NULL
      LIMIT 5
    `);
    
    if (routesWithoutGeometry.rows.length > 0) {
      console.log('⚠️ Routes without geometry:');
      routesWithoutGeometry.rows.forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.route_name} (${route.route_uuid})`);
        console.log(`      - Shape: ${route.route_shape}`);
        console.log(`      - Edges: ${route.route_edges ? 'present' : 'missing'}`);
        console.log('');
      });
    }
    
    // Test geometry generation for a specific route
    if (outAndBackRoutes.rows.length > 0) {
      const testRoute = outAndBackRoutes.rows[0];
      console.log(`🧪 Testing geometry generation for route: ${testRoute.route_name}`);
      
      const routeDetails = await pool.query(`
        SELECT route_edges FROM ${stagingSchema}.route_recommendations WHERE route_uuid = $1
      `, [testRoute.route_uuid]);
      
      if (routeDetails.rows[0]?.route_edges) {
        const routeEdges = JSON.parse(routeDetails.rows[0].route_edges);
        console.log(`   - Route has ${routeEdges.length} edges`);
        
        // Extract edge IDs
        const edgeIds = routeEdges.map(edge => edge.id).filter(id => id !== null && id !== undefined);
        console.log(`   - Valid edge IDs: ${edgeIds.length}`);
        
        if (edgeIds.length > 0) {
          // Test geometry generation
          const geometryTest = await pool.query(`
            WITH route_edges AS (
              SELECT 
                id,
                the_geom,
                source,
                target,
                ROW_NUMBER() OVER (ORDER BY id) as edge_order
              FROM ${stagingSchema}.ways_noded
              WHERE id = ANY($1::integer[])
              AND the_geom IS NOT NULL
              ORDER BY id
            ),
            ordered_geometries AS (
              SELECT 
                the_geom,
                edge_order,
                CASE 
                  WHEN edge_order > (SELECT COUNT(*) FROM route_edges) / 2 THEN
                    ST_Reverse(the_geom)
                  ELSE
                    the_geom
                END as processed_geom
              FROM route_edges
            ),
            collected_geom AS (
              SELECT ST_Collect(processed_geom ORDER BY edge_order) as geom
              FROM ordered_geometries
            ),
            merged_geom AS (
              SELECT ST_LineMerge(geom) as route_geometry
              FROM collected_geom
            )
            SELECT 
              CASE 
                WHEN ST_GeometryType(route_geometry) = 'ST_MultiLineString' THEN
                  ST_LineMerge(route_geometry)
                ELSE 
                  route_geometry
              END as route_geometry
            FROM merged_geom
            WHERE route_geometry IS NOT NULL
          `, [edgeIds]);
          
          if (geometryTest.rows[0]?.route_geometry) {
            console.log(`   ✅ Geometry generation successful`);
            
            // Test GeoJSON conversion
            const geojsonTest = await pool.query(`
              SELECT ST_AsGeoJSON($1::geometry, 6, 0) as geojson
            `, [geometryTest.rows[0].route_geometry]);
            
            if (geojsonTest.rows[0]?.geojson) {
              const geojson = JSON.parse(geojsonTest.rows[0].geojson);
              console.log(`   ✅ GeoJSON conversion successful: ${geojson.coordinates?.length || 0} coordinate pairs`);
            } else {
              console.log(`   ❌ GeoJSON conversion failed`);
            }
          } else {
            console.log(`   ❌ Geometry generation failed`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    await pool.end();
  }
}

// Run the debug script
debugOutAndBackRoutes().catch(console.error);
