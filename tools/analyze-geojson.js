#!/usr/bin/env node

const fs = require('fs');

if (process.argv.length < 3) {
    console.log('Usage: node analyze-geojson.js <geojson-file>');
    process.exit(1);
}

const geojsonFile = process.argv[2];
const data = JSON.parse(fs.readFileSync(geojsonFile));

const trails = data.features.filter(f => f.properties.feature_type === 'trail');
const nodes = data.features.filter(f => f.properties.feature_type === 'node');

console.log('📊 Boulder Valley Ranch Export Summary:');
console.log(`Trails: ${trails.length} segments`);
console.log(`Nodes: ${nodes.length} (intersections + endpoints)`);
console.log('');

console.log('🗺️ Trail Names:');
const trailNames = [...new Set(trails.map(t => t.properties.name))];
trailNames.forEach(name => console.log(`  - ${name}`));
console.log('');

console.log('📍 Node Types:');
const nodeTypes = nodes.reduce((acc, n) => {
    acc[n.properties.node_type] = (acc[n.properties.node_type] || 0) + 1;
    return acc;
}, {});
Object.entries(nodeTypes).forEach(([type, count]) => console.log(`  - ${type}: ${count}`));

console.log('');
console.log('📏 Trail Lengths:');
const lengths = trails.map(t => ({ name: t.properties.name, length: t.properties.length_km }));
lengths.sort((a, b) => b.length - a.length);
lengths.slice(0, 10).forEach(t => console.log(`  - ${t.name}: ${t.length.toFixed(3)}km`));

console.log('');
console.log('🏔️ Elevation Range:');
const elevations = trails.flatMap(t => t.geometry.coordinates.map(c => c[2]));
const minElev = Math.min(...elevations);
const maxElev = Math.max(...elevations);
console.log(`  - Min: ${minElev.toFixed(1)}m`);
console.log(`  - Max: ${maxElev.toFixed(1)}m`);
console.log(`  - Range: ${(maxElev - minElev).toFixed(1)}m`); 