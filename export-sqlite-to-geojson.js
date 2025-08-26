const Database = require('better-sqlite3');
const fs = require('fs');

// Open the SQLite database
const db = new Database('/Users/shaydu/dev/carthorse/test-output/boulder.db');

try {
  console.log('🔍 Exporting routes from SQLite to GeoJSON...\n');
  
  // Get all route analysis data
  const routes = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      edge_count,
      unique_trail_count,
      total_distance_km,
      total_elevation_gain_m,
      out_and_back_distance_km,
      out_and_back_elevation_gain_m,
      constituent_analysis_json
    FROM route_analysis 
    ORDER BY total_distance_km DESC
  `).all();

  console.log(`Found ${routes.length} routes in the database`);

  // Create GeoJSON structure
  const geojson = {
    type: 'FeatureCollection',
    features: []
  };

  // Process each route
  routes.forEach((route, index) => {
    try {
      // Parse the constituent analysis JSON to get route path
      let routePath = null;
      let routeEdges = null;
      
      if (route.constituent_analysis_json) {
        const analysis = JSON.parse(route.constituent_analysis_json);
        routePath = analysis.route_path || null;
        routeEdges = analysis.route_edges || null;
      }

      // Create a simple point feature for the route (since we don't have full geometry)
      const feature = {
        type: 'Feature',
        properties: {
          id: route.route_uuid,
          route_uuid: route.route_uuid,
          route_name: route.route_name,
          edge_count: route.edge_count,
          unique_trail_count: route.unique_trail_count,
          total_distance_km: route.total_distance_km,
          total_elevation_gain_m: route.total_elevation_gain_m,
          out_and_back_distance_km: route.out_and_back_distance_km,
          out_and_back_elevation_gain_m: route.out_and_back_elevation_gain_m,
          route_path: routePath,
          route_edges: routeEdges
        },
        geometry: {
          type: 'Point',
          coordinates: [-105.28, 39.96, 0] // Default coordinates for Boulder area
        }
      };

      geojson.features.push(feature);
      
      if (index < 5) {
        console.log(`\n${index + 1}. Route: ${route.route_name}`);
        console.log(`   UUID: ${route.route_uuid}`);
        console.log(`   Distance: ${route.total_distance_km} km`);
        console.log(`   Elevation: ${route.total_elevation_gain_m} m`);
        console.log(`   Edges: ${route.edge_count}`);
        console.log(`   Unique Trails: ${route.unique_trail_count}`);
      }
    } catch (error) {
      console.error(`Error processing route ${route.route_uuid}:`, error.message);
    }
  });

  // Write to file
  const outputFile = '/Users/shaydu/dev/carthorse/test-output/boulder-sqlite-routes.geojson';
  fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
  
  console.log(`\n✅ Exported ${geojson.features.length} routes to: ${outputFile}`);
  console.log(`📁 File size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);

  // Also export trails data
  console.log('\n🔍 Exporting trails data...');
  
  const trails = db.prepare(`
    SELECT 
      app_uuid,
      name,
      length_km,
      elevation_gain,
      elevation_loss,
      max_elevation,
      min_elevation,
      avg_elevation,
      geojson
    FROM trails 
    ORDER BY name
  `).all();

  console.log(`Found ${trails.length} trails`);

  const trailsGeojson = {
    type: 'FeatureCollection',
    features: []
  };

  trails.forEach((trail, index) => {
    try {
      let geometry = null;
      if (trail.geojson) {
        geometry = JSON.parse(trail.geojson);
      } else {
        // Fallback to point geometry
        geometry = {
          type: 'Point',
          coordinates: [-105.28, 39.96, 0]
        };
      }

      const feature = {
        type: 'Feature',
        properties: {
          id: trail.app_uuid,
          app_uuid: trail.app_uuid,
          name: trail.name,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          max_elevation: trail.max_elevation,
          min_elevation: trail.min_elevation,
          avg_elevation: trail.avg_elevation
        },
        geometry: geometry
      };

      trailsGeojson.features.push(feature);
      
      if (index < 5) {
        console.log(`\n${index + 1}. Trail: ${trail.name}`);
        console.log(`   UUID: ${trail.app_uuid}`);
        console.log(`   Length: ${trail.length_km} km`);
        console.log(`   Elevation Gain: ${trail.elevation_gain} m`);
      }
    } catch (error) {
      console.error(`Error processing trail ${trail.app_uuid}:`, error.message);
    }
  });

  const trailsOutputFile = '/Users/shaydu/dev/carthorse/test-output/boulder-sqlite-trails.geojson';
  fs.writeFileSync(trailsOutputFile, JSON.stringify(trailsGeojson, null, 2));
  
  console.log(`\n✅ Exported ${trailsGeojson.features.length} trails to: ${trailsOutputFile}`);
  console.log(`📁 File size: ${(fs.statSync(trailsOutputFile).size / 1024).toFixed(2)} KB`);

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
