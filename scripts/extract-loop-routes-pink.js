#!/usr/bin/env node

const fs = require('fs');

// Read the original GeoJSON file
const originalGeojson = JSON.parse(fs.readFileSync('test-output/boulder-loops-only.geojson', 'utf8'));

// Filter to only loop routes
const loopRoutes = {
  type: 'FeatureCollection',
  features: originalGeojson.features.filter(feature => 
    feature.properties.route_shape === 'loop'
  )
};

console.log(`🎯 Found ${loopRoutes.features.length} loop routes`);

// Update styling to pink for loop routes
loopRoutes.features.forEach(feature => {
  feature.properties.stroke = '#FF69B4'; // Hot pink
  feature.properties['stroke-width'] = 4;
  feature.properties['stroke-opacity'] = 0.8;
  feature.properties.fill = '#FFB6C1'; // Light pink
  feature.properties['fill-opacity'] = 0.3;
  feature.properties['marker-color'] = '#FF69B4';
  feature.properties['marker-size'] = 'medium';
  feature.properties['marker-symbol'] = 'circle';
});

// Write the loop routes to a new file
fs.writeFileSync('loop-routes-pink.geojson', JSON.stringify(loopRoutes, null, 2));
console.log('✅ Created loop-routes-pink.geojson');

// Create HTML viewer
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Loop Routes Visualization (Pink)</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
    <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100vw; }
        .info { position: absolute; top: 10px; left: 10px; background: white; padding: 10px; border-radius: 5px; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .route-info { margin: 5px 0; }
    </style>
</head>
<body>
    <div id="map"></div>
    <div class="info">
        <h3>🔄 Loop Routes (Pink)</h3>
        <p>Generated: ${loopRoutes.features.length} loop routes</p>
        <p>Click on routes for details</p>
        <div id="route-list">
            ${loopRoutes.features.map((feature, index) => `
                <div class="route-info">
                    ${index + 1}. ${feature.properties.route_name}<br>
                    <small>${feature.properties.recommended_distance_km.toFixed(1)}km, ${feature.properties.recommended_elevation_gain.toFixed(0)}m gain</small>
                </div>
            `).join('')}
        </div>
    </div>
    <script>
        const map = L.map('map').setView([40.0150, -105.2705], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        
        const geojsonData = ${JSON.stringify(loopRoutes)};
        
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
                    <strong>🔄 \${props.route_name}</strong><br>
                    Distance: \${props.recommended_distance_km.toFixed(1)}km<br>
                    Elevation: \${props.recommended_elevation_gain.toFixed(0)}m<br>
                    Score: \${props.route_score}<br>
                    Trails: \${props.trail_count}<br>
                    Type: \${props.route_type}<br>
                    Shape: \${props.route_shape}
                \`;
                layer.bindPopup(popupContent);
            }
        }).addTo(map);
    </script>
</body>
</html>`;

fs.writeFileSync('loop-routes-pink.html', htmlContent);
console.log('🌐 Created loop-routes-pink.html');

// Also log the loop route details
console.log('\n📋 Loop Route Details:');
loopRoutes.features.forEach((feature, index) => {
  const props = feature.properties;
  console.log(`${index + 1}. ${props.route_name}`);
  console.log(`   Distance: ${props.recommended_distance_km.toFixed(1)}km`);
  console.log(`   Elevation: ${props.recommended_elevation_gain.toFixed(0)}m`);
  console.log(`   Score: ${props.route_score}`);
  console.log(`   Trails: ${props.trail_count}`);
  console.log('');
}); 