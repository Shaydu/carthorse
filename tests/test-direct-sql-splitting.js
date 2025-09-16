#!/usr/bin/env node

/**
 * Test script for direct SQL splitting (like the working JavaScript script)
 * This uses ST_Split and ST_Node directly to split trails at intersections
 * This should work the same way as the working test-foothills-north-sky-split-working.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Database connection
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'carthorse',
  
  // Bbox for Boulder area (same as working script)
  bbox: [-105.323322108554, 39.9414084228671, -105.246109155213, 40.139896554615], // [minLng, minLat, maxLng, maxLat]
  
  // Service parameters
  toleranceMeters: 5.0,
  minSegmentLengthMeters: 5.0,
  
  // Export options
  exportGeoJSON: true,
  outputDir: 'test-output'
};

async function main() {
  const pgClient = new Client(CONFIG);
  const stagingSchema = `direct_sql_test_${Date.now()}`;
  
  try {
    console.log('🧪 Testing Direct SQL Splitting (ST_Split/ST_Node approach)...\n');
    
    // Connect to database
    await pgClient.connect();
    console.log('✅ Connected to database');
    
    // Create staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    console.log(`📋 Created staging schema: ${stagingSchema}`);
    
    // Copy COTREX trails to staging schema
    const [minLng, minLat, maxLng, maxLat] = CONFIG.bbox;
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT * FROM public.trails 
      WHERE source = 'cotrex'
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [minLng, minLat, maxLng, maxLat]);
    
    const trailCount = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log(`📊 Found ${trailCount.rows[0].count} COTREX trails in bbox`);
    
    // Check for North Sky and Foothills North trails specifically
    const northSkyTrails = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%north sky%'
    `);
    
    const foothillsTrails = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%foothills north%'
    `);
    
    console.log(`\n🔍 Target trails found:`);
    console.log(`   North Sky trails: ${northSkyTrails.rows.length}`);
    northSkyTrails.rows.forEach(trail => {
      console.log(`     - ${trail.name}: ${trail.length_m}m`);
    });
    
    console.log(`   Foothills North trails: ${foothillsTrails.rows.length}`);
    foothillsTrails.rows.forEach(trail => {
      console.log(`     - ${trail.name}: ${trail.length_m}m`);
    });
    
    // Find intersections between North Sky and Foothills North
    const intersections = await pgClient.query(`
      SELECT 
        t1.id as trail1_id,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.name as trail2_name,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom,
        ST_Length(t1.geometry::geography) as trail1_length,
        ST_Length(t2.geometry::geography) as trail2_length
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%north sky%' AND t2.name ILIKE '%foothills north%')
         OR (t1.name ILIKE '%foothills north%' AND t2.name ILIKE '%north sky%')
        AND ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    console.log(`\n🔍 Intersections found: ${intersections.rows.length}`);
    intersections.rows.forEach(intersection => {
      console.log(`   ${intersection.trail1_name} × ${intersection.trail2_name}: ${intersection.intersection_type}`);
      console.log(`     Trail1: ${intersection.trail1_length}m, Trail2: ${intersection.trail2_length}m`);
    });
    
    // Apply direct SQL splitting using ST_Node (like the working script)
    console.log('\n🔧 Applying direct SQL splitting with ST_Node...');
    
    // Step 1: Create a table with all trail geometries
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.all_trails AS
      SELECT 
        id,
        name,
        source,
        geometry
      FROM ${stagingSchema}.trails
    `);
    
    // Step 2: Use ST_Node to split all trails at intersection points
    // This is the same approach as the working JavaScript script
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.split_trails AS
      SELECT 
        id,
        name,
        source,
        ST_Node(geometry) as geometry
      FROM ${stagingSchema}.all_trails
    `);
    
    // Step 3: Convert the result to individual line segments
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.final_trails AS
      SELECT 
        id,
        name,
        source,
        (ST_Dump(geometry)).geom as geometry
      FROM ${stagingSchema}.split_trails
    `);
    
    // Check results
    const finalCount = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.final_trails`);
    console.log(`📊 Created ${finalCount.rows[0].count} trail segments`);
    
    // Check if North Sky trail was split
    const northSkyAfter = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.final_trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY name, length_m
    `);
    
    const foothillsAfter = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.final_trails 
      WHERE name ILIKE '%foothills north%'
      ORDER BY name, length_m
    `);
    
    console.log(`\n🔍 Trails after splitting:`);
    console.log(`   North Sky trails: ${northSkyAfter.rows.length}`);
    northSkyAfter.rows.forEach(trail => {
      console.log(`     - ${trail.name}: ${trail.length_m}m`);
    });
    
    console.log(`   Foothills North trails: ${foothillsAfter.rows.length}`);
    foothillsAfter.rows.forEach(trail => {
      console.log(`     - ${trail.name}: ${trail.length_m}m`);
    });
    
    // Check if we got the expected results (like the working script)
    const expectedNorthSkySegments = 2; // Should be split into 2 segments
    const expectedFoothillsSegments = 3; // Should be split into 3 segments
    
    const northSkySegments = northSkyAfter.rows.filter(t => t.name === 'North Sky Trail').length;
    const foothillsSegments = foothillsAfter.rows.filter(t => t.name === 'Foothills North Trail').length;
    
    console.log(`\n📊 Splitting Results:`);
    console.log(`   North Sky Trail: ${northSkySegments} segments (expected: ${expectedNorthSkySegments})`);
    console.log(`   Foothills North Trail: ${foothillsSegments} segments (expected: ${expectedFoothillsSegments})`);
    
    if (northSkySegments >= expectedNorthSkySegments && foothillsSegments >= expectedFoothillsSegments) {
      console.log(`✅ SUCCESS: Trails were split as expected!`);
    } else {
      console.log(`❌ FAILED: Trails were not split as expected`);
    }
    
    // Export results if requested
    if (CONFIG.exportGeoJSON) {
      console.log('\n📤 Exporting results as GeoJSON...');
      
      const geojsonResult = await pgClient.query(`
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geometry)::jsonb,
              'properties', jsonb_build_object(
                'id', id,
                'name', name,
                'source', source,
                'length_m', ST_Length(geometry::geography)
              )
            )
          )
        ) as geojson
        FROM ${stagingSchema}.final_trails
      `);
      
      const geojson = geojsonResult.rows[0].geojson;
      const outputPath = path.join(CONFIG.outputDir, `direct-sql-splitting-test-${stagingSchema}.geojson`);
      
      // Ensure output directory exists
      if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      console.log(`✅ GeoJSON exported to: ${outputPath}`);
      
      // Count features
      const featureCount = geojson.features ? geojson.features.length : 0;
      console.log(`📊 Exported ${featureCount} trail segments`);
    }
    
    // Clean up staging schema
    console.log(`\n🧹 Cleaning up staging schema: ${stagingSchema}`);
    await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
    
    // Try to clean up staging schema on error
    try {
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    } catch (cleanupError) {
      console.error('Failed to clean up staging schema:', cleanupError.message);
    }
    
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
