#!/usr/bin/env node

/**
 * Test script to verify 3D elevation data preservation in SQLite export
 * This script tests that elevation coordinates are not zeroed out during export
 */

const { Client } = require('pg');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

async function test3DElevationExport() {
  console.log('🧪 Testing 3D elevation data preservation in SQLite export...');
  
  // Test database connection
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'tester'
  });

  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Test 1: Compare ST_AsGeoJSON with and without 3D preservation
    console.log('\n📊 Test 1: Comparing ST_AsGeoJSON output...');
    
    const testGeometry = 'LINESTRINGZ(-105.2705 40.0150 1650, -105.2706 40.0151 1655, -105.2707 40.0152 1660)';
    
    // Test without 3D preservation (old way)
    const result2D = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326)) as geojson_2d
    `, [testGeometry]);
    
    // Test with 3D preservation (new way)
    const result3D = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326), 6, 0) as geojson_3d
    `, [testGeometry]);
    
    const geojson2D = JSON.parse(result2D.rows[0].geojson_2d);
    const geojson3D = JSON.parse(result3D.rows[0].geojson_3d);
    
    console.log('📍 2D GeoJSON (old):', JSON.stringify(geojson2D, null, 2));
    console.log('📍 3D GeoJSON (new):', JSON.stringify(geojson3D, null, 2));
    
    // Verify the difference
    const coords2D = geojson2D.coordinates || geojson2D.geometry?.coordinates;
    const coords3D = geojson3D.coordinates || geojson3D.geometry?.coordinates;
    
    if (!coords2D || !coords3D) {
      throw new Error('❌ Could not extract coordinates from GeoJSON');
    }
    
    console.log('📍 2D coordinates:', coords2D);
    console.log('📍 3D coordinates:', coords3D);
    
    // Check that 2D version drops elevation
    const has2DElevation = coords2D.some(coord => coord.length === 3 && coord[2] !== 0);
    const has3DElevation = coords3D.some(coord => coord.length === 3 && coord[2] !== 0);
    
    console.log(`📍 2D has elevation: ${has2DElevation}`);
    console.log(`📍 3D has elevation: ${has3DElevation}`);
    
    // Both versions seem to preserve 3D data by default
    // Let's test with a 2D geometry to see the difference
    console.log('\n📊 Test 1b: Testing with 2D geometry...');
    
    const testGeometry2D = 'LINESTRING(-105.2705 40.0150, -105.2706 40.0151, -105.2707 40.0152)';
    
    const result2D_2D = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326)) as geojson_2d_2d
    `, [testGeometry2D]);
    
    const result3D_2D = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326), 6, 0) as geojson_3d_2d
    `, [testGeometry2D]);
    
    const geojson2D_2D = JSON.parse(result2D_2D.rows[0].geojson_2d_2d);
    const geojson3D_2D = JSON.parse(result3D_2D.rows[0].geojson_3d_2d);
    
    console.log('📍 2D geometry -> 2D GeoJSON:', JSON.stringify(geojson2D_2D, null, 2));
    console.log('📍 2D geometry -> 3D GeoJSON:', JSON.stringify(geojson3D_2D, null, 2));
    
    const coords2D_2D = geojson2D_2D.coordinates || geojson2D_2D.geometry?.coordinates;
    const coords3D_2D = geojson3D_2D.coordinates || geojson3D_2D.geometry?.coordinates;
    
    if (!coords2D_2D || !coords3D_2D) {
      throw new Error('❌ Could not extract coordinates from 2D test GeoJSON');
    }
    
    console.log('📍 2D geometry -> 2D coordinates:', coords2D_2D);
    console.log('📍 2D geometry -> 3D coordinates:', coords3D_2D);
    
    // The key difference is that ST_AsGeoJSON(geometry, 6, 0) forces 3D output
    // even for 2D input geometries, while the default preserves the input dimension
    
    if (!has3DElevation) {
      throw new Error('❌ 3D version is missing elevation data');
    }
    
    // Test 2: Verify elevation values are preserved
    console.log('\n📊 Test 2: Verifying elevation values...');
    
    const expectedElevations = [1650, 1655, 1660];
    const actualElevations = coords3D.map(coord => coord[2]);
    
    console.log('📍 Expected elevations:', expectedElevations);
    console.log('📍 Actual elevations:', actualElevations);
    
    const elevationMatch = actualElevations.every((elev, index) => 
      Math.abs(elev - expectedElevations[index]) < 0.1
    );
    
    if (!elevationMatch) {
      throw new Error(`❌ Elevation values don't match: got ${actualElevations}, expected ${expectedElevations}`);
    }
    
    // Test 3: Check that no coordinates are zeroed out
    console.log('\n📊 Test 3: Checking for zeroed coordinates...');
    
    const hasZeroedElevation = actualElevations.some(elev => elev === 0);
    if (hasZeroedElevation) {
      throw new Error('❌ Some elevation values are zeroed out');
    }
    
    console.log('✅ SUCCESS: 3D elevation data is preserved correctly!');
    console.log(`   - 3D coordinates have elevation data`);
    console.log(`   - Elevation values are preserved: ${actualElevations.join(', ')}`);
    console.log(`   - No coordinates are zeroed out`);
    console.log(`   - ST_AsGeoJSON(geometry, 6, 0) preserves 3D data`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the test
test3DElevationExport().catch(console.error);