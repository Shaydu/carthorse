import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from '../src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

async function testLollipopIntegration() {
  console.log('🍭 Testing LollipopRouteGeneratorService integration...');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Test the lollipop service directly
    const lollipopService = new LollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 40,
      maxAnchorNodes: 25, // Same as working script
      maxReachableNodes: 25,
      maxDestinationExploration: 12,
      distanceRangeMin: 0.2,
      distanceRangeMax: 0.8,
      edgeOverlapThreshold: 30,
      kspPaths: 8,
      minOutboundDistance: 5,
      outputPath: 'test-output'
    });

    console.log('🍭 Generating lollipop routes...');
    const lollipopRoutes = await lollipopService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
    
    if (lollipopRoutes.length > 0) {
      console.log('📊 Top 5 lollipop routes:');
      lollipopRoutes
        .sort((a, b) => b.total_distance - a.total_distance)
        .slice(0, 5)
        .forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
        });

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

testLollipopIntegration().catch(console.error);
