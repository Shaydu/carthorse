#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { KspRouteGenerator, RoutePattern } from './src/utils/ksp-route-generator';

async function main() {
  console.log('🧪 Testing Bear Canyon loop detection in full pipeline data...');
  
  // Connect to database
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    // Find the latest staging schema
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
    console.log(`🔧 Testing on latest staging schema: ${stagingSchema}`);
    
    // Check if the staging schema has the required tables
    const tableCheck = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.route_recommendations) as existing_routes
    `);
    
    console.log(`📊 Staging schema stats: ${tableCheck.rows[0].nodes} nodes, ${tableCheck.rows[0].edges} edges, ${tableCheck.rows[0].existing_routes} existing routes`);
    
    // Check if Bear Canyon trails exist in the full dataset
    console.log('\n🔍 Checking for Bear Canyon trails in full dataset:');
    const bearCanyonTrailsResult = await pool.query(`
      SELECT DISTINCT trail_name, COUNT(*) as segment_count
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Canyon%' OR trail_name LIKE '%Bear Peak%' OR trail_name LIKE '%Fern Canyon%'
      GROUP BY trail_name
      ORDER BY trail_name
    `);
    
    console.log(`📋 Found ${bearCanyonTrailsResult.rows.length} Bear Canyon related trails:`);
    bearCanyonTrailsResult.rows.forEach((row: any) => {
      console.log(`   ${row.trail_name}: ${row.segment_count} segments`);
    });
    
    // Check if there are any existing route recommendations
    const existingRoutesResult = await pool.query(`
      SELECT route_name, recommended_length_km, recommended_elevation_gain
      FROM ${stagingSchema}.route_recommendations
      WHERE route_name LIKE '%Bear Canyon%' OR route_name LIKE '%Bear Peak%' OR route_name LIKE '%Fern Canyon%'
      ORDER BY recommended_length_km DESC
    `);
    
    console.log(`\n🔍 Found ${existingRoutesResult.rows.length} existing Bear Canyon related routes:`);
    existingRoutesResult.rows.forEach((row: any) => {
      console.log(`   ${row.route_name}: ${row.recommended_length_km.toFixed(2)}km, ${row.recommended_elevation_gain.toFixed(0)}m`);
    });
    
    // Test the current route generation on the full dataset
    console.log('\n🧪 Testing current route generation on full dataset...');
    
    const routeGenerator = new KspRouteGenerator(pool, stagingSchema, {
      includeLoops: true,
      includePointToPoint: false,
      includeOutAndBack: false,
      includeLollipops: false
    });
    
    const testPatterns: RoutePattern[] = [
      {
        pattern_name: 'Bear Canyon Loop Test',
        route_shape: 'loop',
        target_distance_km: 15.0,
        target_elevation_gain: 800,
        tolerance_percent: 50
      }
    ];
    
    // Generate routes using current logic
    const recommendations = await routeGenerator.generateRouteRecommendations();
    
    console.log(`\n✅ Generated ${recommendations.length} route recommendations with current logic`);
    
    // Check for Bear Canyon routes
    const bearCanyonRoutes = recommendations.filter(rec => 
      rec.route_name.toLowerCase().includes('bear canyon') || 
      rec.route_name.toLowerCase().includes('bear peak') ||
      rec.route_name.toLowerCase().includes('fern canyon')
    );
    
    console.log(`🔍 Found ${bearCanyonRoutes.length} Bear Canyon related routes with current logic:`);
    bearCanyonRoutes.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.route_name}: ${rec.recommended_length_km.toFixed(2)}km, ${rec.recommended_elevation_gain.toFixed(0)}m`);
    });
    
    // Test the specialized Bear Canyon loop generation
    console.log('\n🎯 Testing specialized Bear Canyon loop generation on full dataset...');
    const bearCanyonPattern = testPatterns[0];
    const specializedRoutes = await routeGenerator.generateBearCanyonLoop(bearCanyonPattern);
    
    console.log(`✅ Generated ${specializedRoutes.length} specialized Bear Canyon loop recommendations`);
    specializedRoutes.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.route_name}: ${rec.recommended_length_km.toFixed(2)}km, ${rec.recommended_elevation_gain.toFixed(0)}m`);
    });
    
  } catch (error) {
    console.error('❌ Error testing full pipeline data:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
