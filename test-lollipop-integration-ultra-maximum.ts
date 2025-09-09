#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from './src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testLollipopIntegrationUltraMaximum() {
  console.log('🚀 Testing LollipopRouteGeneratorService for ULTRA-MAXIMUM LENGTH routes...');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-ultra-maximum.ts <schema_name>');
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
  console.log(`   • Script: test-lollipop-integration-ultra-maximum.ts`);
  console.log(`   • Target: ULTRA-MAXIMUM LENGTH route discovery (200km target)`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // ULTRA-AGGRESSIVE configuration to find the absolute longest routes
    const lollipopService = new LollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 200, // Pushed to 200km to find network limits
      maxAnchorNodes: 100, // Explore ALL high-degree nodes
      maxReachableNodes: 100, // Explore maximum destination options
      maxDestinationExploration: 50, // Maximum thoroughness
      distanceRangeMin: 0.3, // Allow shorter outbound legs (30% of target)
      distanceRangeMax: 1.0, // Allow return legs up to 100% of target
      edgeOverlapThreshold: 50, // Allow up to 50% overlap for longer routes
      kspPaths: 25, // Maximum path exploration
      minOutboundDistance: 10, // Lower minimum outbound distance
      outputPath: 'test-output'
    });

    console.log('🚀 Generating ULTRA-MAXIMUM LENGTH lollipop routes...');
    console.log('⚠️  This may take much longer due to extreme exploration...');
    
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      console.log('📊 ALL routes sorted by length (showing top 30):');
      const sortedRoutes = lollipopRoutes.sort((a, b) => b.total_distance - a.total_distance);
      
      sortedRoutes.slice(0, 30).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
      });

      // Detailed statistics for ultra-maximum route discovery
      const ultraLongRoutes = lollipopRoutes.filter(r => r.total_distance >= 150);
      const extremeRoutes = lollipopRoutes.filter(r => r.total_distance >= 200);
      const networkLimitRoutes = lollipopRoutes.filter(r => r.total_distance >= 250);
      
      console.log(`\n📈 ULTRA-MAXIMUM ROUTE DISCOVERY STATISTICS:`);
      console.log(`   • Total routes found: ${lollipopRoutes.length}`);
      console.log(`   • Routes ≥150km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥200km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥250km: ${networkLimitRoutes.length}`);
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
testLollipopIntegrationUltraMaximum().catch(console.error);

