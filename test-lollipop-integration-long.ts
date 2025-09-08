import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from './src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testLollipopIntegrationLong() {
  console.log('🍭 Testing LollipopRouteGeneratorService integration for LONG routes...');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-long.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Test the lollipop service with LONG route preferences
    const lollipopService = new LollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 80, // Increased from 40 to 80km for longer routes
      maxAnchorNodes: 30, // Increased from 25 to explore more anchor points
      maxReachableNodes: 30, // Increased from 25 for more destination options
      maxDestinationExploration: 15, // Increased from 12 for more thorough exploration
      distanceRangeMin: 0.3, // Increased from 0.2 to favor longer outbound legs
      distanceRangeMax: 0.9, // Increased from 0.8 to allow longer return legs
      edgeOverlapThreshold: 25, // Reduced from 30 to allow more overlap for longer routes
      kspPaths: 10, // Increased from 8 for more path options
      minOutboundDistance: 10, // Increased from 5 to ensure substantial outbound distance
      outputPath: 'test-output'
    });

    console.log('🍭 Generating LONG lollipop routes...');
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      console.log('📊 Top 10 LONGEST lollipop routes:');
      lollipopRoutes
        .sort((a, b) => b.total_distance - a.total_distance)
        .slice(0, 10) // Show top 10 instead of 5
        .forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
        });

      // Show statistics for long routes
      const longRoutes = lollipopRoutes.filter(r => r.total_distance >= 60);
      const veryLongRoutes = lollipopRoutes.filter(r => r.total_distance >= 100);
      
      console.log(`\n📈 Route Statistics:`);
      console.log(`   • Total routes: ${lollipopRoutes.length}`);
      console.log(`   • Routes ≥60km: ${longRoutes.length}`);
      console.log(`   • Routes ≥100km: ${veryLongRoutes.length}`);
      console.log(`   • Average distance: ${(lollipopRoutes.reduce((sum, r) => sum + r.total_distance, 0) / lollipopRoutes.length).toFixed(2)}km`);
      console.log(`   • Max distance: ${Math.max(...lollipopRoutes.map(r => r.total_distance)).toFixed(2)}km`);

      // Save to database
      await lollipopService.saveToDatabase(lollipopRoutes);
      
      // Export to GeoJSON
      const filepath = await lollipopService.exportToGeoJSON(lollipopRoutes);
      console.log(`📁 Exported to: ${filepath}`);
    }

  } catch (error) {
    console.error('❌ Error testing lollipop integration:', error);
  } finally {
    await pgClient.end();
  }
}

testLollipopIntegrationLong().catch(console.error);
