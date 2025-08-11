#!/usr/bin/env node
/**
 * Test Chautauqua Trails-Only Export Script (GeoJSON)
 * 
 * This script exports only trails from the Chautauqua area to GeoJSON,
 * bypassing the problematic routing network generation for visualization.
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
  outputFile: 'test-chautauqua-trails-only.geojson',
  format: 'trails-only'
};

console.log('🧪 Testing Chautauqua Trails-Only Export with CarthorseOrchestrator');
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
  '--trails-only',
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
  console.log('✅ Chautauqua trails-only export completed successfully!');
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
        console.log(`📍 GeoJSON contains ${geojson.features.length} trail features`);
        
        // Show some trail names
        const trailNames = geojson.features.slice(0, 10).map(f => f.properties?.name || 'unnamed');
        console.log('📋 Sample trails:');
        trailNames.forEach(name => console.log(`   - ${name}`));
        
        if (geojson.features.length > 10) {
          console.log(`   ... and ${geojson.features.length - 10} more trails`);
        }
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
  console.error('❌ Chautauqua trails-only export failed!');
  console.error(`Exit code: ${result.status}`);
  process.exit(1);
} 