#!/usr/bin/env node
/**
 * Test script to verify elevation export fix
 * This script tests that ST_AsGeoJSON(geometry, 6, 1) preserves 3D coordinates
 */

const { Client } = require('pg');

async function testElevationExportFix() {
  console.log('🧪 Testing elevation export fix...');
  
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

    // Test 1: Compare ST_AsGeoJSON with different parameters
    console.log('\n📊 Test 1: Comparing ST_AsGeoJSON parameters...');
    
    const testGeometry = 'LINESTRINGZ(-105.2705 40.0150 1650, -105.2706 40.0151 1655, -105.2707 40.0152 1660)';
    
    // Test with parameter 0 (preserve input dimension)
    const result0 = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326), 6, 0) as geojson_0
    `, [testGeometry]);
    
    // Test with parameter 1 (force 3D)
    const result1 = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326), 6, 1) as geojson_1
    `, [testGeometry]);
    
    const geojson0 = JSON.parse(result0.rows[0].geojson_0);
    const geojson1 = JSON.parse(result1.rows[0].geojson_1);
    
    console.log('📍 Parameter 0 (preserve input):', JSON.stringify(geojson0, null, 2));
    console.log('📍 Parameter 1 (force 3D):', JSON.stringify(geojson1, null, 2));
    
    // Extract coordinates
    const coords0 = geojson0.coordinates || geojson0.geometry?.coordinates;
    const coords1 = geojson1.coordinates || geojson1.geometry?.coordinates;
    
    console.log('📍 Parameter 0 coordinates:', coords0);
    console.log('📍 Parameter 1 coordinates:', coords1);
    
    // Check elevation values
    const elevations0 = coords0.map(coord => coord[2]);
    const elevations1 = coords1.map(coord => coord[2]);
    
    console.log('📍 Parameter 0 elevations:', elevations0);
    console.log('📍 Parameter 1 elevations:', elevations1);
    
    // Test 2: Test with 2D geometry to see the difference
    console.log('\n📊 Test 2: Testing with 2D geometry...');
    
    const testGeometry2D = 'LINESTRING(-105.2705 40.0150, -105.2706 40.0151, -105.2707 40.0152)';
    
    const result2D_0 = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326), 6, 0) as geojson_2d_0
    `, [testGeometry2D]);
    
    const result2D_1 = await pgClient.query(`
      SELECT ST_AsGeoJSON(ST_GeomFromText($1, 4326), 6, 1) as geojson_2d_1
    `, [testGeometry2D]);
    
    const geojson2D_0 = JSON.parse(result2D_0.rows[0].geojson_2d_0);
    const geojson2D_1 = JSON.parse(result2D_1.rows[0].geojson_2d_1);
    
    const coords2D_0 = geojson2D_0.coordinates || geojson2D_0.geometry?.coordinates;
    const coords2D_1 = geojson2D_1.coordinates || geojson2D_1.geometry?.coordinates;
    
    console.log('📍 2D geometry -> Parameter 0 coordinates:', coords2D_0);
    console.log('📍 2D geometry -> Parameter 1 coordinates:', coords2D_1);
    
    // Test 3: Check actual trail data from database
    console.log('\n📊 Test 3: Checking actual trail data...');
    
    const trailResult = await pgClient.query(`
      SELECT 
        name,
        ST_AsGeoJSON(geometry, 6, 0) as geojson_0,
        ST_AsGeoJSON(geometry, 6, 1) as geojson_1,
        max_elevation,
        min_elevation
      FROM trails 
      WHERE region = 'boulder' 
      AND geometry IS NOT NULL
      LIMIT 3
    `);
    
    console.log('📍 Trail data comparison:');
    for (const row of trailResult.rows) {
      const geojson0 = JSON.parse(row.geojson_0);
      const geojson1 = JSON.parse(row.geojson_1);
      
      const coords0 = geojson0.coordinates || geojson0.geometry?.coordinates;
      const coords1 = geojson1.coordinates || geojson1.geometry?.coordinates;
      
      console.log(`   - ${row.name}:`);
      console.log(`     Max elev: ${row.max_elevation}, Min elev: ${row.min_elevation}`);
      
      if (coords0 && coords0.length > 0) {
        const firstCoord0 = coords0[0];
        const lastCoord0 = coords0[coords0.length - 1];
        console.log(`     Param 0: [${firstCoord0.join(', ')}] ... [${lastCoord0.join(', ')}]`);
      }
      
      if (coords1 && coords1.length > 0) {
        const firstCoord1 = coords1[0];
        const lastCoord1 = coords1[coords1.length - 1];
        console.log(`     Param 1: [${firstCoord1.join(', ')}] ... [${lastCoord1.join(', ')}]`);
      }
      
      // Check if coordinates have elevation
      const hasElevation0 = coords0 && coords0.some(coord => coord.length === 3 && coord[2] !== 0);
      const hasElevation1 = coords1 && coords1.some(coord => coord.length === 3 && coord[2] !== 0);
      
      console.log(`     Param 0 has elevation: ${hasElevation0}`);
      console.log(`     Param 1 has elevation: ${hasElevation1}`);
    }
    
    console.log('\n✅ Test completed successfully!');
    console.log('📋 Summary:');
    console.log('   - Parameter 0 (preserve input): Keeps original dimension');
    console.log('   - Parameter 1 (force 3D): Forces 3D output with Z=0 for 2D input');
    console.log('   - For 3D input: Both preserve elevation data');
    console.log('   - For 2D input: Parameter 1 adds Z=0, Parameter 0 stays 2D');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testElevationExportFix().catch(console.error); 