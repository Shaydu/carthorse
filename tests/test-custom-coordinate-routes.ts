import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';
import { LollipopRouteGeneratorServiceAutoDiscovery } from './src/services/layer3/LollipopRouteGeneratorServiceAutoDiscovery';

async function main() {
  const schemaName = process.argv[2];
  
  if (!schemaName) {
    console.error('❌ Please provide a schema name as an argument');
    console.error('Usage: npx ts-node test-custom-coordinate-routes.ts <schema_name>');
    process.exit(1);
  }

  console.log('🍭 Testing CUSTOM COORDINATE Route Generation');
  console.log(`   Schema: ${schemaName}`);
  console.log(`   Strategy: Find nearest degree-1 endpoints to custom coordinates`);

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    // Custom coordinates provided by user
    const customCoordinates = [
      { id: '2', lat: 40.004505, lng: -105.31651500000001 },
      { id: '24', lat: 39.960585, lng: -105.24258 },
      { id: '309', lat: 39.9834, lng: -105.32331 },
      { id: '72', lat: 39.953880000000005, lng: -105.29941500000001 },
      { id: '34', lat: 39.945915, lng: -105.277365 }
    ];

    console.log('\n🔍 Finding nearest degree-1 endpoints to custom coordinates...');
    
    const nearestEndpoints: any[] = [];
    
    for (const coord of customCoordinates) {
      console.log(`\n   Looking for nearest degree-1 endpoint to coordinate ${coord.id}: (${coord.lat}, ${coord.lng})`);
      
      // Find the nearest degree-1 endpoint to this coordinate
      const nearestResult = await pgClient.query(`
        SELECT 
          v.id,
          v.the_geom,
          ST_X(v.the_geom) as lng,
          ST_Y(v.the_geom) as lat,
          (
            SELECT COUNT(*) 
            FROM ${schemaName}.ways_noded w 
            WHERE w.source = v.id OR w.target = v.id
          ) as connection_count,
          -- Distance to custom coordinate
          SQRT(
            POWER((ST_X(v.the_geom) - $1) * 111 * COS(RADIANS(ST_Y(v.the_geom))), 2) +
            POWER((ST_Y(v.the_geom) - $2) * 111, 2)
          ) as distance_to_coord_km
        FROM ${schemaName}.ways_noded_vertices_pgr v
        WHERE (
          SELECT COUNT(*) 
          FROM ${schemaName}.ways_noded w 
          WHERE w.source = v.id OR w.target = v.id
        ) = 1
        ORDER BY distance_to_coord_km ASC
        LIMIT 1
      `, [coord.lng, coord.lat]);

      if (nearestResult.rows.length > 0) {
        const endpoint = nearestResult.rows[0];
        console.log(`     Found: Node ${endpoint.id} at (${endpoint.lat.toFixed(6)}, ${endpoint.lng.toFixed(6)}) - ${endpoint.distance_to_coord_km.toFixed(2)}km away`);
        nearestEndpoints.push({
          ...endpoint,
          original_coord_id: coord.id,
          original_coord_lat: coord.lat,
          original_coord_lng: coord.lng
        });
      } else {
        console.log(`     No degree-1 endpoints found near coordinate ${coord.id}`);
      }
    }

    console.log(`\n✅ Found ${nearestEndpoints.length} nearest degree-1 endpoints`);

    if (nearestEndpoints.length === 0) {
      console.log('❌ No degree-1 endpoints found. Cannot generate routes.');
      return;
    }

    // Create a custom lollipop service that uses these specific endpoints
    const lollipopService = new LollipopRouteGeneratorServiceAutoDiscovery(pgClient, {
      stagingSchema: schemaName,
      region: 'boulder',
      targetDistance: 50, // 50km target distance (reduced from 80km)
      maxAnchorNodes: nearestEndpoints.length, // Use all found endpoints
      maxReachableNodes: 50, // Increased reachable nodes
      maxDestinationExploration: 20, // Increased destination exploration
      distanceRangeMin: 0.1, // More flexible distance range (10% of target)
      distanceRangeMax: 2.0, // Allow longer return paths (200% of target)
      edgeOverlapThreshold: 90, // Higher overlap tolerance
      kspPaths: 15, // More alternative paths
      minOutboundDistance: 15, // Higher minimum outbound distance
      outputPath: 'test-output',
      autoDiscoverEndpoints: false, // We'll provide custom endpoints
      maxRoutesToKeep: 25 // Keep more routes
    });

    // Override the discoverDegree1Endpoints method to use our custom endpoints
    (lollipopService as any).discoverDegree1Endpoints = async () => {
      console.log(`\n🎯 Using ${nearestEndpoints.length} custom coordinate-based endpoints as anchors`);
      return { rows: nearestEndpoints };
    };

    console.log('\n🚀 Starting route generation with custom coordinate-based endpoints...');
    const routes = await lollipopService.generateLollipopRoutes();
    
    console.log(`\n🎯 ROUTE GENERATION COMPLETE!`);
    console.log(`   Generated ${routes.length} lollipop routes`);
    if (routes.length > 0) {
      const maxLength = Math.max(...routes.map(r => r.total_distance));
      const avgLength = routes.reduce((sum, r) => sum + r.total_distance, 0) / routes.length;
      console.log(`   Maximum route length: ${maxLength.toFixed(2)}km`);
      console.log(`   Average route length: ${avgLength.toFixed(2)}km`);
      
      console.log(`\n📊 TOP ROUTES:`);
      routes.slice(0, 10).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (anchor: ${route.anchor_node}, dest: ${route.dest_node}, overlap: ${route.edge_overlap_percentage.toFixed(1)}%)`);
      });

      // Export to GeoJSON
      console.log(`\n📁 Exporting routes to GeoJSON...`);
      const exportPath = await lollipopService.exportToGeoJSON(routes);
      console.log(`✅ GeoJSON exported to: ${exportPath}`);
    }

  } catch (error) {
    console.error('❌ Error during route generation:', error);
  } finally {
    await pgClient.end();
  }
}

main().catch(console.error);
