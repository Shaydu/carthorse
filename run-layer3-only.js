#!/usr/bin/env node

/**
 * Run Layer 3 (route generation) only on existing staging schema
 * This script will generate routes using the existing staging schema data
 */

const { Pool } = require('pg');
const { RouteGenerationOrchestratorService } = require('./dist/utils/services/route-generation-orchestrator-service');
const { RouteDiscoveryConfigLoader } = require('./dist/config/route-discovery-config-loader');

async function runLayer3Only() {
  console.log('🚀 Running Layer 3 (route generation) only...');
  
  // Use the existing staging schema that has data
  const stagingSchema = 'carthorse_1755625330130';
  console.log(`📋 Using existing staging schema: ${stagingSchema}`);
  
  // Get database configuration
  const dbConfig = {
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  };
  
  const pgClient = new Pool(dbConfig);
  
  try {
    // Verify the staging schema has data
    const trailsCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    const waysCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded`);
    const verticesCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded_vertices_pgr`);
    
    console.log(`📊 Staging schema data:`);
    console.log(`   - Trails: ${trailsCount.rows[0].count}`);
    console.log(`   - Ways: ${waysCount.rows[0].count}`);
    console.log(`   - Vertices: ${verticesCount.rows[0].count}`);
    
    if (parseInt(trailsCount.rows[0].count) === 0) {
      throw new Error('No trails found in staging schema');
    }
    
    if (parseInt(waysCount.rows[0].count) === 0) {
      throw new Error('No ways_noded found in staging schema - Layer 2 may not have completed');
    }
    
    // Load route discovery configuration
    const configLoader = RouteDiscoveryConfigLoader.getInstance();
    const routeDiscoveryConfig = configLoader.loadConfig();
    
    console.log(`📋 Route discovery configuration loaded`);
    
    // Create route generation service
    const routeGenerationService = new RouteGenerationOrchestratorService(pgClient, {
      stagingSchema: stagingSchema,
      region: 'boulder',
      targetRoutesPerPattern: routeDiscoveryConfig.routeGeneration?.ksp?.targetRoutesPerPattern || 100,
      minDistanceBetweenRoutes: routeDiscoveryConfig.routing.minDistanceBetweenRoutes,
      kspKValue: routeDiscoveryConfig.routing.kspKValue,
      generateKspRoutes: true,
      generateLoopRoutes: true,
      generateLollipopRoutes: routeDiscoveryConfig.routeGeneration?.lollipops?.enabled !== false,
      useUnifiedNetwork: routeDiscoveryConfig.routeGeneration?.unifiedNetwork?.enabled || false,
      useTrailheadsOnly: routeDiscoveryConfig.trailheads.enabled,
      loopConfig: {
        useHawickCircuits: routeDiscoveryConfig.routeGeneration?.loops?.useHawickCircuits !== false,
        targetRoutesPerPattern: routeDiscoveryConfig.routeGeneration?.loops?.targetRoutesPerPattern || 50,
        elevationGainRateWeight: routeDiscoveryConfig.routeGeneration?.unifiedNetwork?.elevationGainRateWeight || 0.7,
        distanceWeight: routeDiscoveryConfig.routeGeneration?.unifiedNetwork?.distanceWeight || 0.3
      },
      lollipopConfig: {
        targetRoutesPerPattern: routeDiscoveryConfig.routeGeneration?.lollipops?.targetRoutesPerPattern || 20,
        minLollipopDistance: routeDiscoveryConfig.routeGeneration?.lollipops?.minLollipopDistance || 3.0,
        maxLollipopDistance: routeDiscoveryConfig.routeGeneration?.lollipops?.maxLollipopDistance || 20.0
      }
    });
    
    console.log('🎯 Starting route generation...');
    
    // Generate all routes
    const result = await routeGenerationService.generateAllRoutes();
    
    console.log(`✅ Route generation completed:`);
    console.log(`   - KSP routes: ${result.kspRoutes.length}`);
    console.log(`   - Loop routes: ${result.loopRoutes.length}`);
    console.log(`   - Lollipop routes: ${result.lollipopRoutes.length}`);
    console.log(`   - Total routes: ${result.totalRoutes}`);
    
    // Check the actual counts in the database
    const kspCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.route_recommendations WHERE route_type = 'ksp' OR route_shape = 'out-and-back'`);
    const loopCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.route_recommendations WHERE route_type = 'loop' OR route_shape = 'loop'`);
    const totalCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.route_recommendations`);
    
    console.log(`📊 Database verification:`);
    console.log(`   - KSP routes in DB: ${kspCount.rows[0].count}`);
    console.log(`   - Loop routes in DB: ${loopCount.rows[0].count}`);
    console.log(`   - Total routes in DB: ${totalCount.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Layer 3 generation failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the script
runLayer3Only().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

