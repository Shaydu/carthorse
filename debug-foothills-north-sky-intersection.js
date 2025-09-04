#!/usr/bin/env node

const { Pool } = require('pg');

async function debugFoothillsNorthSkyIntersection() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Debugging Foothills North Trail and North Sky Trail intersection...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'trails' 
        AND schemaname LIKE 'carthorse_%'
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with trails found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Test 1: Basic intersection detection
    console.log('\n🔍 Test 1: Basic ST_Intersects detection...');
    
    const basicIntersection = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_text,
        ST_Length(t1.geometry::geography) as trail1_length,
        ST_Length(t2.geometry::geography) as trail2_length
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE (t1.name ILIKE '%foothills north%' AND t2.name ILIKE '%north sky%')
         OR (t1.name ILIKE '%north sky%' AND t2.name ILIKE '%foothills north%')
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`\n📊 Basic intersection results (${basicIntersection.rows.length}):`);
    basicIntersection.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     ST_Intersects: ${row.intersects}`);
      console.log(`     Intersection type: ${row.intersection_type}`);
      console.log(`     Intersection: ${row.intersection_text}`);
      console.log(`     Lengths: ${(row.trail1_length/1000).toFixed(3)}km, ${(row.trail2_length/1000).toFixed(3)}km`);
    });
    
    // Test 2: ST_Crosses detection
    console.log('\n🔍 Test 2: ST_Crosses detection...');
    
    const crossesResult = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Crosses(t1.geometry, t2.geometry) as crosses,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_text
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE (t1.name ILIKE '%foothills north%' AND t2.name ILIKE '%north sky%')
         OR (t1.name ILIKE '%north sky%' AND t2.name ILIKE '%foothills north%')
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`\n📊 ST_Crosses results (${crossesResult.rows.length}):`);
    crossesResult.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     ST_Crosses: ${row.crosses}`);
      console.log(`     Intersection type: ${row.intersection_type}`);
      console.log(`     Intersection: ${row.intersection_text}`);
    });
    
    // Test 3: Endpoint proximity detection
    console.log('\n🔍 Test 3: Endpoint proximity detection...');
    
    const endpointProximity = await pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          geometry as trail_geom,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${stagingSchema}.trails
        WHERE name ILIKE '%foothills north%' OR name ILIKE '%north sky%'
      )
      SELECT 
        e1.trail_name as trail1_name,
        e2.trail_name as trail2_name,
        ST_Distance(e1.start_point::geography, e2.trail_geom::geography) as start_to_trail_distance,
        ST_Distance(e1.end_point::geography, e2.trail_geom::geography) as end_to_trail_distance,
        ST_Distance(e1.start_point::geography, e2.start_point::geography) as start_to_start_distance,
        ST_Distance(e1.end_point::geography, e2.end_point::geography) as end_to_end_distance
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
      ORDER BY e1.trail_name, e2.trail_name
    `);
    
    console.log(`\n📊 Endpoint proximity results (${endpointProximity.rows.length}):`);
    endpointProximity.rows.forEach(row => {
      console.log(`   ${row.trail1_name} ↔ ${row.trail2_name}:`);
      console.log(`     Start to trail: ${(row.start_to_trail_distance).toFixed(2)}m`);
      console.log(`     End to trail: ${(row.end_to_trail_distance).toFixed(2)}m`);
      console.log(`     Start to start: ${(row.start_to_start_distance).toFixed(2)}m`);
      console.log(`     End to end: ${(row.end_to_end_distance).toFixed(2)}m`);
    });
    
    // Test 4: Check if trails exist and their properties
    console.log('\n🔍 Test 4: Trail existence and properties...');
    
    const trailProperties = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geometry_type,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails
      WHERE name ILIKE '%foothills north%' OR name ILIKE '%north sky%'
      ORDER BY name
    `);
    
    console.log(`\n📊 Trail properties (${trailProperties.rows.length}):`);
    trailProperties.rows.forEach(row => {
      console.log(`   ${row.name}:`);
      console.log(`     UUID: ${row.app_uuid}`);
      console.log(`     Length: ${(row.length_meters/1000).toFixed(3)}km`);
      console.log(`     Points: ${row.num_points}`);
      console.log(`     Valid: ${row.is_valid}`);
      console.log(`     Type: ${row.geometry_type}`);
      console.log(`     Start: ${row.start_point}`);
      console.log(`     End: ${row.end_point}`);
    });
    
    // Test 5: Test the exact intersection detection logic from YIntersectionSplittingService
    console.log('\n🔍 Test 5: YIntersectionSplittingService logic...');
    
    const toleranceMeters = 10;
    const minTrailLengthMeters = 5;
    
    const yIntersectionTest = await pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          geometry as trail_geom,
          ST_StartPoint(geometry) as end_point,
          'start' as endpoint_type
        FROM ${stagingSchema}.trails
        WHERE ST_Length(geometry::geography) > $1
        
        UNION ALL
        
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          geometry as trail_geom,
          ST_EndPoint(geometry) as end_point,
          'end' as endpoint_type
        FROM ${stagingSchema}.trails
        WHERE ST_Length(geometry::geography) > $1
      ),
      y_intersections AS (
        SELECT DISTINCT
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e1.end_point as visiting_endpoint,
          e1.endpoint_type,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          e2.trail_geom as visited_trail_geom,
          ST_Distance(e1.end_point::geography, e2.trail_geom::geography) as distance_meters,
          ST_ClosestPoint(e2.trail_geom, e1.end_point) as split_point,
          ST_LineLocatePoint(e2.trail_geom, e1.end_point) as split_ratio,
          'y_intersection' as intersection_type
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) <= $2
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) > 1.0
      ),
      true_crossings AS (
        SELECT DISTINCT
          t1.app_uuid as visiting_trail_id,
          t1.name as visiting_trail_name,
          ST_Intersection(t1.geometry, t2.geometry) as visiting_endpoint,
          'crossing' as endpoint_type,
          t2.app_uuid as visited_trail_id,
          t2.name as visited_trail_name,
          t2.geometry as visited_trail_geom,
          0.0 as distance_meters,
          ST_Intersection(t1.geometry, t2.geometry) as split_point,
          0.5 as split_ratio,
          'true_crossing' as intersection_type
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Crosses(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      ),
      all_intersections AS (
        SELECT * FROM y_intersections
        UNION ALL
        SELECT * FROM true_crossings
      )
      SELECT * FROM all_intersections
      ORDER BY distance_meters, intersection_type
    `, [minTrailLengthMeters, toleranceMeters]);
    
    console.log(`\n📊 YIntersectionSplittingService results (${yIntersectionTest.rows.length}):`);
    yIntersectionTest.rows.forEach(row => {
      console.log(`   ${row.visiting_trail_name} → ${row.visited_trail_name}:`);
      console.log(`     Type: ${row.intersection_type}`);
      console.log(`     Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`     Endpoint type: ${row.endpoint_type}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugFoothillsNorthSkyIntersection();
