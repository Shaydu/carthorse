#!/usr/bin/env node
/**
 * Test script to verify bbox calculation when source data has missing bbox values
 * This script artificially removes bbox values to test the calculation logic
 */

const { Client } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');

// Test configuration
const TEST_REGION = 'boulder';
const TEST_OUTPUT = 'test-bbox-calculation-missing.db';
const TEST_LIMIT = '5'; // Limit to 5 trails for quick testing

console.log('🧪 Testing bbox calculation with missing source data...');

// Clean up any existing test database
if (fs.existsSync(TEST_OUTPUT)) {
  fs.unlinkSync(TEST_OUTPUT);
  console.log('🧹 Cleaned up existing test database');
}

async function testBboxCalculationWithMissingData() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db_test',
    user: 'tester',
    password: process.env.PGPASSWORD
  });

  try {
    await client.connect();
    console.log('🔗 Connected to test database');

    // First, let's check the current bbox values
    const currentBboxCheck = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(bbox_min_lng) as with_bbox,
             COUNT(*) - COUNT(bbox_min_lng) as without_bbox
      FROM trails 
      WHERE region = $1
      LIMIT ${TEST_LIMIT}
    `, [TEST_REGION]);

    console.log('📊 Current bbox status in source data:');
    console.log(`  - Total trails: ${currentBboxCheck.rows[0].total}`);
    console.log(`  - With bbox: ${currentBboxCheck.rows[0].with_bbox}`);
    console.log(`  - Without bbox: ${currentBboxCheck.rows[0].without_bbox}`);

    // Artificially remove bbox values from a few trails to test the calculation
    console.log('🧪 Artificially removing bbox values from source data...');
    const removeBboxResult = await client.query(`
      UPDATE trails 
      SET bbox_min_lng = NULL, bbox_max_lng = NULL, bbox_min_lat = NULL, bbox_max_lat = NULL
      WHERE region = $1 
      AND id IN (
        SELECT id FROM trails WHERE region = $2 LIMIT 3
      )
    `, [TEST_REGION, TEST_REGION]);

    console.log(`✅ Removed bbox values from ${removeBboxResult.rowCount} trails`);

    // Verify the bbox values were removed
    const afterRemovalCheck = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(bbox_min_lng) as with_bbox,
             COUNT(*) - COUNT(bbox_min_lng) as without_bbox
      FROM trails 
      WHERE region = $1
      LIMIT ${TEST_LIMIT}
    `, [TEST_REGION]);

    console.log('📊 After removing bbox values:');
    console.log(`  - Total trails: ${afterRemovalCheck.rows[0].total}`);
    console.log(`  - With bbox: ${afterRemovalCheck.rows[0].with_bbox}`);
    console.log(`  - Without bbox: ${afterRemovalCheck.rows[0].without_bbox}`);

    await client.end();

    // Now run the carthorse export
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
      WHERE bbox_min_lng >= bbox_max_lng 
        OR bbox_min_lat >= bbox_max_lat
    `).get().count;
    console.log(`📊 Trails with invalid bbox (min >= max): ${invalidBbox}`);

    db.close();

    // Summary
    console.log('\n📋 Test Summary:');
    console.log(`  - Total trails: ${totalTrails}`);
    console.log(`  - Trails with bbox: ${trailsWithBbox}`);
    console.log(`  - Trails without bbox: ${trailsWithoutBbox}`);
    console.log(`  - Invalid bbox: ${invalidBbox}`);

    if (trailsWithBbox === totalTrails && trailsWithoutBbox === 0 && invalidBbox === 0) {
      console.log('✅ SUCCESS: All trails have valid bbox values after calculation!');
      return true;
    } else {
      console.log('❌ FAILURE: Some trails are missing bbox values or have invalid bbox');
      return false;
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  } finally {
    // Clean up test database
    if (fs.existsSync(TEST_OUTPUT)) {
      fs.unlinkSync(TEST_OUTPUT);
      console.log('🧹 Cleaned up test database');
    }
  }
}

// Run the test
testBboxCalculationWithMissingData().then(success => {
  process.exit(success ? 0 : 1);
}); 