const fs = require('fs');

// Read the GeoJSON file
const geojsonPath = 'data/boulder-consolidated-test.geojson';
const outputPath = 'data/boulder-consolidated-test-colored.geojson';

const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

// Color scheme based on trail count
const getColor = (trailCount) => {
  if (trailCount >= 16) return '#FF0000'; // Red for complex routes (16+ trails)
  if (trailCount >= 12) return '#FF6600'; // Orange for medium-complex routes (12-15 trails)
  if (trailCount >= 8) return '#FFCC00';  // Yellow for moderate routes (8-11 trails)
  if (trailCount >= 4) return '#00CC00';  // Green for simple routes (4-7 trails)
  return '#0066FF'; // Blue for very simple routes (2-3 trails)
};

// Update each feature with color based on trail count
geojson.features.forEach(feature => {
  const trailCount = feature.properties.trail_count;
  const color = getColor(trailCount);
  
  // Add color properties
  feature.properties.color = color;
  feature.properties.stroke = color;
  feature.properties.strokeWidth = trailCount >= 16 ? 4 : 3; // Thicker lines for complex routes
  feature.properties.fillOpacity = 0.8;
  
  // Add a description
  feature.properties.description = `${trailCount} trails - ${feature.properties.route_type}`;
});

// Write the colored GeoJSON
fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

console.log(`✅ Colored GeoJSON saved to: ${outputPath}`);
console.log('📊 Color scheme:');
console.log('🔴 Red: 16+ trails (complex routes)');
console.log('🟠 Orange: 12-15 trails (medium-complex routes)');
console.log('🟡 Yellow: 8-11 trails (moderate routes)');
console.log('🟢 Green: 4-7 trails (simple routes)');
console.log('🔵 Blue: 2-3 trails (very simple routes)');

// Show statistics
const stats = {};
geojson.features.forEach(feature => {
  const trailCount = feature.properties.trail_count;
  stats[trailCount] = (stats[trailCount] || 0) + 1;
});

console.log('\n📈 Route distribution by trail count:');
Object.keys(stats).sort((a, b) => parseInt(a) - parseInt(b)).forEach(count => {
  const color = getColor(parseInt(count));
  console.log(`  ${count} trails: ${stats[count]} routes (${color})`);
}); 