#!/usr/bin/env node
/**
 * Debug Route Recommendations Script
 * 
 * This script checks if route recommendations are being generated
 * in the staging schema for the Chautauqua area.
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

console.log('🔍 Debugging Route Recommendations for Chautauqua Area');
console.log('=' .repeat(60));
console.log(`Bbox: ${CHAUTAUQUA_BBOX.join(', ')}`);

// Run the orchestrator with verbose output to see what's happening
const result = spawnSync('npx', [
  'ts-node', 
  'src/orchestrator/CarthorseOrchestrator.ts', 
  'export',
  '--region', 'boulder',
  '--bbox', CHAUTAUQUA_BBOX.join(','),
  '--out', 'test-chautauqua-debug.db',
  '--format', 'sqlite',
  '--verbose'
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PGDATABASE: 'trail_master_db',
    PGUSER: 'tester'
  }
});

if (result.status === 0) {
  console.log('\n✅ Export completed successfully!');
  
  // Check the database for route recommendations
  console.log('\n🔍 Checking for route recommendations in the database...');
  
  const checkResult = spawnSync('sqlite3', [
    'test-chautauqua-debug.db',
    'SELECT COUNT(*) as route_count FROM route_recommendations;'
  ], {
    stdio: 'pipe',
    encoding: 'utf8'
  });
  
  if (checkResult.status === 0) {
    const routeCount = checkResult.stdout.trim();
    console.log(`📊 Found ${routeCount} route recommendations in the database`);
  } else {
    console.log('❌ Failed to check route recommendations in database');
  }
} else {
  console.log('\n❌ Export failed with exit code:', result.status);
} 