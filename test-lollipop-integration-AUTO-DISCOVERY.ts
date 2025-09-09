#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorServiceAutoDiscovery } from './src/services/layer3/LollipopRouteGeneratorServiceAutoDiscovery';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function main() {
  const schemaName = process.argv[2];
  
  if (!schemaName) {
    console.error('❌ Please provide a schema name as an argument');
    console.error('Usage: npx ts-node test-lollipop-integration-AUTO-DISCOVERY.ts <schema_name>');
    process.exit(1);
  }

  console.log(`🍭 Testing AUTO-DISCOVERY Lollipop Route Generation`);
  console.log(`   Schema: ${schemaName}`);
  console.log(`   Strategy: Auto-discover degree-1 endpoints and generate longest possible routes`);

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    // Test the auto-discovery lollipop service with aggressive parameters for longer routes
    const lollipopService = new LollipopRouteGeneratorServiceAutoDiscovery(pgClient, {
      stagingSchema: schemaName,
      region: 'boulder',
      targetDistance: 80, // 80km target distance for longer routes
      maxAnchorNodes: 10, // 10 endpoints from west and east boundaries
      maxReachableNodes: 50, // Increased reachable nodes
      maxDestinationExploration: 20, // Increased destination exploration
      distanceRangeMin: 0.2, // More flexible distance range (20% of target)
      distanceRangeMax: 1.5, // Allow longer return paths (150% of target)
      edgeOverlapThreshold: 90, // Higher overlap tolerance
      kspPaths: 15, // More alternative paths
      minOutboundDistance: 15, // Higher minimum outbound distance
      outputPath: 'test-output',
      autoDiscoverEndpoints: true, // Enable auto-discovery
      maxRoutesToKeep: 25 // Keep more routes to accommodate custom + boundary endpoints
    });

    console.log('\n🚀 Starting route generation...');
    const routes = await lollipopService.generateLollipopRoutes();
    
    if (routes.length > 0) {
      console.log('\n💾 Saving routes to database...');
      await lollipopService.saveToDatabase(routes);
      
      console.log('\n📤 Exporting routes to GeoJSON...');
      await lollipopService.exportToGeoJSON(routes);
      
      console.log('\n🎯 ROUTE GENERATION COMPLETE!');
      console.log(`   Generated ${routes.length} lollipop routes`);
      console.log(`   Maximum route length: ${Math.max(...routes.map(r => r.total_distance)).toFixed(2)}km`);
      console.log(`   Average route length: ${(routes.reduce((sum, r) => sum + r.total_distance, 0) / routes.length).toFixed(2)}km`);
      
      console.log('\n📊 TOP ROUTES:');
      routes.forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (anchor: ${route.anchor_node}, dest: ${route.dest_node}, overlap: ${route.edge_overlap_percentage.toFixed(1)}%)`);
      });
    } else {
      console.log('\n❌ No routes generated');
    }

  } catch (error) {
    console.error('❌ Error during route generation:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

main().catch(console.error);
