#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testLargeGap() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'tester'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create a test schema and table
    const testSchema = 'test_large_gap_' + Date.now();
    console.log(`Creating test schema: ${testSchema}`);
    
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        geometry GEOMETRY(LINESTRING, 4326)
      )
    `);

    // Insert test data with a LARGE gap (approximately 1.89 meters)
    // Create a gap by moving the endpoint further away
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('trail1', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.2824 39.9886, -105.2820 39.9888)', 4326)),
      ('trail2', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.2822 39.9884, -105.282387 39.988581)', 4326))
    `);

    console.log('Test data created with large gap');

    // Debug step 1: Check the trail data and calculate actual distances
    console.log('\n=== Step 1: Check trail data and distances ===');
    const trailData = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(geometry) as geometry_text,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${testSchema}.trails
      ORDER BY name
    `);

    trailData.rows.forEach(row => {
      console.log(`  ${row.name}:`);
      console.log(`    UUID: ${row.app_uuid}`);
      console.log(`    Geometry: ${row.geometry_text}`);
      console.log(`    Start: ${row.start_point}`);
      console.log(`    End: ${row.end_point}`);
      console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
    });

    // Debug step 2: Calculate exact distances between endpoints and trails
    console.log('\n=== Step 2: Calculate exact distances ===');
    const distanceCheck = await client.query(`
      WITH trail_data AS (
        SELECT 
          app_uuid,
          name,
          geometry,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${testSchema}.trails
      )
      SELECT 
        t1.name as endpoint_trail_name,
        t2.name as nearby_trail_name,
        'start' as endpoint_type,
        ST_AsText(t1.start_point) as endpoint_point,
        ST_AsText(ST_ClosestPoint(t2.geometry, t1.start_point)) as snapped_point,
        ST_Distance(t1.start_point, t2.geometry) as distance_meters,
        ST_DWithin(t1.start_point, t2.geometry, 3.0) as within_3m,
        ST_DWithin(t1.start_point, t2.geometry, 2.0) as within_2m,
        ST_DWithin(t1.start_point, t2.geometry, 1.0) as within_1m
      FROM trail_data t1
      CROSS JOIN trail_data t2
      WHERE t1.app_uuid != t2.app_uuid
      
      UNION ALL
      
      SELECT 
        t1.name as endpoint_trail_name,
        t2.name as nearby_trail_name,
        'end' as endpoint_type,
        ST_AsText(t1.end_point) as endpoint_point,
        ST_AsText(ST_ClosestPoint(t2.geometry, t1.end_point)) as snapped_point,
        ST_Distance(t1.end_point, t2.geometry) as distance_meters,
        ST_DWithin(t1.end_point, t2.geometry, 3.0) as within_3m,
        ST_DWithin(t1.end_point, t2.geometry, 2.0) as within_2m,
        ST_DWithin(t1.end_point, t2.geometry, 1.0) as within_1m
      FROM trail_data t1
      CROSS JOIN trail_data t2
      WHERE t1.app_uuid != t2.app_uuid
      
      ORDER BY distance_meters
    `);

    console.log('Distance calculations:');
    distanceCheck.rows.forEach(row => {
      console.log(`  ${row.endpoint_trail_name} (${row.endpoint_type}) -> ${row.nearby_trail_name}:`);
      console.log(`    Distance: ${row.distance_meters.toFixed(4)}m`);
      console.log(`    Within 1m: ${row.within_1m}`);
      console.log(`    Within 2m: ${row.within_2m}`);
      console.log(`    Within 3m: ${row.within_3m}`);
      console.log(`    Endpoint: ${row.endpoint_point}`);
      console.log(`    Snapped: ${row.snapped_point}`);
      console.log('');
    });

    // Debug step 3: Test the function with different tolerances
    console.log('\n=== Step 3: Test function with different tolerances ===');
    
    for (const tolerance of [1.0, 1.5, 1.89, 2.0, 3.0, 5.0]) {
      console.log(`\n--- Testing with ${tolerance}m tolerance ---`);
      const result = await client.query(`
        SELECT 
          ST_AsText(intersection_point) as point_text,
          connected_trail_names,
          node_type,
          distance_meters
        FROM detect_trail_intersections($1, 'trails', $2)
        ORDER BY distance_meters
      `, [testSchema, tolerance]);

      if (result.rows.length === 0) {
        console.log(`  No intersections detected with ${tolerance}m tolerance`);
      } else {
        result.rows.forEach((row, index) => {
          console.log(`  ${index + 1}. Point: ${row.point_text}`);
          console.log(`     Trails: ${row.connected_trail_names.join(' <-> ')}`);
          console.log(`     Type: ${row.node_type}`);
          console.log(`     Distance: ${row.distance_meters.toFixed(4)}m`);
        });
      }
    }

    // Clean up
    await client.query(`DROP SCHEMA ${testSchema} CASCADE`);
    console.log(`\nCleaned up test schema: ${testSchema}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testLargeGap().catch(console.error);
