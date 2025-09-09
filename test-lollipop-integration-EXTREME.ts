#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from './src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testLollipopIntegrationEXTREME() {
  console.log('🚀 Testing LollipopRouteGeneratorService for EXTREME LENGTH routes...');
  console.log('⚠️  This will push ALL parameters to their absolute limits!');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-EXTREME.ts <schema_name>');
    process.exit(1);
  }

  // Get metadata information
  const { execSync } = require('child_process');
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let runTimestamp = new Date().toISOString();
  
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.log('⚠️  Could not get git information');
  }

  console.log('\n📋 METADATA:');
  console.log(`   • Schema: ${schema}`);
  console.log(`   • Git Commit: ${gitCommit}`);
  console.log(`   • Git Branch: ${gitBranch}`);
  console.log(`   • Run Timestamp: ${runTimestamp}`);
  console.log(`   • Script: test-lollipop-integration-EXTREME.ts`);
  console.log(`   • Target: EXTREME LENGTH route discovery (300km+ target)`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // EXTREME configuration - pushing ALL parameters to their absolute limits
    const lollipopService = new LollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 300, // Pushed to 300km to find absolute network limits
      maxAnchorNodes: 200, // Explore ALL possible anchor nodes (doubled)
      maxReachableNodes: 200, // Explore maximum possible destinations (doubled)
      maxDestinationExploration: 100, // Maximum thoroughness (doubled)
      distanceRangeMin: 0.2, // Allow even shorter outbound legs (20% of target)
      distanceRangeMax: 1.2, // Allow return legs up to 120% of target
      edgeOverlapThreshold: 80, // Allow up to 80% overlap for extreme routes
      kspPaths: 50, // Maximum path exploration (doubled)
      minOutboundDistance: 5, // Lower minimum outbound distance (halved)
      outputPath: 'test-output'
    });

    console.log('🚀 Generating EXTREME LENGTH lollipop routes...');
    console.log('⚠️  This will take a VERY long time due to extreme exploration...');
    console.log('   • 200 anchor nodes (vs. 100)');
    console.log('   • 200 reachable nodes per anchor (vs. 100)');
    console.log('   • 100 destinations per anchor (vs. 50)');
    console.log('   • 50 KSP paths (vs. 25)');
    console.log('   • 80% overlap threshold (vs. 50%)');
    console.log('   • 5km minimum outbound (vs. 10km)');
    console.log('   • 300km target distance (vs. 200km)');
    console.log('');
    
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      console.log('📊 ALL routes sorted by length (showing top 50):');
      const sortedRoutes = lollipopRoutes.sort((a, b) => b.total_distance - a.total_distance);
      
      sortedRoutes.slice(0, 50).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
      });

      // Detailed statistics for extreme route discovery
      const ultraLongRoutes = lollipopRoutes.filter(r => r.total_distance >= 150);
      const extremeRoutes = lollipopRoutes.filter(r => r.total_distance >= 200);
      const networkLimitRoutes = lollipopRoutes.filter(r => r.total_distance >= 250);
      const absoluteLimitRoutes = lollipopRoutes.filter(r => r.total_distance >= 300);
      
      console.log(`\n📈 EXTREME ROUTE DISCOVERY STATISTICS:`);
      console.log(`   • Total routes found: ${lollipopRoutes.length}`);
      console.log(`   • Routes ≥150km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥200km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥250km: ${networkLimitRoutes.length}`);
      console.log(`   • Routes ≥300km: ${absoluteLimitRoutes.length}`);
      console.log(`   • Average distance: ${(lollipopRoutes.reduce((sum, r) => sum + r.total_distance, 0) / lollipopRoutes.length).toFixed(2)}km`);
      console.log(`   • MAXIMUM distance found: ${Math.max(...lollipopRoutes.map(r => r.total_distance)).toFixed(2)}km`);
      console.log(`   • Median distance: ${sortedRoutes[Math.floor(sortedRoutes.length / 2)].total_distance.toFixed(2)}km`);
      
      // Show the absolute longest route details
      const longestRoute = sortedRoutes[0];
      console.log(`\n🏆 LONGEST ROUTE DISCOVERED:`);
      console.log(`   • Total Distance: ${longestRoute.total_distance.toFixed(2)}km`);
      console.log(`   • Outbound: ${longestRoute.outbound_distance.toFixed(2)}km`);
      console.log(`   • Return: ${longestRoute.return_distance.toFixed(2)}km`);
      console.log(`   • Anchor Node: ${longestRoute.anchor_node}`);
      console.log(`   • Destination Node: ${longestRoute.dest_node}`);
      console.log(`   • Edge Overlap: ${longestRoute.edge_overlap_percentage.toFixed(1)}%`);

      // Save to database
      await lollipopService.saveToDatabase(lollipopRoutes);
      console.log('💾 Routes saved to database');

      // Export to GeoJSON
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = `test-output/lollipop-routes-${schema}-${timestamp}.geojson`;
      await lollipopService.exportToGeoJSON(lollipopRoutes, outputFile);
      console.log(`📁 Routes exported to: ${outputFile}`);

    } else {
      console.log('❌ No lollipop routes found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the test
testLollipopIntegrationEXTREME().catch(console.error);

