#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorServiceLengthFirst } from '../src/services/layer3/LollipopRouteGeneratorServiceLengthFirst';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

async function testLollipopIntegrationLengthFirst() {
  console.log('🚀 Testing LollipopRouteGeneratorService for LENGTH-FIRST route discovery...');
  console.log('🎯 Strategy: Find ALL routes first, then keep only the longest ones');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-LENGTH-FIRST.ts <schema_name>');
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
  console.log(`   • Script: test-lollipop-integration-LENGTH-FIRST.ts`);
  console.log(`   • Strategy: LENGTH-FIRST discovery (no filtering during search)`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // LENGTH-FIRST configuration - prioritize finding ALL routes, then filter by length
    const lollipopService = new LollipopRouteGeneratorServiceLengthFirst(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 400, // Very high target to not limit discovery
      maxAnchorNodes: 300, // Explore ALL possible anchor nodes
      maxReachableNodes: 300, // Explore ALL possible destinations
      maxDestinationExploration: 150, // Maximum thoroughness
      distanceRangeMin: 0.1, // Allow very short outbound legs (10% of target)
      distanceRangeMax: 1.5, // Allow return legs up to 150% of target
      edgeOverlapThreshold: 95, // Allow up to 95% overlap (almost no filtering)
      kspPaths: 100, // Maximum path exploration
      minOutboundDistance: 1, // Very low minimum outbound distance
      outputPath: 'test-output'
    });

    console.log('🚀 Generating LENGTH-FIRST lollipop routes...');
    console.log('🎯 Strategy: Collect ALL routes, then keep only the longest ones');
    console.log('   • 300 anchor nodes (explore everything)');
    console.log('   • 300 reachable nodes per anchor (explore everything)');
    console.log('   • 150 destinations per anchor (maximum thoroughness)');
    console.log('   • 100 KSP paths (maximum path exploration)');
    console.log('   • 95% overlap threshold (almost no filtering)');
    console.log('   • 1km minimum outbound (very low threshold)');
    console.log('   • 400km target distance (no discovery limits)');
    console.log('');
    
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      // Sort by length and show statistics
      const sortedRoutes = lollipopRoutes.sort((a, b) => b.total_distance - a.total_distance);
      
      console.log('📊 ALL routes sorted by length (showing top 100):');
      sortedRoutes.slice(0, 100).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
      });

      // Keep only the top 7 longest routes
      const topRoutes = sortedRoutes.slice(0, 7);
      
      console.log(`\n🎯 LENGTH-FIRST FILTERING RESULTS:`);
      console.log(`   • Total routes discovered: ${lollipopRoutes.length}`);
      console.log(`   • Routes kept (top 7 by length): ${topRoutes.length}`);
      console.log(`   • Longest route: ${topRoutes[0].total_distance.toFixed(2)}km`);
      console.log(`   • Shortest kept route: ${topRoutes[topRoutes.length - 1].total_distance.toFixed(2)}km`);
      
      // Check for Shadow Canyon routes specifically
      const shadowCanyonRoutes = topRoutes.filter(route => 
        route.route_shape && 
        (route.route_shape.includes('Shadow') || route.route_shape.includes('shadow'))
      );
      
      if (shadowCanyonRoutes.length > 0) {
        console.log(`\n🏔️  SHADOW CANYON ROUTES FOUND: ${shadowCanyonRoutes.length}`);
        shadowCanyonRoutes.forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km - Anchor ${route.anchor_node} → ${route.dest_node}`);
        });
      } else {
        console.log(`\n⚠️  No Shadow Canyon routes found in top 7 routes`);
        console.log(`   Checking all routes for Shadow Canyon...`);
        
        const allShadowCanyonRoutes = lollipopRoutes.filter(route => 
          route.route_shape && 
          (route.route_shape.includes('Shadow') || route.route_shape.includes('shadow'))
        );
        
        if (allShadowCanyonRoutes.length > 0) {
          console.log(`   Found ${allShadowCanyonRoutes.length} Shadow Canyon routes in all discovered routes:`);
          allShadowCanyonRoutes.forEach((route, index) => {
            console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km - Anchor ${route.anchor_node} → ${route.dest_node}`);
          });
        } else {
          console.log(`   No Shadow Canyon routes found in any discovered routes`);
        }
      }

      // Detailed statistics
      const ultraLongRoutes = topRoutes.filter(r => r.total_distance >= 150);
      const extremeRoutes = topRoutes.filter(r => r.total_distance >= 200);
      const networkLimitRoutes = topRoutes.filter(r => r.total_distance >= 250);
      
      console.log(`\n📈 LENGTH-FIRST ROUTE STATISTICS:`);
      console.log(`   • Routes ≥150km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥200km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥250km: ${networkLimitRoutes.length}`);
      console.log(`   • Average distance (top 7): ${(topRoutes.reduce((sum, r) => sum + r.total_distance, 0) / topRoutes.length).toFixed(2)}km`);
      console.log(`   • MAXIMUM distance found: ${Math.max(...topRoutes.map(r => r.total_distance)).toFixed(2)}km`);
      
      // Show the absolute longest route details
      const longestRoute = topRoutes[0];
      console.log(`\n🏆 LONGEST ROUTE DISCOVERED:`);
      console.log(`   • Total Distance: ${longestRoute.total_distance.toFixed(2)}km`);
      console.log(`   • Outbound: ${longestRoute.outbound_distance.toFixed(2)}km`);
      console.log(`   • Return: ${longestRoute.return_distance.toFixed(2)}km`);
      console.log(`   • Anchor Node: ${longestRoute.anchor_node}`);
      console.log(`   • Destination Node: ${longestRoute.dest_node}`);
      console.log(`   • Edge Overlap: ${longestRoute.edge_overlap_percentage.toFixed(1)}%`);

      // Save to database (only the top 7 routes)
      await lollipopService.saveToDatabase(topRoutes);
      console.log('💾 Top 7 routes saved to database');

      // Export to GeoJSON (only the top 7 routes)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = `test-output/lollipop-routes-${schema}-${timestamp}.geojson`;
      await lollipopService.exportToGeoJSON(topRoutes, outputFile);
      console.log(`📁 Top 7 routes exported to: ${outputFile}`);

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
testLollipopIntegrationLengthFirst().catch(console.error);
