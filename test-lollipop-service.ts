#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGenerator, RoutePattern } from './src/utils/lollipop-route-generator';

async function main() {
  console.log('🍭 Testing Lollipop Route Generation Service...');
  
  // Connect to database
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    // Use the bear_canyon_test schema for testing
    const stagingSchema = 'bear_canyon_test';
    
    console.log(`🔧 Testing lollipop service on staging schema: ${stagingSchema}`);
    
    // Check if the staging schema has the required tables
    const tableCheck = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.route_recommendations) as existing_routes
    `);
    
    console.log(`📊 Staging schema stats: ${tableCheck.rows[0].nodes} nodes, ${tableCheck.rows[0].edges} edges, ${tableCheck.rows[0].existing_routes} existing routes`);
    
    // Create Lollipop Route Generator
    const lollipopGenerator = new LollipopRouteGenerator(pool, stagingSchema);
    
    // Create test patterns for lollipop generation
    const testPatterns: RoutePattern[] = [
      {
        pattern_name: 'Bear Canyon Lollipop',
        route_shape: 'loop',
        target_distance_km: 15.0,
        target_elevation_gain: 800,
        tolerance_percent: 50
      },
      {
        pattern_name: 'Medium Lollipop',
        route_shape: 'loop',
        target_distance_km: 12.0,
        target_elevation_gain: 600,
        tolerance_percent: 50
      }
    ];
    
    // Generate lollipop routes
    console.log('\n🎯 Generating lollipop routes...');
    const lollipopRecommendations = await lollipopGenerator.generateLollipopRoutes(testPatterns);
    
    console.log(`✅ Generated ${lollipopRecommendations.length} lollipop route recommendations`);
    
    // Store the recommendations
    if (lollipopRecommendations.length > 0) {
      await lollipopGenerator.storeRouteRecommendations(lollipopRecommendations);
    }
    
    // Display the results
    console.log('\n📋 Lollipop Route Recommendations:');
    lollipopRecommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.route_name}`);
      console.log(`   Length: ${rec.recommended_length_km.toFixed(2)}km`);
      console.log(`   Elevation: ${rec.recommended_elevation_gain.toFixed(0)}m`);
      console.log(`   Trail Count: ${rec.trail_count}`);
      console.log(`   Route UUID: ${rec.route_uuid}`);
      console.log('');
    });
    
    // Check for Bear Canyon specific routes
    const bearCanyonRoutes = lollipopRecommendations.filter(rec => 
      rec.route_name.toLowerCase().includes('bear canyon')
    );
    
    console.log(`🔍 Found ${bearCanyonRoutes.length} Bear Canyon lollipop routes:`);
    bearCanyonRoutes.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.route_name}: ${rec.recommended_length_km.toFixed(2)}km, ${rec.recommended_elevation_gain.toFixed(0)}m`);
    });
    
  } catch (error) {
    console.error('❌ Error testing lollipop service:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
