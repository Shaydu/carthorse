#!/usr/bin/env node
/**
 * Test script to verify bbox calculation during export
 * This script tests the bbox calculation fix for the SQLite export issue
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_REGION = 'boulder';
const TEST_OUTPUT = 'test-bbox-calculation.db';
const TEST_LIMIT = '10'; // Limit to 10 trails for quick testing

console.log('🧪 Testing bbox calculation fix...');

// Clean up any existing test database
if (fs.existsSync(TEST_OUTPUT)) {
  fs.unlinkSync(TEST_OUTPUT);
  console.log('🧹 Cleaned up existing test database');
}

try {
  // Run carthorse export with test limit
  console.log(`🚀 Running carthorse export for ${TEST_REGION} (limit: ${TEST_LIMIT})...`);
  execSync(`CARTHORSE_TEST_LIMIT=${TEST_LIMIT} npx ts-node src/cli/export.ts --region ${TEST_REGION} --out ${TEST_OUTPUT} --verbose`, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PGDATABASE: 'trail_master_db_test',
      PGUSER: 'tester'
    }
  });

  console.log('✅ Export completed successfully');

  // Check the SQLite database for bbox values
  console.log('🔍 Checking bbox values in exported database...');
  
  const Database = require('better-sqlite3');
  const db = new Database(TEST_OUTPUT, { readonly: true });

  // Check total trails
  const totalTrails = db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
  console.log(`📊 Total trails in export: ${totalTrails}`);

  // Check trails with bbox values
  const trailsWithBbox = db.prepare(`
    SELECT COUNT(*) as count 
    FROM trails 
    WHERE bbox_min_lng IS NOT NULL 
      AND bbox_max_lng IS NOT NULL 
      AND bbox_min_lat IS NOT NULL 
      AND bbox_max_lat IS NOT NULL
  `).get().count;
  console.log(`📊 Trails with bbox values: ${trailsWithBbox}`);

  // Check trails without bbox values
  const trailsWithoutBbox = db.prepare(`
    SELECT COUNT(*) as count 
    FROM trails 
    WHERE bbox_min_lng IS NULL 
      OR bbox_max_lng IS NULL 
      OR bbox_min_lat IS NULL 
      OR bbox_max_lat IS NULL
  `).get().count;
  console.log(`📊 Trails without bbox values: ${trailsWithoutBbox}`);

  // Show sample bbox values
  const sampleTrails = db.prepare(`
    SELECT app_uuid, name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    FROM trails 
    WHERE bbox_min_lng IS NOT NULL 
    LIMIT 5
  `).all();

  console.log('📋 Sample trail bbox values:');
  sampleTrails.forEach(trail => {
    console.log(`  - ${trail.name} (${trail.app_uuid}): [${trail.bbox_min_lng}, ${trail.bbox_min_lat}, ${trail.bbox_max_lng}, ${trail.bbox_max_lat}]`);
  });

  // Validate bbox values are reasonable
  const invalidBbox = db.prepare(`
    SELECT COUNT(*) as count 
    FROM trails 
    WHERE bbox_min_lng > bbox_max_lng 
      OR bbox_min_lat > bbox_max_lat
  `).get().count;
  console.log(`📊 Trails with invalid bbox (min > max): ${invalidBbox}`);

  // Check if bbox values are within reasonable bounds for Boulder
  const boulderBbox = db.prepare(`
    SELECT COUNT(*) as count 
    FROM trails 
    WHERE bbox_min_lng < -106 OR bbox_max_lng > -104
      OR bbox_min_lat < 39 OR bbox_max_lat > 41
  `).get().count;
  console.log(`📊 Trails with bbox outside Boulder area: ${boulderBbox}`);

  db.close();

  // Summary
  console.log('\n📋 Test Summary:');
  console.log(`  - Total trails: ${totalTrails}`);
  console.log(`  - Trails with bbox: ${trailsWithBbox}`);
  console.log(`  - Trails without bbox: ${trailsWithoutBbox}`);
  console.log(`  - Invalid bbox: ${invalidBbox}`);
  console.log(`  - Outside Boulder area: ${boulderBbox}`);

  if (trailsWithBbox === totalTrails && trailsWithoutBbox === 0 && invalidBbox === 0) {
    console.log('✅ SUCCESS: All trails have valid bbox values!');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Some trails are missing bbox values or have invalid bbox');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
} finally {
  // Clean up test database
  if (fs.existsSync(TEST_OUTPUT)) {
    fs.unlinkSync(TEST_OUTPUT);
    console.log('🧹 Cleaned up test database');
  }
} 