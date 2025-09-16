#!/usr/bin/env node

/**
 * Test script for targeted splitting at specific intersection points
 * This mimics the working JavaScript script approach using ST_Split
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
  const stagingSchema = `targeted_test_${Date.now()}`;
  
  try {
    console.log('🧪 Testing Targeted Splitting at Specific Intersection Points...\n');
    
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
    
    // Find the specific North Sky Trail and Foothills North Trail that intersect
    const targetIntersection = await pgClient.query(`
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
      WHERE ((t1.name = 'North Sky Trail' AND t2.name = 'Foothills North Trail')
             OR (t1.name = 'Foothills North Trail' AND t2.name = 'North Sky Trail'))
        AND ST_Intersects(t1.geometry, t2.geometry)
        AND ((ST_Length(t1.geometry::geography) BETWEEN 100 AND 110 AND ST_Length(t2.geometry::geography) BETWEEN 800 AND 850)
             OR (ST_Length(t1.geometry::geography) BETWEEN 800 AND 850 AND ST_Length(t2.geometry::geography) BETWEEN 100 AND 110))
    `);
    
    if (targetIntersection.rows.length === 0) {
      console.log('❌ No target intersection found between North Sky Trail (106m) and Foothills North Trail (833m)');
      
      // Let's see what intersections we do have
      const allIntersections = await pgClient.query(`
        SELECT 
          t1.name as trail1_name,
          t2.name as trail2_name,
          ST_Length(t1.geometry::geography) as trail1_length,
          ST_Length(t2.geometry::geography) as trail2_length,
          ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE (t1.name = 'North Sky Trail' AND t2.name = 'Foothills North Trail')
           OR (t1.name = 'Foothills North Trail' AND t2.name = 'North Sky Trail')
          AND ST_Intersects(t1.geometry, t2.geometry)
        ORDER BY trail1_length, trail2_length
      `);
      
      console.log(`\n🔍 All North Sky × Foothills North intersections found:`);
      allIntersections.rows.forEach((intersection, i) => {
        console.log(`   ${i + 1}. ${intersection.trail1_name} (${intersection.trail1_length}m) × ${intersection.trail2_name} (${intersection.trail2_length}m): ${intersection.intersection_type}`);
      });
      
      // Use the first intersection if available
      if (allIntersections.rows.length > 0) {
        console.log(`\n🔧 Using first intersection for testing...`);
        const firstIntersection = allIntersections.rows[0];
        
        // Get the full intersection data
        const intersectionData = await pgClient.query(`
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
          WHERE t1.id = $1 AND t2.id = $2
        `, [firstIntersection.trail1_id, firstIntersection.trail2_id]);
        
        if (intersectionData.rows.length > 0) {
          targetIntersection.rows = intersectionData.rows;
        }
      }
    }
    
    if (targetIntersection.rows.length === 0) {
      console.log('❌ No suitable intersection found for testing');
      return;
    }
    
    const intersection = targetIntersection.rows[0];
    console.log(`\n🎯 Target intersection found:`);
    console.log(`   ${intersection.trail1_name} (${intersection.trail1_length}m) × ${intersection.trail2_name} (${intersection.trail2_length}m)`);
    console.log(`   Intersection type: ${intersection.intersection_type}`);
    
    // Create a copy of the trails table for splitting
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.split_trails AS
      SELECT * FROM ${stagingSchema}.trails
    `);
    
    // Apply targeted splitting using ST_Split
    console.log('\n🔧 Applying targeted splitting with ST_Split...');
    
    // Split trail1 at the intersection point
    const splitTrail1 = await pgClient.query(`
      UPDATE ${stagingSchema}.split_trails 
      SET geometry = ST_Split(geometry, $1)
      WHERE id = $2
    `, [intersection.intersection_geom, intersection.trail1_id]);
    
    // Split trail2 at the intersection point
    const splitTrail2 = await pgClient.query(`
      UPDATE ${stagingSchema}.split_trails 
      SET geometry = ST_Split(geometry, $1)
      WHERE id = $2
    `, [intersection.intersection_geom, intersection.trail2_id]);
    
    // Convert the split geometries to individual segments
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
    
    // Check if the target trails were split
    const northSkyAfter = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.final_trails 
      WHERE name = 'North Sky Trail'
      ORDER BY length_m
    `);
    
    const foothillsAfter = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.final_trails 
      WHERE name = 'Foothills North Trail'
      ORDER BY length_m
    `);
    
    console.log(`\n🔍 Target trails after splitting:`);
    console.log(`   North Sky Trail segments: ${northSkyAfter.rows.length}`);
    northSkyAfter.rows.forEach((trail, i) => {
      console.log(`     ${i + 1}. ${trail.length_m}m`);
    });
    
    console.log(`   Foothills North Trail segments: ${foothillsAfter.rows.length}`);
    foothillsAfter.rows.forEach((trail, i) => {
      console.log(`     ${i + 1}. ${trail.length_m}m`);
    });
    
    // Check if we got the expected results
    const expectedNorthSkySegments = 2; // Should be split into 2 segments
    const expectedFoothillsSegments = 2; // Should be split into 2 segments
    
    console.log(`\n📊 Splitting Results:`);
    console.log(`   North Sky Trail: ${northSkyAfter.rows.length} segments (expected: ${expectedNorthSkySegments})`);
    console.log(`   Foothills North Trail: ${foothillsAfter.rows.length} segments (expected: ${expectedFoothillsSegments})`);
    
    if (northSkyAfter.rows.length >= expectedNorthSkySegments && foothillsAfter.rows.length >= expectedFoothillsSegments) {
      console.log(`✅ SUCCESS: Target trails were split as expected!`);
    } else {
      console.log(`❌ FAILED: Target trails were not split as expected`);
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
      const outputPath = path.join(CONFIG.outputDir, `targeted-splitting-test-${stagingSchema}.geojson`);
      
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
