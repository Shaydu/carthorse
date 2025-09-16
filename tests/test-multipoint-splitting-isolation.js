#!/usr/bin/env node

/**
 * Test script for MultipointIntersectionSplittingService in isolation
 * This script tests only the multipoint intersection splitting service
 * to see if it can properly handle the North Sky/Foothills North intersection
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
  minTrailLengthMeters: 5.0,
  maxIntersectionPoints: 10,
  maxIterations: 20,
  verbose: true,
  
  // Export options
  exportGeoJSON: true,
  outputDir: 'test-output'
};

async function main() {
  const pgClient = new Client(CONFIG);
  const stagingSchema = `multipoint_test_${Date.now()}`;
  
  try {
    console.log('🧪 Testing MultipointIntersectionSplittingService in Isolation...\n');
    
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
    
    // Copy intersection points to staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.intersection_points AS 
      SELECT * FROM public.intersection_points 
      WHERE ST_Intersects(point, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [minLng, minLat, maxLng, maxLat]);
    
    const intersectionCount = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.intersection_points`);
    console.log(`📊 Found ${intersectionCount.rows[0].count} intersection points in bbox`);
    
    // Create routing_nodes table
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.routing_nodes AS 
      SELECT 
        ROW_NUMBER() OVER (ORDER BY point) as id,
        point as geometry
      FROM ${stagingSchema}.intersection_points
    `);
    
    const nodeCount = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes`);
    console.log(`📊 Created ${nodeCount.rows[0].count} routing nodes`);
    
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
    
    // Check for intersections between North Sky and Foothills North
    const intersections = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%north sky%' AND t2.name ILIKE '%foothills north%')
         OR (t1.name ILIKE '%foothills north%' AND t2.name ILIKE '%north sky%')
        AND ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    console.log(`\n🔍 Intersections found: ${intersections.rows.length}`);
    intersections.rows.forEach(intersection => {
      console.log(`   ${intersection.trail1_name} × ${intersection.trail2_name}: ${intersection.intersection_type}`);
    });
    
    // Import and run MultipointIntersectionSplittingService
    console.log('\n🔧 Running MultipointIntersectionSplittingService...');
    
    // We need to import the service - let's use a dynamic import
    const { MultipointIntersectionSplittingService } = await import('../dist/src/services/layer1/MultipointIntersectionSplittingService.js');
    
    const multipointService = new MultipointIntersectionSplittingService(pgClient, {
      stagingSchema,
      toleranceMeters: CONFIG.toleranceMeters,
      minTrailLengthMeters: CONFIG.minTrailLengthMeters,
      maxIntersectionPoints: CONFIG.maxIntersectionPoints,
      maxIterations: CONFIG.maxIterations,
      verbose: CONFIG.verbose
    });
    
    // Get statistics before processing
    const statsBefore = await multipointService.getIntersectionStatistics();
    console.log(`📊 Before processing: ${statsBefore.totalIntersections} multipoint intersections`);
    console.log(`   - X-intersections: ${statsBefore.xIntersections}`);
    console.log(`   - P-intersections: ${statsBefore.pIntersections}`);
    
    // Run the service
    const result = await multipointService.splitMultipointIntersections();
    
    console.log(`\n✅ MultipointIntersectionSplittingService completed!`);
    console.log(`📊 Results: ${JSON.stringify(result, null, 2)}`);
    
    // Get statistics after processing
    const statsAfter = await multipointService.getIntersectionStatistics();
    console.log(`📊 After processing: ${statsAfter.totalIntersections} multipoint intersections remaining`);
    
    // Check if North Sky trail was split
    const northSkyAfter = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%north sky%'
      ORDER BY name
    `);
    
    const foothillsAfter = await pgClient.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%foothills north%'
      ORDER BY name
    `);
    
    console.log(`\n🔍 Trails after processing:`);
    console.log(`   North Sky trails: ${northSkyAfter.rows.length}`);
    northSkyAfter.rows.forEach(trail => {
      console.log(`     - ${trail.name}: ${trail.length_m}m`);
    });
    
    console.log(`   Foothills North trails: ${foothillsAfter.rows.length}`);
    foothillsAfter.rows.forEach(trail => {
      console.log(`     - ${trail.name}: ${trail.length_m}m`);
    });
    
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
        FROM ${stagingSchema}.trails
      `);
      
      const geojson = geojsonResult.rows[0].geojson;
      const outputPath = path.join(CONFIG.outputDir, `multipoint-splitting-test-${stagingSchema}.geojson`);
      
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
