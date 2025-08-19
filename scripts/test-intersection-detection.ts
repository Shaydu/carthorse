#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function testIntersectionDetection() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🔍 Testing intersection detection for Bear Canyon and Fern Canyon...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'trails' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with trails found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Test basic intersection detection
    console.log('\n🔍 Testing basic intersection detection...');
    
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
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%bear canyon%' AND t2.name ILIKE '%fern canyon%')
         OR (t1.name ILIKE '%fern canyon%' AND t2.name ILIKE '%bear canyon%')
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`\n📊 Basic intersection results (${basicIntersection.rows.length}):`);
    basicIntersection.rows.forEach(row => {
      console.log(`  ${row.trail1_name} ∩ ${row.trail2_name}:`);
      console.log(`    Intersects: ${row.intersects}`);
      console.log(`    Type: ${row.intersection_type}`);
      console.log(`    Text: ${row.intersection_text}`);
      console.log(`    Lengths: ${(row.trail1_length/1000).toFixed(2)}km, ${(row.trail2_length/1000).toFixed(2)}km`);
    });
    
    // Test with ST_Force2D (as used in the splitting logic)
    console.log('\n🔍 Testing intersection detection with ST_Force2D...');
    
    const force2dIntersection = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersects_2d,
        ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as intersection_type_2d,
        ST_AsText(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as intersection_text_2d
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%bear canyon%' AND t2.name ILIKE '%fern canyon%')
         OR (t1.name ILIKE '%fern canyon%' AND t2.name ILIKE '%bear canyon%')
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`\n📊 ST_Force2D intersection results (${force2dIntersection.rows.length}):`);
    force2dIntersection.rows.forEach(row => {
      console.log(`  ${row.trail1_name} ∩ ${row.trail2_name}:`);
      console.log(`    Intersects (2D): ${row.intersects_2d}`);
      console.log(`    Type (2D): ${row.intersection_type_2d}`);
      console.log(`    Text (2D): ${row.intersection_text_2d}`);
    });
    
    // Test with tolerance-based intersection detection
    console.log('\n🔍 Testing tolerance-based intersection detection...');
    
    const toleranceIntersection = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_DWithin(t1.geometry::geography, t2.geometry::geography, 5) as within_5m,
        ST_DWithin(t1.geometry::geography, t2.geometry::geography, 10) as within_10m,
        ST_DWithin(t1.geometry::geography, t2.geometry::geography, 20) as within_20m,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%bear canyon%' AND t2.name ILIKE '%fern canyon%')
         OR (t1.name ILIKE '%fern canyon%' AND t2.name ILIKE '%bear canyon%')
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`\n📊 Tolerance-based intersection results (${toleranceIntersection.rows.length}):`);
    toleranceIntersection.rows.forEach(row => {
      console.log(`  ${row.trail1_name} ∩ ${row.trail2_name}:`);
      console.log(`    Within 5m: ${row.within_5m}`);
      console.log(`    Within 10m: ${row.within_10m}`);
      console.log(`    Within 20m: ${row.within_20m}`);
      console.log(`    Distance: ${row.distance_meters.toFixed(2)}m`);
    });
    
    // Test the actual intersection detection logic used in the splitting process
    console.log('\n🔍 Testing actual splitting intersection logic...');
    
    const splittingLogic = await pgClient.query(`
      SELECT DISTINCT
        t1.app_uuid as trail1_uuid,
        t2.app_uuid as trail2_uuid,
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_point,
        ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as intersection_type
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 5
        AND ST_Length(t2.geometry::geography) > 5
        AND ((t1.name ILIKE '%bear canyon%' AND t2.name ILIKE '%fern canyon%')
             OR (t1.name ILIKE '%fern canyon%' AND t2.name ILIKE '%bear canyon%'))
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`\n📊 Splitting logic results (${splittingLogic.rows.length}):`);
    splittingLogic.rows.forEach(row => {
      console.log(`  ${row.trail1_name} ∩ ${row.trail2_name}:`);
      console.log(`    Type: ${row.intersection_type}`);
      console.log(`    Point: ${row.intersection_point ? ST_AsText(row.intersection_point) : 'NULL'}`);
    });
    
    // Check if there are any intersection points in the intersection_points table
    console.log('\n🔍 Checking intersection_points table...');
    
    const intersectionPoints = await pgClient.query(`
      SELECT 
        connected_trail_names,
        ST_AsText(point) as point_text,
        node_type,
        distance_meters
      FROM ${stagingSchema}.intersection_points
      WHERE 'Bear Canyon' = ANY(connected_trail_names) 
         OR 'Fern Canyon' = ANY(connected_trail_names)
      ORDER BY connected_trail_names
    `);
    
    console.log(`\n📊 Intersection points table (${intersectionPoints.rows.length}):`);
    intersectionPoints.rows.forEach(row => {
      console.log(`  ${row.connected_trail_names.join(' ∩ ')}: ${row.point_text} (${row.node_type}, ${row.distance_meters}m)`);
    });
    
  } catch (error) {
    console.error('❌ Error during intersection detection test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testIntersectionDetection().catch(console.error);
