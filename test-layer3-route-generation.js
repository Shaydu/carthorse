#!/usr/bin/env node

const { Client } = require('pg');

async function testLayer3RouteGeneration() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🧪 Testing Layer 3 route generation...');

    const stagingSchema = 'carthorse_1755960268122';
    console.log(`📊 Using staging schema: ${stagingSchema}`);

    // Check if routing tables exist
    console.log('\n📋 Checking routing tables...');
    const routingTables = await client.query(`
      SELECT 
        COUNT(*) as routing_nodes,
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges) as routing_edges
      FROM ${stagingSchema}.routing_nodes
    `);
    
    console.log(`   Routing nodes: ${routingTables.rows[0].routing_nodes}`);
    console.log(`   Routing edges: ${routingTables.rows[0].routing_edges}`);

    if (routingTables.rows[0].routing_nodes === 0 || routingTables.rows[0].routing_edges === 0) {
      console.log('❌ No routing tables found - Layer 2 must be completed first');
      return;
    }

    // Test route generation using the RouteGenerationOrchestratorService
    console.log('\n🎯 Testing route generation with RouteGenerationOrchestratorService...');
    
    // Import the service
    const { RouteGenerationOrchestratorService } = require('./src/utils/services/route-generation-orchestrator-service.ts');
    
    const routeGenerationService = new RouteGenerationOrchestratorService(client, {
      stagingSchema: stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: 10, // Small number for testing
      minDistanceBetweenRoutes: 0.1,
      kspKValue: 3,
      generateKspRoutes: true,
      generateLoopRoutes: true,
      generateP2PRoutes: false,
      includeP2PRoutesInOutput: false,
      useTrailheadsOnly: false,
      loopConfig: {
        useHawickCircuits: true,
        targetRoutesPerPattern: 5,
        elevationGainRateWeight: 0.7,
        distanceWeight: 0.3
      }
    });

    console.log('🛤️ Starting route generation...');
    const result = await routeGenerationService.generateAllRoutes();
    
    console.log('\n✅ Route generation completed successfully!');
    console.log(`   Total routes: ${result.totalRoutes}`);
    console.log(`   Out-and-back routes: ${result.kspRoutes.length}`);
    console.log(`   Loop routes: ${result.loopRoutes.length}`);

    // Check if routes were stored in the database
    console.log('\n📊 Checking stored routes...');
    const storedRoutes = await client.query(`
      SELECT COUNT(*) as total_routes,
             COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
             COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes
      FROM ${stagingSchema}.route_recommendations
    `);
    
    console.log(`   Total stored routes: ${storedRoutes.rows[0].total_routes}`);
    console.log(`   Stored out-and-back routes: ${storedRoutes.rows[0].out_and_back_routes}`);
    console.log(`   Stored loop routes: ${storedRoutes.rows[0].loop_routes}`);

    if (storedRoutes.rows[0].total_routes > 0) {
      console.log('\n✅ SUCCESS: Layer 3 route generation is working!');
      
      // Show some example routes
      const exampleRoutes = await client.query(`
        SELECT route_name, route_shape, recommended_length_km, recommended_elevation_gain, route_score
        FROM ${stagingSchema}.route_recommendations
        ORDER BY route_score DESC
        LIMIT 5
      `);
      
      console.log('\n📋 Example routes generated:');
      exampleRoutes.rows.forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.route_name}`);
        console.log(`      Shape: ${route.route_shape}, Length: ${route.recommended_length_km.toFixed(1)}km, Elevation: ${route.recommended_elevation_gain}m, Score: ${route.route_score}`);
      });
      
    } else {
      console.log('\n❌ FAILURE: No routes were stored in the database');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await client.end();
  }
}

testLayer3RouteGeneration();
