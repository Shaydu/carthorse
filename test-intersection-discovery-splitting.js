#!/usr/bin/env node

/**
 * Test script for discovering intersections programmatically and splitting them
 * This discovers all intersections of the right type and splits them properly
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
  
  // Bbox for Boulder area
  bbox: [-105.323322108554, 39.9414084228671, -105.246109155213, 40.139896554615],
  
  // Service parameters
  toleranceMeters: 5.0,
  minSegmentLengthMeters: 5.0,
  
  // Export options
  exportGeoJSON: true,
  outputDir: 'test-output'
};

async function main() {
  const pgClient = new Client(CONFIG);
  const stagingSchema = `discovery_test_${Date.now()}`;
  
  try {
    console.log('🧪 Testing Programmatic Intersection Discovery and Splitting...\n');
    
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
    
    // Step 1: Discover all intersections between trails
    console.log('\n🔍 Step 1: Discovering all intersections...');
    
    const intersections = await pgClient.query(`
      SELECT 
        t1.id as trail1_id,
        t1.name as trail1_name,
        t1.geometry as trail1_geom,
        t2.id as trail2_id,
        t2.name as trail2_name,
        t2.geometry as trail2_geom,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_Length(t1.geometry::geography) as trail1_length,
        ST_Length(t2.geometry::geography) as trail2_length
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
      ORDER BY trail1_name, trail2_name
    `, [CONFIG.minSegmentLengthMeters]);
    
    console.log(`📊 Found ${intersections.rows.length} point/multipoint intersections`);
    
    // Filter for North Sky and Foothills North intersections specifically
    const targetIntersections = intersections.rows.filter(row => 
      (row.trail1_name.includes('North Sky') && row.trail2_name.includes('Foothills North')) ||
      (row.trail1_name.includes('Foothills North') && row.trail2_name.includes('North Sky'))
    );
    
    console.log(`🎯 Found ${targetIntersections.length} North Sky × Foothills North intersections`);
    
    if (targetIntersections.length === 0) {
      console.log('❌ No target intersections found');
      return;
    }
    
    // Display the intersections we found
    targetIntersections.forEach((intersection, i) => {
      console.log(`   ${i + 1}. ${intersection.trail1_name} (${intersection.trail1_length}m) × ${intersection.trail2_name} (${intersection.trail2_length}m): ${intersection.intersection_type}`);
    });
    
    // Step 2: Create a table to store split trails
    console.log('\n🔧 Step 2: Creating split trails table...');
    
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.split_trails (
        id SERIAL PRIMARY KEY,
        original_id INTEGER,
        name TEXT,
        source TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        split_reason TEXT
      )
    `);
    
    // Step 3: Process each intersection and split the trails
    console.log('\n🔧 Step 3: Splitting trails at intersections...');
    
    let totalSplits = 0;
    
    for (const intersection of targetIntersections) {
      console.log(`\n🔧 Processing: ${intersection.trail1_name} × ${intersection.trail2_name}`);
      
      try {
        // Split trail1 at the intersection point
        const splitResult1 = await pgClient.query(`
          INSERT INTO ${stagingSchema}.split_trails (original_id, name, source, geometry, split_reason)
          SELECT 
            $1 as original_id,
            $2 as name,
            $3 as source,
            (ST_Dump(ST_Split(geometry, $4))).geom as geometry,
            'Split at intersection with ' || $5 as split_reason
          FROM ${stagingSchema}.trails 
          WHERE id = $1
        `, [
          intersection.trail1_id,
          intersection.trail1_name,
          'cotrex',
          intersection.intersection_geom,
          intersection.trail2_name
        ]);
        
        // Split trail2 at the intersection point
        const splitResult2 = await pgClient.query(`
          INSERT INTO ${stagingSchema}.split_trails (original_id, name, source, geometry, split_reason)
          SELECT 
            $1 as original_id,
            $2 as name,
            $3 as source,
            (ST_Dump(ST_Split(geometry, $4))).geom as geometry,
            'Split at intersection with ' || $5 as split_reason
          FROM ${stagingSchema}.trails 
          WHERE id = $1
        `, [
          intersection.trail2_id,
          intersection.trail2_name,
          'cotrex',
          intersection.intersection_geom,
          intersection.trail1_name
        ]);
        
        totalSplits += 2;
        console.log(`   ✅ Split both trails at intersection`);
        
      } catch (error) {
        console.log(`   ❌ Failed to split: ${error.message}`);
      }
    }
    
    // Step 4: Add all other trails that weren't split
    console.log('\n🔧 Step 4: Adding non-split trails...');
    
    const splitTrailIds = targetIntersections.flatMap(i => [i.trail1_id, i.trail2_id]);
    const placeholders = splitTrailIds.map((_, i) => `$${i + 1}`).join(',');
    
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.split_trails (original_id, name, source, geometry, split_reason)
      SELECT id, name, source, geometry, 'Not split'
      FROM ${stagingSchema}.trails 
      WHERE id NOT IN (${placeholders})
    `, splitTrailIds);
    
    // Step 5: Check results
    console.log('\n📊 Step 5: Checking results...');
    
    const finalCount = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.split_trails`);
    console.log(`📊 Total trail segments: ${finalCount.rows[0].count}`);
    
    // Check North Sky and Foothills North results
    const northSkyResults = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m, split_reason
      FROM ${stagingSchema}.split_trails 
      WHERE name = 'North Sky Trail'
      ORDER BY length_m
    `);
    
    const foothillsResults = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m, split_reason
      FROM ${stagingSchema}.split_trails 
      WHERE name = 'Foothills North Trail'
      ORDER BY length_m
    `);
    
    console.log(`\n🔍 North Sky Trail segments: ${northSkyResults.rows.length}`);
    northSkyResults.rows.forEach((trail, i) => {
      console.log(`   ${i + 1}. ${trail.length_m}m (${trail.split_reason})`);
    });
    
    console.log(`\n🔍 Foothills North Trail segments: ${foothillsResults.rows.length}`);
    foothillsResults.rows.forEach((trail, i) => {
      console.log(`   ${i + 1}. ${trail.length_m}m (${trail.split_reason})`);
    });
    
    // Check if we successfully split the target trails
    const northSkySplit = northSkyResults.rows.filter(t => t.split_reason.includes('Split at intersection')).length;
    const foothillsSplit = foothillsResults.rows.filter(t => t.split_reason.includes('Split at intersection')).length;
    
    console.log(`\n📊 Splitting Results:`);
    console.log(`   North Sky Trail: ${northSkySplit} segments split at intersections`);
    console.log(`   Foothills North Trail: ${foothillsSplit} segments split at intersections`);
    
    if (northSkySplit > 0 && foothillsSplit > 0) {
      console.log(`✅ SUCCESS: Target trails were split at intersections!`);
    } else {
      console.log(`❌ FAILED: Target trails were not split at intersections`);
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
                'original_id', original_id,
                'name', name,
                'source', source,
                'length_m', ST_Length(geometry::geography),
                'split_reason', split_reason
              )
            )
          )
        ) as geojson
        FROM ${stagingSchema}.split_trails
      `);
      
      const geojson = geojsonResult.rows[0].geojson;
      const outputPath = path.join(CONFIG.outputDir, `intersection-discovery-test-${stagingSchema}.geojson`);
      
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
