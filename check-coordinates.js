const fs = require('fs');

// The coordinates you want to check
const targetCoords = [
  [-105.283366, 39.9695893],
  [-105.283261, 39.969494],
  [-105.283124, 39.96945],
  [-105.282966, 39.969438],
  [-105.282629, 39.969393],
  [-105.282307, 39.969401],
  [-105.282014, 39.96942]
];

console.log('Checking for specific coordinates in GeoJSON...');

// Read the large GeoJSON file
const data = JSON.parse(fs.readFileSync('test-output/boulder-bbox-test2.geojson', 'utf8'));

let foundCoords = [];
let matchingFeatures = [];

// Check each coordinate
targetCoords.forEach((target, index) => {
  const [targetLng, targetLat] = target;
  
  data.features.forEach((feature, featureIndex) => {
    if (feature.geometry && feature.geometry.coordinates) {
      const coords = feature.geometry.coordinates;
      
      // Check if coordinates are in this feature
      coords.forEach(coord => {
        if (Array.isArray(coord[0])) {
          // Multi-line or polygon
          coord.forEach(line => {
            line.forEach(point => {
              const [lng, lat] = point;
              if (Math.abs(lng - targetLng) < 0.0001 && Math.abs(lat - targetLat) < 0.0001) {
                foundCoords.push({
                  target: target,
                  targetIndex: index,
                  featureIndex: featureIndex,
                  feature: feature.properties
                });
                if (!matchingFeatures.includes(featureIndex)) {
                  matchingFeatures.push(featureIndex);
                }
              }
            });
          });
        } else {
          // Single line
          coord.forEach(point => {
            const [lng, lat] = point;
            if (Math.abs(lng - targetLng) < 0.0001 && Math.abs(lat - targetLat) < 0.0001) {
              foundCoords.push({
                target: target,
                targetIndex: index,
                featureIndex: featureIndex,
                feature: feature.properties
              });
              if (!matchingFeatures.includes(featureIndex)) {
                matchingFeatures.push(featureIndex);
              }
            }
          });
        }
      });
    }
  });
});

console.log('\n=== COORDINATE CHECK RESULTS ===');
console.log(`Total features in file: ${data.features.length}`);
console.log(`Target coordinates to find: ${targetCoords.length}`);

if (foundCoords.length > 0) {
  console.log(`✅ Found ${foundCoords.length} coordinate matches!`);
  console.log(`✅ Found in ${matchingFeatures.length} different features`);
  
  console.log('\n=== MATCHING COORDINATES ===');
  foundCoords.forEach(match => {
    console.log(`Coordinate ${match.targetIndex + 1}: [${match.target[0]}, ${match.target[1]}]`);
    console.log(`  Found in feature ${match.featureIndex}: ${JSON.stringify(match.feature)}`);
  });
} else {
  console.log('❌ No exact coordinate matches found');
  
  // Check for nearby coordinates
  console.log('\n=== CHECKING FOR NEARBY COORDINATES ===');
  targetCoords.forEach((target, index) => {
    const [targetLng, targetLat] = target;
    let closest = null;
    let closestDistance = Infinity;
    
    data.features.forEach((feature, featureIndex) => {
      if (feature.geometry && feature.geometry.coordinates) {
        const coords = feature.geometry.coordinates;
        
        coords.forEach(coord => {
          if (Array.isArray(coord[0])) {
            coord.forEach(line => {
              line.forEach(point => {
                const [lng, lat] = point;
                const distance = Math.sqrt((lng - targetLng) ** 2 + (lat - targetLat) ** 2);
                if (distance < closestDistance) {
                  closestDistance = distance;
                  closest = { lng, lat, featureIndex, feature: feature.properties };
                }
              });
            });
          } else {
            coord.forEach(point => {
              const [lng, lat] = point;
              const distance = Math.sqrt((lng - targetLng) ** 2 + (lat - targetLat) ** 2);
              if (distance < closestDistance) {
                closestDistance = distance;
                closest = { lng, lat, featureIndex, feature: feature.properties };
              }
            });
          }
        });
      }
    });
    
    if (closest) {
      console.log(`Coordinate ${index + 1}: [${target[0]}, ${target[1]}]`);
      console.log(`  Closest found: [${closest.lng}, ${closest.lat}] (distance: ${closestDistance.toFixed(6)})`);
      console.log(`  In feature: ${JSON.stringify(closest.feature)}`);
    }
  });
}
