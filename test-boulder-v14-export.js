#!/usr/bin/env node
/**
 * Test Boulder Export to v14 SQLite Schema
 * 
 * This script tests exporting the Boulder region to the new v14 SQLite schema
 * with enhanced route recommendations and trail composition tracking.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const TEST_DB_PATH = './test-output/boulder-v14-test.db';
const REGION = 'boulder';

console.log('🧪 Testing Boulder export to v14 SQLite schema...');

// Ensure test output directory exists
const testOutputDir = path.dirname(TEST_DB_PATH);
if (!fs.existsSync(testOutputDir)) {
  fs.mkdirSync(testOutputDir, { recursive: true });
}

// Clean up any existing test database
if (fs.existsSync(TEST_DB_PATH)) {
  console.log('🗑️  Removing existing test database...');
  fs.unlinkSync(TEST_DB_PATH);
}

// Test export command
const exportCommand = [
  'npx', 'ts-node', 'src/cli/export.ts',
  '--region', REGION,
  '--out', TEST_DB_PATH,
  '--verbose'
];

console.log('📤 Running export command:', exportCommand.join(' '));

const result = spawnSync(exportCommand[0], exportCommand.slice(1), {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Ensure we're using the test database
    PGDATABASE: process.env.PGDATABASE || 'trail_master_db_test'
  }
});

if (result.status !== 0) {
  console.error('❌ Export failed with status:', result.status);
  process.exit(1);
}

// Verify the exported database
console.log('🔍 Verifying exported database...');

if (!fs.existsSync(TEST_DB_PATH)) {
  console.error('❌ Test database was not created');
  process.exit(1);
}

// Check database size
const stats = fs.statSync(TEST_DB_PATH);
const sizeMB = stats.size / (1024 * 1024);
console.log(`📊 Database size: ${sizeMB.toFixed(2)} MB`);

// Use sqlite3 to verify schema
const schemaCommand = ['sqlite3', TEST_DB_PATH, '.schema'];
const schemaResult = spawnSync(schemaCommand[0], schemaCommand.slice(1), {
  stdio: 'pipe',
  encoding: 'utf8'
});

if (schemaResult.status !== 0) {
  console.error('❌ Failed to read database schema');
  process.exit(1);
}

const schema = schemaResult.stdout;

// Check for v14 specific features
const v14Features = {
  route_trails: schema.includes('CREATE TABLE IF NOT EXISTS route_trails'),
  route_recommendations_v14: schema.includes('route_gain_rate') && schema.includes('route_trail_count'),
  route_trail_composition_view: schema.includes('CREATE VIEW route_trail_composition'),
  enhanced_constraints: schema.includes('route_connectivity_score') && schema.includes('route_estimated_time_hours')
};

console.log('🔍 v14 Schema Features Check:');
Object.entries(v14Features).forEach(([feature, present]) => {
  console.log(`  ${present ? '✅' : '❌'} ${feature}`);
});

// Check table counts
const countCommand = ['sqlite3', TEST_DB_PATH, 'SELECT COUNT(*) as count FROM trails;'];
const countResult = spawnSync(countCommand[0], countCommand.slice(1), {
  stdio: 'pipe',
  encoding: 'utf8'
});

if (countResult.status === 0) {
  const trailCount = parseInt(countResult.stdout.trim());
  console.log(`📊 Exported ${trailCount} trails`);
}

// Check route recommendations if they exist
const routeCountCommand = ['sqlite3', TEST_DB_PATH, 'SELECT COUNT(*) as count FROM route_recommendations;'];
const routeCountResult = spawnSync(routeCountCommand[0], routeCountCommand.slice(1), {
  stdio: 'pipe',
  encoding: 'utf8'
});

if (routeCountResult.status === 0) {
  const routeCount = parseInt(routeCountResult.stdout.trim());
  console.log(`📊 Found ${routeCount} route recommendations`);
}

console.log('✅ Boulder v14 export test completed successfully!');
console.log(`📁 Test database: ${TEST_DB_PATH}`); 