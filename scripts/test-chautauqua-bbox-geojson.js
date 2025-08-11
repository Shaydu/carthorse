#!/usr/bin/env node
/**
 * Test Chautauqua Bbox Export Script (GeoJSON)
 * 
 * This script tests the CarthorseOrchestrator with a 4 square mile bbox export
 * around the Chautauqua area in Boulder and exports to GeoJSON for visualization.
 */

const { spawnSync } = require('child_process');
const path = require('path');

// Chautauqua coordinates (39.9950, -105.2810)
// 4 square miles = ~2 miles x 2 miles = ~0.018 degrees in each direction
const CHAUTAUQUA_BBOX = [
  -105.2810 - 0.009, // minLng (west)
  39.9950 - 0.009,   // minLat (south)
  -105.2810 + 0.009, // maxLng (east)
  39.9950 + 0.009    // maxLat (north)
];

// Test configuration
const TEST_CONFIG = {
  region: 'boulder',
  bbox: CHAUTAUQUA_BBOX,
  outputFile: 'test-chautauqua-bbox-export.geojson',
  format: 'geojson'
};

console.log('🧪 Testing Chautauqua Bbox Export with CarthorseOrchestrator (GeoJSON)');
console.log('=' .repeat(70));
console.log(`Region: ${TEST_CONFIG.region}`);
console.log(`Bbox: ${TEST_CONFIG.bbox.join(', ')}`);
console.log(`Output: ${TEST_CONFIG.outputFile}`);
console.log(`Format: ${TEST_CONFIG.format}`);
console.log('');

// Build the command with custom bbox
const args = [
  '--region', TEST_CONFIG.region,
  '--out', TEST_CONFIG.outputFile,
  '--bbox', TEST_CONFIG.bbox.join(','),
  '--geojson',
  '--skip-bbox-validation' // Skip validation for small test
];

console.log('🚀 Running CarthorseOrchestrator export...');
console.log(`Command: npx ts-node src/cli/export.ts ${args.join(' ')}`);
console.log('');

// Run the export
const result = spawnSync('npx', ['ts-node', 'src/cli/export.ts', ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: { ...process.env }
});

if (result.status === 0) {
  console.log('');
  console.log('✅ Chautauqua bbox export completed successfully!');
  console.log(`📁 Output file: ${TEST_CONFIG.outputFile}`);
  
  // Check if file was created
  const fs = require('fs');
  if (fs.existsSync(TEST_CONFIG.outputFile)) {
    const stats = fs.statSync(TEST_CONFIG.outputFile);
    console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Try to read and show some basic stats about the GeoJSON
    try {
      const geojsonContent = fs.readFileSync(TEST_CONFIG.outputFile, 'utf8');
      const geojson = JSON.parse(geojsonContent);
      
      if (geojson.features) {
        console.log(`📍 GeoJSON contains ${geojson.features.length} features`);
        
        // Count different feature types
        const featureTypes = {};
        geojson.features.forEach(feature => {
          const type = feature.geometry?.type || 'unknown';
          featureTypes[type] = (featureTypes[type] || 0) + 1;
        });
        
        console.log('📊 Feature breakdown:');
        Object.entries(featureTypes).forEach(([type, count]) => {
          console.log(`   - ${type}: ${count}`);
        });
      }
    } catch (error) {
      console.log('⚠️ Could not parse GeoJSON for stats');
    }
  }
  
  console.log('');
  console.log('🧹 Cleaning up test databases...');
  
  // Clean up test databases
  const cleanupResult = spawnSync('npx', ['ts-node', 'src/orchestrator/CarthorseOrchestrator.ts', 'cleanup'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env }
  });
  
  if (cleanupResult.status === 0) {
    console.log('✅ Cleanup completed successfully!');
  } else {
    console.log('⚠️ Cleanup had issues, but test completed successfully');
  }
  
} else {
  console.log('');
  console.error('❌ Chautauqua bbox export failed!');
  console.error(`Exit code: ${result.status}`);
  process.exit(1);
} 