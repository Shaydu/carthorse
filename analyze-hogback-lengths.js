const fs = require('fs');

// Read the GeoJSON file
const geojsonPath = 'test-output/boulder-expanded-bbox-test-layer1-trails.geojson';
const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

// Function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Function to calculate total length of a trail
function calculateTrailLength(coordinates) {
  let totalLength = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i-1];
    const [lon2, lat2] = coordinates[i];
    totalLength += calculateDistance(lat1, lon1, lat2, lon2);
  }
  return totalLength;
}

// Find all Hogback Ridge Trail entries
const hogbackTrails = geojsonData.features.filter(feature => 
  feature.properties.name.includes('Hogback Ridge Trail')
);

console.log(`Found ${hogbackTrails.length} Hogback Ridge Trail entries:\n`);

hogbackTrails.forEach((trail, index) => {
  const props = trail.properties;
  const coords = trail.geometry.coordinates;
  const length = calculateTrailLength(coords);
  
  console.log(`${index + 1}. ${props.name}`);
  console.log(`   ID: ${props.id}`);
  console.log(`   Original UUID: ${props.original_trail_uuid}`);
  console.log(`   Coordinates: ${coords.length} points`);
  console.log(`   Calculated length: ${length.toFixed(3)} km`);
  console.log(`   Stored length_km: ${props.length_km}`);
  console.log(`   Elevation gain: ${props.elevation_gain} m`);
  console.log(`   Elevation loss: ${props.elevation_loss} m`);
  console.log(`   Bbox: [${props.bbox_min_lng}, ${props.bbox_min_lat}, ${props.bbox_max_lng}, ${props.bbox_max_lat}]`);
  console.log('');
});

// Check for duplicates
const originalUuids = hogbackTrails.map(t => t.properties.original_trail_uuid);
const uniqueUuids = [...new Set(originalUuids)];

console.log(`Unique original UUIDs: ${uniqueUuids.length}`);
console.log(`Duplicate original UUIDs: ${originalUuids.length - uniqueUuids.length}`);

if (originalUuids.length > uniqueUuids.length) {
  console.log('\nDUPLICATE DETECTED: Multiple trails with the same original_trail_uuid!');
  console.log('This confirms the parent trail deletion issue.');
}
