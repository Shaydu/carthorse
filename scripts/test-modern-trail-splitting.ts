#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { PgRoutingSplittingService } from '../src/services/layer1/PgRoutingSplittingService';

const client = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

async function testModernTrailSplitting() {
  try {
    await client.connect();
    console.log('🔗 Testing modern trail splitting approaches...');

    const stagingSchema = 'test_modern_splitting';
    
    // Create test staging schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        region TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB
      )
    `);

    // Create intersection_points table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters DOUBLE PRECISION
      )
    `);

    // Copy some test data from production
    console.log('📋 Copying test data from production...');
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, geometry, length_km, 
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      )
      SELECT 
        app_uuid, name, region, geometry, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      FROM trails 
      WHERE region = 'boulder' 
      LIMIT 50
    `);

    const initialCountResult = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    const initialCount = parseInt(initialCountResult.rows[0].count);
    console.log(`📊 Loaded ${initialCount} test trails`);

    // Test 1: Modern PostGIS ST_Node() approach
    console.log('\n🧪 Test 1: Modern PostGIS ST_Node() approach');
    const postgisSplittingService = new PgRoutingSplittingService({
      stagingSchema,
      pgClient: client,
      toleranceMeters: 0.00001,
      minSegmentLengthMeters: 1.0,
      preserveOriginalTrails: true
    });

    const postgisResult = await postgisSplittingService.splitTrailsAtIntersections();
    console.log('✅ PostGIS ST_Node() splitting completed:');
    console.log(`   📊 Original trails: ${postgisResult.originalTrailCount}`);
    console.log(`   🔗 Split segments: ${postgisResult.splitSegmentCount}`);
    console.log(`   📍 Intersection points: ${postgisResult.intersectionPointsFound}`);

    // Test 2: Modern pgRouting functions approach
    console.log('\n🧪 Test 2: Modern pgRouting functions approach');
    
    // Reset trails table for second test
    await client.query(`DROP TABLE ${stagingSchema}.trails`);
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, geometry, length_km, 
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      )
      SELECT 
        app_uuid, name, region, geometry, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      FROM trails 
      WHERE region = 'boulder' 
      LIMIT 50
    `);

    const pgroutingResult = await postgisSplittingService.splitTrailsWithPgRouting();
    console.log('✅ pgRouting functions splitting completed:');
    console.log(`   📊 Original trails: ${pgroutingResult.originalTrailCount}`);
    console.log(`   🔗 Split segments: ${pgroutingResult.splitSegmentCount}`);
    console.log(`   📍 Intersection points: ${pgroutingResult.intersectionPointsFound}`);

    // Test 3: Intersection point detection
    console.log('\n🧪 Test 3: Intersection point detection');
    const intersectionCount = await postgisSplittingService.detectIntersectionPoints();
    console.log(`✅ Detected ${intersectionCount} intersection points`);

    // Test 4: Get statistics
    console.log('\n🧪 Test 4: Split statistics');
    const stats = await postgisSplittingService.getSplitStatistics();
    console.log('✅ Split statistics:');
    console.log(`   📊 Total segments: ${stats.total_segments}`);
    console.log(`   🛤️ Original trails: ${stats.original_trails}`);
    console.log(`   📏 Average length: ${parseFloat(stats.avg_length_km).toFixed(3)}km`);
    console.log(`   📏 Min length: ${parseFloat(stats.min_length_km).toFixed(3)}km`);
    console.log(`   📏 Max length: ${parseFloat(stats.max_length_km).toFixed(3)}km`);
    console.log(`   📏 Total length: ${parseFloat(stats.total_length_km).toFixed(3)}km`);

    // Compare results
    console.log('\n📊 Comparison Results:');
    console.log(`   PostGIS ST_Node(): ${postgisResult.splitSegmentCount} segments`);
    console.log(`   pgRouting functions: ${pgroutingResult.splitSegmentCount} segments`);
    console.log(`   Difference: ${Math.abs(postgisResult.splitSegmentCount - pgroutingResult.splitSegmentCount)} segments`);

    console.log('\n✅ Modern trail splitting tests completed successfully!');

  } catch (error) {
    console.error('❌ Error during modern trail splitting tests:', error);
  } finally {
    await client.end();
  }
}

// Run the test
testModernTrailSplitting().catch(console.error);
