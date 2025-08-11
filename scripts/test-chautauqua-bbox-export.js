#!/usr/bin/env node
/**
 * Test Chautauqua Bbox Export Script
 * 
 * This script tests the CarthorseOrchestrator with a 4 square mile bbox export
 * around the Chautauqua area in Boulder to verify the bbox filtering functionality.
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
  outputFile: 'test-chautauqua-bbox-export.db',
  format: 'sqlite' // or 'geojson'
};

console.log('🧪 Testing Chautauqua Bbox Export with CarthorseOrchestrator');
console.log('=' .repeat(60));
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
  '--skip-bbox-validation' // Skip validation for small test
];

if (TEST_CONFIG.format === 'geojson') {
  args.push('--geojson');
}

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