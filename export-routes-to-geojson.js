const Database = require('better-sqlite3');
const fs = require('fs');

// Open the SQLite database
const db = new Database('/Users/shaydu/dev/carthorse/test-output/boulder.db');

try {
  // Get all route recommendations
  const routes = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      recommended_length_km,
      recommended_elevation_gain,
      route_score,
      route_type,
      route_shape,
      trail_count,
      route_path,
      route_edges
    FROM route_recommendations 
    ORDER BY route_score DESC
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
      // Parse route_path if it exists
      let routePath = null;
      if (route.route_path) {
        routePath = JSON.parse(route.route_path);
      }

      // Parse route_edges if it exists
      let routeEdges = null;
      if (route.route_edges) {
        routeEdges = JSON.parse(route.route_edges);
      }

      // Create a simple point feature for each route (since we don't have full geometry)
      const feature = {
        type: 'Feature',
        properties: {
          id: route.route_uuid,
          name: route.route_name,
          length_km: route.recommended_length_km,
          elevation_gain: route.recommended_elevation_gain,
          score: route.route_score,
          type: route.route_type,
          shape: route.route_shape,
          trail_count: route.trail_count,
          route_path: routePath,
          route_edges: routeEdges
        },
        geometry: {
          type: 'Point',
          coordinates: [-105.28, 39.98] // Approximate Boulder coordinates
        }
      };

      geojson.features.push(feature);
    } catch (error) {
      console.error(`Error processing route ${route.route_uuid}:`, error.message);
    }
  });

  // Write to file
  const outputPath = '/Users/shaydu/dev/carthorse/test-output/boulder-routes.geojson';
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  
  console.log(`✅ Exported ${geojson.features.length} routes to ${outputPath}`);
  
  // Show some sample routes
  console.log('\n📋 Sample routes:');
  geojson.features.slice(0, 10).forEach((feature, i) => {
    console.log(`${i + 1}. ${feature.properties.name} (${feature.properties.length_km}km, ${feature.properties.elevation_gain}m)`);
  });

} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
