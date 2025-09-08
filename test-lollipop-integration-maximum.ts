import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from './src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testLollipopIntegrationMaximum() {
  console.log('🚀 Testing LollipopRouteGeneratorService for MAXIMUM LENGTH routes...');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-maximum.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // ULTRA-AGGRESSIVE configuration to find the absolute longest routes
    const lollipopService = new LollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 150, // Pushed to 150km to find network limits
      maxAnchorNodes: 50, // Dramatically increased to explore all high-degree nodes
      maxReachableNodes: 50, // Explore maximum destination options
      maxDestinationExploration: 25, // Maximum thoroughness
      distanceRangeMin: 0.4, // Favor very long outbound legs (40% of target)
      distanceRangeMax: 0.95, // Allow very long return legs (95% of target)
      edgeOverlapThreshold: 20, // Reduced to allow more overlap for longer routes
      kspPaths: 15, // Maximum path exploration
      minOutboundDistance: 20, // Ensure substantial outbound distance
      outputPath: 'test-output'
    });

    console.log('🚀 Generating MAXIMUM LENGTH lollipop routes...');
    console.log('⚠️  This may take longer due to aggressive exploration...');
    
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      console.log('📊 ALL routes sorted by length (showing top 20):');
      const sortedRoutes = lollipopRoutes.sort((a, b) => b.total_distance - a.total_distance);
      
      sortedRoutes.slice(0, 20).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
      });

      // Detailed statistics for maximum route discovery
      const ultraLongRoutes = lollipopRoutes.filter(r => r.total_distance >= 100);
      const extremeRoutes = lollipopRoutes.filter(r => r.total_distance >= 150);
      const networkLimitRoutes = lollipopRoutes.filter(r => r.total_distance >= 200);
      
      console.log(`\n📈 MAXIMUM ROUTE DISCOVERY STATISTICS:`);
      console.log(`   • Total routes found: ${lollipopRoutes.length}`);
      console.log(`   • Routes ≥100km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥150km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥200km: ${networkLimitRoutes.length}`);
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
      
      // Export to GeoJSON
      const filepath = await lollipopService.exportToGeoJSON(lollipopRoutes);
      console.log(`📁 Exported to: ${filepath}`);
      
      // Additional analysis
      console.log(`\n🔍 NETWORK ANALYSIS:`);
      const distanceRanges = [
        { min: 0, max: 50, label: 'Short (0-50km)' },
        { min: 50, max: 100, label: 'Medium (50-100km)' },
        { min: 100, max: 150, label: 'Long (100-150km)' },
        { min: 150, max: 200, label: 'Very Long (150-200km)' },
        { min: 200, max: Infinity, label: 'Extreme (200km+)' }
      ];
      
      distanceRanges.forEach(range => {
        const count = lollipopRoutes.filter(r => r.total_distance >= range.min && r.total_distance < range.max).length;
        console.log(`   • ${range.label}: ${count} routes`);
      });
    }

  } catch (error) {
    console.error('❌ Error testing maximum lollipop integration:', error);
  } finally {
    await pgClient.end();
  }
}

testLollipopIntegrationMaximum().catch(console.error);
