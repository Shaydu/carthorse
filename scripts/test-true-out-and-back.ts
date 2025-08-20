#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { KspRouteGenerator } from '../src/utils/ksp-route-generator';

async function testTrueOutAndBackRoutes() {
  const config = {
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.POSTGRES_PASSWORD || ''
  };

  const pgClient = new Pool(config);
  
  try {
    console.log('🧪 Testing TRUE out-and-back route generation...');
    
    // Use the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE schemaname LIKE 'carthorse_%' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      throw new Error('No staging schema found');
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Create the route generator
    const routeGenerator = new KspRouteGenerator(pgClient, stagingSchema);
    
    // Test pattern for out-and-back routes
    const testPattern = {
      pattern_name: 'Test Out-and-Back',
      target_distance_km: 10.0,
      target_elevation_gain: 500,
      route_shape: 'out-and-back',
      tolerance_percent: 20
    };
    
    console.log(`🎯 Testing pattern: ${testPattern.pattern_name} (${testPattern.target_distance_km}km, ${testPattern.target_elevation_gain}m)`);
    
    // Generate true out-and-back routes
    const routes = await routeGenerator.generateTrueOutAndBackRoutes(testPattern, 3);
    
    console.log(`\n✅ Generated ${routes.length} true out-and-back routes:`);
    
    for (const route of routes) {
      console.log(`\n🛤️ Route: ${route.route_name}`);
      console.log(`   Distance: ${route.recommended_length_km.toFixed(2)}km`);
      console.log(`   Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
      console.log(`   Score: ${route.route_score}`);
      console.log(`   Trail count: ${route.trail_count}`);
      
      // Check if the route path has both outbound and return steps
      if (route.route_path && route.route_path.steps) {
        const totalSteps = route.route_path.steps.length;
        const outboundSteps = Math.floor(totalSteps / 2);
        console.log(`   Path steps: ${totalSteps} total (${outboundSteps} outbound + ${outboundSteps} return)`);
        
        // Verify the return path is a reverse of the outbound path
        const outbound = route.route_path.steps.slice(0, outboundSteps);
        const returnPath = route.route_path.steps.slice(outboundSteps);
        
        if (outbound.length > 0 && returnPath.length > 0) {
          const outboundStart = outbound[0]?.node;
          const outboundEnd = outbound[outbound.length - 1]?.node;
          const returnStart = returnPath[0]?.node;
          const returnEnd = returnPath[returnPath.length - 1]?.node;
          
          console.log(`   Path verification: ${outboundStart} → ${outboundEnd} → ${returnStart} → ${returnEnd}`);
          
          if (outboundEnd === returnStart && returnEnd === outboundStart) {
            console.log(`   ✅ Path is properly out-and-back!`);
          } else {
            console.log(`   ⚠️ Path may not be properly connected`);
          }
        }
      }
    }
    
    console.log(`\n🎉 Test completed successfully!`);
    
  } catch (error) {
    console.error(`❌ Test failed: ${error}`);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testTrueOutAndBackRoutes().catch(console.error);
