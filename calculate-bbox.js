// Current bbox: -105.30123174925316,39.96038502242032,-105.26050515816028,39.993172777276015
// Format: minLon, minLat, maxLon, maxLat

const currentBbox = {
  minLon: -105.30123174925316,
  minLat: 39.96038502242032,
  maxLon: -105.26050515816028,
  maxLat: 39.993172777276015
};

// Convert km to degrees (approximate)
// 1 degree latitude ≈ 111 km
// 1 degree longitude ≈ 111 km * cos(latitude)

const latCenter = (currentBbox.minLat + currentBbox.maxLat) / 2;
const kmToDegLat = 1 / 111; // 1 km = 1/111 degrees latitude
const kmToDegLon = 1 / (111 * Math.cos(latCenter * Math.PI / 180)); // longitude varies by latitude

console.log('Current bbox:');
console.log('  minLon:', currentBbox.minLon);
console.log('  minLat:', currentBbox.minLat);
console.log('  maxLon:', currentBbox.maxLon);
console.log('  maxLat:', currentBbox.maxLat);
console.log('  Center lat:', latCenter);
console.log('  km to deg lat:', kmToDegLat);
console.log('  km to deg lon:', kmToDegLon);

// Extend: 5km north, 5km west, 5km south
const newBbox = {
  minLon: currentBbox.minLon - (5 * kmToDegLon), // 5km west
  minLat: currentBbox.minLat - (5 * kmToDegLat), // 5km south
  maxLon: currentBbox.maxLon, // no change to east
  maxLat: currentBbox.maxLat + (5 * kmToDegLat)  // 5km north
};

console.log('\nNew bbox:');
console.log('  minLon:', newBbox.minLon);
console.log('  minLat:', newBbox.minLat);
console.log('  maxLon:', newBbox.maxLon);
console.log('  maxLat:', newBbox.maxLat);

console.log('\nNew bbox string:');
console.log(newBbox.minLon + ',' + newBbox.minLat + ',' + newBbox.maxLon + ',' + newBbox.maxLat);

console.log('\nFull command:');
console.log(`npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed.geojson --format geojson --bbox ${newBbox.minLon},${newBbox.minLat},${newBbox.maxLon},${newBbox.maxLat} --no-cleanup --verbose --source cotrex`);
