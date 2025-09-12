#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Get the SQLite database path from command line arguments
const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: node export-route-recommendations.js <path-to-sqlite-db>');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Exporting route recommendations from: ${dbPath}`);

try {
  const db = new Database(dbPath);
  
  // Check if route_recommendations table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='route_recommendations'
  `).get();
  
  if (!tableExists) {
    console.error('❌ route_recommendations table not found in database');
    process.exit(1);
  }
  
  // Get route recommendations
  console.log('📊 Exporting route recommendations...');
  const routes = db.prepare(`
    SELECT 
      route_uuid,
      route_name,
      route_type,
      recommended_length_km,
      recommended_elevation_gain,
      route_elevation_loss,
      route_difficulty,
      route_shape,
      trail_count,
      route_path,
      created_at
    FROM route_recommendations 
    WHERE route_path IS NOT NULL
  `).all();
  
  console.log(`Found ${routes.length} route recommendations`);
  
  if (routes.length === 0) {
    console.log('⚠️  No route recommendations found with geometry data');
    process.exit(0);
  }
  
  // Convert to GeoJSON
  const routesGeoJSON = {
    type: 'FeatureCollection',
    features: routes.map(route => {
      let geometry;
      try {
        // Parse the GeoJSON from the route_path column
        const geojsonData = JSON.parse(route.route_path);
        geometry = geojsonData.geometry;
      } catch (e) {
        console.warn(`Warning: Could not parse GeoJSON for route ${route.route_uuid}: ${e.message}`);
        geometry = {
          type: 'LineString',
          coordinates: [[0, 0, 0]] // Fallback
        };
      }
      
      return {
        type: 'Feature',
        properties: {
          route_uuid: route.route_uuid,
          route_name: route.route_name,
          route_type: route.route_type,
          recommended_length_km: route.recommended_length_km,
          recommended_elevation_gain: route.recommended_elevation_gain,
          route_elevation_loss: route.route_elevation_loss,
          route_difficulty: route.route_difficulty,
          route_shape: route.route_shape,
          trail_count: route.trail_count,
          created_at: route.created_at
        },
        geometry: geometry
      };
    })
  };
  
  // Write to file
  const outputPath = path.join(path.dirname(dbPath), 'route-recommendations.geojson');
  fs.writeFileSync(outputPath, JSON.stringify(routesGeoJSON, null, 2));
  
  console.log(`✅ Route recommendations exported to: ${outputPath}`);
  console.log(`📊 Exported ${routes.length} routes`);
  
  // Also export trails if they exist
  const trailsExist = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='trails'
  `).get();
  
  if (trailsExist) {
    console.log('📊 Exporting trails...');
    const trails = db.prepare(`
      SELECT 
        app_uuid,
        name,
        region,
        length_km,
        elevation_gain,
        elevation_loss,
        difficulty,
        surface_type,
        trail_type,
        geojson,
        created_at
      FROM trails 
      WHERE geojson IS NOT NULL
    `).all();
    
    console.log(`Found ${trails.length} trails`);
    
    if (trails.length > 0) {
      const trailsGeoJSON = {
        type: 'FeatureCollection',
        features: trails.map(trail => {
          let geometry;
          try {
            const geojsonData = JSON.parse(trail.geojson);
            geometry = geojsonData.geometry;
          } catch (e) {
            console.warn(`Warning: Could not parse GeoJSON for trail ${trail.app_uuid}: ${e.message}`);
            geometry = {
              type: 'LineString',
              coordinates: [[0, 0, 0]]
            };
          }
          
          return {
            type: 'Feature',
            properties: {
              app_uuid: trail.app_uuid,
              name: trail.name,
              region: trail.region,
              length_km: trail.length_km,
              elevation_gain: trail.elevation_gain,
              elevation_loss: trail.elevation_loss,
              difficulty: trail.difficulty,
              surface_type: trail.surface_type,
              trail_type: trail.trail_type,
              created_at: trail.created_at
            },
            geometry: geometry
          };
        })
      };
      
      const trailsOutputPath = path.join(path.dirname(dbPath), 'trails.geojson');
      fs.writeFileSync(trailsOutputPath, JSON.stringify(trailsGeoJSON, null, 2));
      console.log(`✅ Trails exported to: ${trailsOutputPath}`);
    }
  }
  
  db.close();
  
} catch (error) {
  console.error('Error exporting route recommendations:', error);
  process.exit(1);
}
