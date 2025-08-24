#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { KspRouteGenerator, RoutePattern } from './src/utils/ksp-route-generator';

async function main() {
  console.log('🧪 Testing route generation with removed distance/elevation filtering...');
  
  // Connect to database
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    console.log(`🔧 Testing route generation on staging schema: ${stagingSchema}`);
    
    // Check if the staging schema has the required tables
    const tableCheck = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as ways_noded
    `);
    
    console.log(`📊 Staging schema stats: ${tableCheck.rows[0].nodes} nodes, ${tableCheck.rows[0].edges} edges, ${tableCheck.rows[0].ways_noded} ways_noded`);
    
    // Create KSP route generator with output config for loops only
    const routeGenerator = new KspRouteGenerator(pool, stagingSchema, {
      includeLoops: true,
      includePointToPoint: false,
      includeOutAndBack: false,
      includeLollipops: false
    });
    
    // Create test patterns to focus on Bear Canyon area
    const testPatterns: RoutePattern[] = [
      {
        pattern_name: 'Medium Loop',
        route_shape: 'loop',
        target_distance_km: 12.0, // Target the Bear Canyon loop distance (one-way)
        target_elevation_gain: 800,
        tolerance_percent: 50  // More permissive tolerance
      }
    ];
    
    const allRecommendations: any[] = [];
    
    // Generate routes for each pattern
    for (const pattern of testPatterns) {
      console.log(`🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m, ${pattern.route_shape})`);
      
      if (pattern.route_shape === 'loop') {
        console.log(`🔍 DEBUG: Pattern ${pattern.pattern_name} has route_shape: "${pattern.route_shape}"`);
        console.log(`🔄 Using pgr_dijkstra for loop routes`);
        
        // Generate loop routes with higher target to see complex loops
        const loopRoutes = await routeGenerator.generateLoopRoutes(pattern, 10); // Increased from 5 to 10
        allRecommendations.push(...loopRoutes);
        console.log(`✅ Generated ${loopRoutes.length} routes for ${pattern.pattern_name} (${pattern.route_shape})`);
      }
    }
    
    console.log(`✅ Generated ${allRecommendations.length} route recommendations`);
    
    // Also generate the specialized Bear Canyon loop
    console.log(`\n🎯 Generating specialized Bear Canyon loop...`);
    const bearCanyonPattern = testPatterns[0]; // Use the Medium Loop pattern
    const bearCanyonRoutes = await routeGenerator.generateBearCanyonLoop(bearCanyonPattern);
    
    console.log(`✅ Generated ${bearCanyonRoutes.length} Bear Canyon loop recommendations`);
    
    // Combine all recommendations
    const allRecommendationsWithBearCanyon = [...allRecommendations, ...bearCanyonRoutes];
    
    // Store the recommendations in the database
    console.log(`💾 Storing ${allRecommendationsWithBearCanyon.length} route recommendations in staging schema...`);
    await routeGenerator.storeRouteRecommendations(allRecommendationsWithBearCanyon);
    
    // Log some details about the recommendations
    allRecommendations.forEach((rec: any, index: number) => {
      console.log(`${index + 1}. ${rec.route_name} (${rec.route_shape}) - ${rec.recommended_length_km.toFixed(2)}km, ${rec.recommended_elevation_gain.toFixed(0)}m`);
    });
    
    // Check for Bear Canyon routes specifically
    const bearRoutes = allRecommendationsWithBearCanyon.filter((rec: any) => 
      rec.route_name.toLowerCase().includes('bear canyon') || 
      rec.route_name.toLowerCase().includes('bear peak') ||
      rec.route_name.toLowerCase().includes('complex loop')
    );
    
    console.log(`\n🔍 Found ${bearRoutes.length} Bear Canyon/Bear Peak routes:`);
    bearRoutes.forEach((rec: any, index: number) => {
      console.log(`${index + 1}. ${rec.route_name} (${rec.route_shape}) - ${rec.recommended_length_km.toFixed(2)}km, ${rec.recommended_elevation_gain.toFixed(0)}m`);
    });
    
  } catch (error) {
    console.error('❌ Error testing route generation:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
