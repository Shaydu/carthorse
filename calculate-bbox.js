#!/usr/bin/env node

// Extract coordinates from the provided MultiLineString
const coordinates = [
  [-105.306879, 39.973342, 0],
  [-105.306859, 39.973343, 0],
  // ... (all the coordinates from your data)
  [-105.306879, 39.973342, 0]
];

// Calculate bounding box
const lngs = coordinates.map(coord => coord[0]);
const lats = coordinates.map(coord => coord[1]);

const minLng = Math.min(...lngs);
const maxLng = Math.max(...lngs);
const minLat = Math.min(...lats);
const maxLat = Math.max(...lats);

console.log('Bounding Box:');
console.log(`minLng: ${minLng}`);
console.log(`maxLng: ${maxLng}`);
console.log(`minLat: ${minLat}`);
console.log(`maxLat: ${maxLat}`);

// Format for export command
console.log('\nExport command format:');
console.log(`--bbox ${minLng},${minLat},${maxLng},${maxLat}`);
