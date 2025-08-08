#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: process.env.PGUSER || 'shaydu'
};

const stagingSchema = 'carthorse_1754400492908'; // Use the schema we just tested
const outputFile = 'loop-routes-pink.geojson';

async function exportLoopRoutes() {
  const pgClient = new Pool(config);
  
  try {
    console.log('🔄 Exporting loop routes to GeoJSON...');
    
    // Get loop routes from the staging schema
    const routesResult = await pgClient.query(`
      SELECT 
        route_uuid,
        route_name,
        route_type,
        route_shape,
        route_path,
        route_edges
      FROM ${stagingSchema}.route_recommendations
      WHERE route_shape = 'loop'
      ORDER BY route_score DESC
    `);
    
    console.log(`📊 Found ${routesResult.rows.length} loop routes`);
    
    // Build GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: []
    };
    
    // Process each loop route
    for (const route of routesResult.rows) {
      try {
        const routePath = JSON.parse(route.route_path);
        const routeEdges = JSON.parse(route.route_edges);
        
        // Get the geometry for this route
        const geometryResult = await pgClient.query(`
          SELECT 
            ST_AsGeoJSON(ST_Union(w.geometry)) as route_geometry,
            ST_Length(ST_Union(w.geometry)) as route_length
          FROM ${stagingSchema}.ways_noded w
          WHERE w.id = ANY($1::integer[])
        `, [routePath]);
        
        if (geometryResult.rows[0] && geometryResult.rows[0].route_geometry) {
          const routeGeometry = JSON.parse(geometryResult.rows[0].route_geometry);
          
          // Create feature with pink styling
          const feature = {
            type: 'Feature',
            geometry: routeGeometry,
            properties: {
              route_uuid: route.route_uuid,
              route_name: route.route_name,
              route_type: route.route_type,
              route_shape: route.route_shape,
              distance_km: route.recommended_distance_km,
              elevation_gain: route.recommended_elevation_gain,
              route_score: route.route_score,
              trail_count: routeEdges.length,
              // Styling properties for pink visualization
              stroke: '#FF69B4', // Hot pink
              'stroke-width': 4,
              'stroke-opacity': 0.8,
              fill: '#FFB6C1', // Light pink
              'fill-opacity': 0.3,
              // Additional styling for better visualization
              'marker-color': '#FF69B4',
              'marker-size': 'medium',
              'marker-symbol': 'circle'
            }
          };
          
          geojson.features.push(feature);
          console.log(`✅ Added loop route: ${route.route_name} (${route.recommended_distance_km}km, ${route.recommended_elevation_gain}m)`);
        }
      } catch (error) {
        console.error(`❌ Error processing route ${route.route_uuid}:`, error.message);
      }
    }
    
    // Write to file
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    console.log(`🎯 Exported ${geojson.features.length} loop routes to ${outputFile}`);
    
    // Also create a simple HTML viewer
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Loop Routes Visualization</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
    <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100vw; }
        .info { position: absolute; top: 10px; left: 10px; background: white; padding: 10px; border-radius: 5px; z-index: 1000; }
    </style>
</head>
<body>
    <div id="map"></div>
    <div class="info">
        <h3>Loop Routes (Pink)</h3>
        <p>Generated: ${geojson.features.length} routes</p>
        <p>Click on routes for details</p>
    </div>
    <script>
        const map = L.map('map').setView([40.0150, -105.2705], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        
        const geojsonData = ${JSON.stringify(geojson)};
        
        L.geoJSON(geojsonData, {
            style: function(feature) {
                return {
                    color: feature.properties.stroke,
                    weight: feature.properties['stroke-width'],
                    opacity: feature.properties['stroke-opacity'],
                    fillColor: feature.properties.fill,
                    fillOpacity: feature.properties['fill-opacity']
                };
            },
            onEachFeature: function(feature, layer) {
                const props = feature.properties;
                const popupContent = \`
                    <strong>\${props.route_name}</strong><br>
                    Distance: \${props.distance_km}km<br>
                    Elevation: \${props.elevation_gain}m<br>
                    Score: \${props.route_score}<br>
                    Trails: \${props.trail_count}
                \`;
                layer.bindPopup(popupContent);
            }
        }).addTo(map);
    </script>
</body>
</html>`;
    
    fs.writeFileSync('loop-routes-pink.html', htmlContent);
    console.log(`🌐 Created HTML viewer: loop-routes-pink.html`);
    
  } catch (error) {
    console.error('❌ Error exporting loop routes:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the export
exportLoopRoutes().catch(console.error); 