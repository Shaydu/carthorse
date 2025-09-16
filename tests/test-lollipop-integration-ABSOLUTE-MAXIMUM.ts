#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorServiceLengthFirst } from '../src/services/layer3/LollipopRouteGeneratorServiceLengthFirst';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

async function testLollipopIntegrationAbsoluteMaximum() {
  console.log('🚀 Testing LollipopRouteGeneratorService for ABSOLUTE MAXIMUM LENGTH routes...');
  console.log('🎯 Strategy: Push ALL parameters to absolute limits to find the longest possible routes');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-ABSOLUTE-MAXIMUM.ts <schema_name>');
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
  console.log(`   • Script: test-lollipop-integration-ABSOLUTE-MAXIMUM.ts`);
  console.log(`   • Strategy: ABSOLUTE MAXIMUM LENGTH route discovery`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Your specific custom anchor nodes that performed well
    const customAnchorNodes = [24, 51, 194, 2];
    
    console.log('🔍 Checking custom anchor nodes...');
    const anchorNodes = await pgClient.query(`
      SELECT id, 
        (SELECT COUNT(*) FROM ${schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count,
        x, y
      FROM ${schema}.ways_noded_vertices_pgr
      WHERE id IN (${customAnchorNodes.join(',')})
      ORDER BY id
    `);
    
    console.log(`   Found ${anchorNodes.rows.length} custom anchor nodes:`);
    anchorNodes.rows.forEach((node, index) => {
      console.log(`   ${index + 1}. Node ${node.id}: ${node.connection_count} connections (${node.x}, ${node.y})`);
    });

    if (anchorNodes.rows.length === 0) {
      console.log('❌ None of the custom anchor nodes were found in the database!');
      return;
    }
    
    console.log(`\n🎯 Using custom anchor nodes: ${customAnchorNodes.join(', ')}`);

    // ABSOLUTE MAXIMUM configuration - push EVERYTHING to the limit
    const lollipopService = new LollipopRouteGeneratorServiceLengthFirst(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 1000, // Extremely high target to not limit discovery
      maxAnchorNodes: customAnchorNodes.length, // Only use our custom anchors
      maxReachableNodes: 1000, // Explore EVERYTHING possible destinations
      maxDestinationExploration: 500, // Maximum thoroughness
      distanceRangeMin: 0.05, // Allow very short outbound legs (5% of target)
      distanceRangeMax: 3.0, // Allow return legs up to 300% of target
      edgeOverlapThreshold: 99, // Allow up to 99% overlap (almost no filtering)
      kspPaths: 200, // Maximum path exploration
      minOutboundDistance: 0.5, // Very low minimum outbound distance
      outputPath: 'test-output',
      specificAnchorNodes: customAnchorNodes // Pass the custom anchor nodes
    });

    console.log('🚀 Generating ABSOLUTE MAXIMUM LENGTH routes...');
    console.log('🎯 Strategy: Push ALL parameters to absolute limits');
    console.log(`   • ${customAnchorNodes.length} custom anchor nodes: ${customAnchorNodes.join(', ')}`);
    console.log(`   • 1000 reachable nodes per anchor (explore EVERYTHING)`);
    console.log(`   • 500 destinations per anchor (maximum thoroughness)`);
    console.log(`   • 200 KSP paths (maximum path exploration)`);
    console.log(`   • 99% overlap threshold (almost no filtering)`);
    console.log(`   • 0.5km minimum outbound (very low threshold)`);
    console.log(`   • 1000km target distance (no discovery limits)`);
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
      
      // Track maximum length route
      const maxLengthRoute = sortedRoutes[0];
      const maxLength = maxLengthRoute.total_distance;
      
      console.log(`\n🎯 ABSOLUTE MAXIMUM FILTERING RESULTS:`);
      console.log(`   • Total routes discovered: ${lollipopRoutes.length}`);
      console.log(`   • Routes kept (top 7 by length): ${topRoutes.length}`);
      console.log(`   • ABSOLUTE MAXIMUM LENGTH ROUTE: ${maxLength.toFixed(2)}km`);
      console.log(`   • Longest route: ${topRoutes[0].total_distance.toFixed(2)}km`);
      console.log(`   • Shortest kept route: ${topRoutes[topRoutes.length - 1].total_distance.toFixed(2)}km`);
      
      // Show details of the absolute maximum length route
      console.log(`\n🏆 ABSOLUTE MAXIMUM LENGTH ROUTE DETAILS:`);
      console.log(`   • Total Distance: ${maxLengthRoute.total_distance.toFixed(2)}km`);
      console.log(`   • Outbound: ${maxLengthRoute.outbound_distance.toFixed(2)}km`);
      console.log(`   • Return: ${maxLengthRoute.return_distance.toFixed(2)}km`);
      console.log(`   • Anchor Node: ${maxLengthRoute.anchor_node}`);
      console.log(`   • Destination Node: ${maxLengthRoute.dest_node}`);
      console.log(`   • Edge Overlap: ${maxLengthRoute.edge_overlap_percentage.toFixed(1)}%`);
      
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
      const absoluteLimitRoutes = topRoutes.filter(r => r.total_distance >= 300);
      
      console.log(`\n📈 ABSOLUTE MAXIMUM ROUTE STATISTICS:`);
      console.log(`   • Routes ≥150km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥200km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥250km: ${networkLimitRoutes.length}`);
      console.log(`   • Routes ≥300km: ${absoluteLimitRoutes.length}`);
      console.log(`   • Average distance (top 7): ${(topRoutes.reduce((sum, r) => sum + r.total_distance, 0) / topRoutes.length).toFixed(2)}km`);
      console.log(`   • ABSOLUTE MAXIMUM distance found: ${maxLength.toFixed(2)}km`);
      
      // Show anchor node performance
      console.log(`\n🎯 ANCHOR NODE PERFORMANCE:`);
      const anchorPerformance = new Map<number, number>();
      lollipopRoutes.forEach(route => {
        const currentMax = anchorPerformance.get(route.anchor_node) || 0;
        if (route.total_distance > currentMax) {
          anchorPerformance.set(route.anchor_node, route.total_distance);
        }
      });
      
      const sortedAnchors = Array.from(anchorPerformance.entries())
        .sort((a, b) => b[1] - a[1]);
      
      sortedAnchors.forEach(([anchorNode, maxDistance], index) => {
        console.log(`   ${index + 1}. Anchor ${anchorNode}: ${maxDistance.toFixed(2)}km (max route)`);
      });

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
testLollipopIntegrationAbsoluteMaximum().catch(console.error);

