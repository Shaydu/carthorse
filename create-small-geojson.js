const fs = require('fs');

// Read the large GeoJSON file
const largeFile = 'test-output/boulder-bbox-test2.geojson';
const smallFile = 'test-output/boulder-bbox-test2-small.geojson';

console.log('Reading large GeoJSON file...');
const data = JSON.parse(fs.readFileSync(largeFile, 'utf8'));

// Take only the first 10 features for visualization
const smallData = {
  type: 'FeatureCollection',
  features: data.features.slice(0, 10)
};

console.log(`Original file: ${data.features.length} features`);
console.log(`Small file: ${smallData.features.length} features`);

// Write the small file
fs.writeFileSync(smallFile, JSON.stringify(smallData, null, 2));
console.log(`Small GeoJSON created: ${smallFile}`);

// Check file sizes
const largeSize = fs.statSync(largeFile).size;
const smallSize = fs.statSync(smallFile).size;

console.log(`Large file size: ${(largeSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Small file size: ${(smallSize / 1024).toFixed(2)} KB`);
