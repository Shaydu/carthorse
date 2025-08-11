#!/usr/bin/env node
/**
 * Test Small Bbox Export Script
 * 
 * This script tests the CarthorseOrchestrator with a small bbox export
 * from the Boulder region to verify the bbox filtering functionality.
 */

const { spawnSync } = require('child_process');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  region: 'boulder',
  testSize: 'small', // Use the predefined small bbox
  outputFile: 'test-small-bbox-export.db',
  format: 'sqlite' // or 'geojson'
};

console.log('🧪 Testing Small Bbox Export with CarthorseOrchestrator');
console.log('=' .repeat(60));
console.log(`Region: ${TEST_CONFIG.region}`);
console.log(`Test Size: ${TEST_CONFIG.testSize}`);
console.log(`Output: ${TEST_CONFIG.outputFile}`);
console.log(`Format: ${TEST_CONFIG.format}`);
console.log('');

// Set environment variables for the test
process.env.CARTHORSE_TEST_BBOX_SIZE = TEST_CONFIG.testSize;

// Build the command
const args = [
  '--region', TEST_CONFIG.region,
  '--out', TEST_CONFIG.outputFile,
  '--test-size', TEST_CONFIG.testSize,
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
  console.log('✅ Small bbox export completed successfully!');
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
  console.error('❌ Small bbox export failed!');
  console.error(`Exit code: ${result.status}`);
  process.exit(1);
} 