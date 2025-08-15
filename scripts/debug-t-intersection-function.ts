#!/usr/bin/env ts-node

import { Client } from 'pg';

async function debugTIntersectionFunction() {
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
    const testSchema = 'debug_t_intersection_' + Date.now();
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

    // Insert test data - two trails that should form a T-intersection
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('trail1', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.2824 39.9886, -105.2820 39.9888)', 4326)),
      ('trail2', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.2822 39.9884, -105.2823931909462 39.98859709804337)', 4326))
    `);

    console.log('Test data created');

    // Debug step 1: Check the trail data
    console.log('\n=== Step 1: Check trail data ===');
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

    // Debug step 2: Check for T-intersections manually
    console.log('\n=== Step 2: Manual T-intersection check ===');
    const manualCheck = await client.query(`
      WITH trail_data AS (
        SELECT 
          app_uuid,
          name,
          geometry,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${testSchema}.trails
      ),
      t_intersections AS (
        SELECT 
          t1.name as endpoint_trail_name,
          t2.name as nearby_trail_name,
          'start' as endpoint_type,
          ST_StartPoint(t1.geometry) as endpoint_point,
          ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)) as snapped_point,
          ST_Distance(ST_StartPoint(t1.geometry), t2.geometry) as distance_meters
        FROM trail_data t1
        CROSS JOIN trail_data t2
        WHERE t1.app_uuid != t2.app_uuid
          AND ST_DWithin(ST_StartPoint(t1.geometry), t2.geometry, 3.0)
        
        UNION ALL
        
        SELECT 
          t1.name as endpoint_trail_name,
          t2.name as nearby_trail_name,
          'end' as endpoint_type,
          ST_EndPoint(t1.geometry) as endpoint_point,
          ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) as snapped_point,
          ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) as distance_meters
        FROM trail_data t1
        CROSS JOIN trail_data t2
        WHERE t1.app_uuid != t2.app_uuid
          AND ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, 3.0)
      )
      SELECT 
        endpoint_trail_name,
        nearby_trail_name,
        endpoint_type,
        ST_AsText(endpoint_point) as endpoint_point_text,
        ST_AsText(snapped_point) as snapped_point_text,
        distance_meters
      FROM t_intersections
      ORDER BY distance_meters
    `);

    console.log('Manual T-intersection check:');
    if (manualCheck.rows.length === 0) {
      console.log('  No T-intersections found manually');
    } else {
      manualCheck.rows.forEach(row => {
        console.log(`  ${row.endpoint_trail_name} (${row.endpoint_type}) -> ${row.nearby_trail_name}:`);
        console.log(`    Distance: ${row.distance_meters.toFixed(2)}m`);
        console.log(`    Endpoint: ${row.endpoint_point_text}`);
        console.log(`    Snapped: ${row.snapped_point_text}`);
      });
    }

    // Debug step 3: Test the function directly
    console.log('\n=== Step 3: Test detect_trail_intersections function ===');
    const functionResult = await client.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM detect_trail_intersections($1, 'trails', 3.0)
      ORDER BY distance_meters
    `, [testSchema]);

    console.log('Function result:');
    if (functionResult.rows.length === 0) {
      console.log('  No intersections detected by function');
    } else {
      functionResult.rows.forEach(row => {
        console.log(`  Point: ${row.point_text}`);
        console.log(`  Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`  Type: ${row.node_type}`);
        console.log(`  Distance: ${row.distance_meters.toFixed(2)}m`);
      });
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

debugTIntersectionFunction().catch(console.error);
