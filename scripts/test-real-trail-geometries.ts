#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testRealTrailGeometries() {
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
    const testSchema = 'test_real_geometries_' + Date.now();
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

    // Insert test data with the actual trail geometries from the GeoJSON file
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('57d38475-3e44-4d24-82ce-c8ac4d5fb717', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.281535 39.994968, -105.281456 39.995011, -105.281023 39.995156, -105.280708 39.995391, -105.280509 39.995473, -105.280275 39.995528, -105.279584 39.995565, -105.278753 39.995702, -105.278612 39.995676, -105.278518 39.995622, -105.278271 39.995352, -105.278141 39.995028, -105.27814 39.994929, -105.278187 39.99483)', 4326)),
      ('c575ee00-44da-48ca-b8b5-ddf9e8994f59', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.280213 39.987924, -105.28033 39.987927, -105.280452 39.987899, -105.280589 39.987885, -105.280674 39.987892, -105.280816 39.987867, -105.280881 39.987874, -105.281039 39.987855, -105.281202 39.987849, -105.281358 39.987886, -105.281479 39.987875, -105.281601 39.987875, -105.281648 39.987865, -105.281702 39.987836, -105.281752 39.987836, -105.281852 39.987836, -105.281952 39.987836, -105.282052 39.987836, -105.282152 39.987836, -105.282252 39.987836, -105.282313 39.98847, -105.282387 39.988581)', 4326))
    `);

    console.log('Test data created with actual trail geometries');

    // Check original trails
    console.log('\n=== Step 1: Check original trails ===');
    const originalTrails = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(geometry) as geometry_text,
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points
      FROM ${testSchema}.trails
      ORDER BY name
    `);

    console.log('Original trails:');
    originalTrails.rows.forEach(row => {
      console.log(`  ${row.name}:`);
      console.log(`    UUID: ${row.app_uuid}`);
      console.log(`    Geometry: ${row.geometry_text}`);
      console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
      console.log(`    Points: ${row.num_points}`);
    });

    // Test the snap and split logic
    console.log('\n=== Step 2: Test snap and split logic ===');
    const snapAndSplit = await client.query(`
      WITH spur_endpoint AS (
        SELECT 
          t2.app_uuid as spur_trail_uuid,
          t1.app_uuid as main_trail_uuid,
          ST_EndPoint(t2.geometry) as spur_endpoint,
          ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry)) as snapped_point,
          ST_Distance(ST_EndPoint(t2.geometry), t1.geometry) as distance_meters
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE t1.name = 'Enchanted Mesa Trail' AND t2.name = 'Enchanted-Kohler Spur Trail'
        LIMIT 1
      ),
      split_debug AS (
        SELECT 
          t.app_uuid,
          t.name,
          ST_AsText(t.geometry) as original_geometry,
          ST_AsText(se.spur_endpoint) as spur_endpoint,
          ST_AsText(se.snapped_point) as snapped_point,
          se.distance_meters,
          ST_LineLocatePoint(t.geometry, se.snapped_point) as location_ratio,
          ST_AsText(ST_AddPoint(t.geometry, se.snapped_point, 
              ST_LineLocatePoint(t.geometry, se.snapped_point)::integer
          )) as geometry_with_point,
          ST_AsText(ST_Split(
              ST_AddPoint(t.geometry, se.snapped_point, 
                  ST_LineLocatePoint(t.geometry, se.snapped_point)::integer
              ), 
              se.snapped_point
          )) as split_result,
          ST_NumGeometries(ST_Split(
              ST_AddPoint(t.geometry, se.snapped_point, 
                  ST_LineLocatePoint(t.geometry, se.snapped_point)::integer
              ), 
              se.snapped_point
          )) as num_geometries
        FROM ${testSchema}.trails t
        CROSS JOIN spur_endpoint se
        WHERE t.name = 'Enchanted Mesa Trail'
      )
      SELECT * FROM split_debug
    `);

    console.log('Snap and split debug:');
    snapAndSplit.rows.forEach(row => {
      console.log(`  Trail: ${row.name}`);
      console.log(`    Original: ${row.original_geometry}`);
      console.log(`    Spur endpoint: ${row.spur_endpoint}`);
      console.log(`    Snapped point: ${row.snapped_point}`);
      console.log(`    Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`    Location ratio: ${row.location_ratio.toFixed(4)}`);
      console.log(`    With point: ${row.geometry_with_point}`);
      console.log(`    Split result: ${row.split_result}`);
      console.log(`    Number of geometries: ${row.num_geometries}`);
      console.log('');
    });

    // Test the complete splitting with ST_Dump to see individual segments
    console.log('\n=== Step 3: Test complete splitting with ST_Dump ===');
    const completeSplit = await client.query(`
      WITH spur_endpoint AS (
        SELECT 
          t2.app_uuid as spur_trail_uuid,
          t1.app_uuid as main_trail_uuid,
          ST_EndPoint(t2.geometry) as spur_endpoint,
          ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry)) as snapped_point
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE t1.name = 'Enchanted Mesa Trail' AND t2.name = 'Enchanted-Kohler Spur Trail'
        LIMIT 1
      ),
      split_segments AS (
        SELECT
          t.app_uuid,
          t.name,
          se.snapped_point,
          -- Add point and split, then dump all segments
          (ST_Dump(ST_Split(
              ST_AddPoint(t.geometry, se.snapped_point, 
                  ST_LineLocatePoint(t.geometry, se.snapped_point)::integer
              ), 
              se.snapped_point
          ))).geom as split_geometry,
          (ST_Dump(ST_Split(
              ST_AddPoint(t.geometry, se.snapped_point, 
                  ST_LineLocatePoint(t.geometry, se.snapped_point)::integer
              ), 
              se.snapped_point
          ))).path[1] as segment_order
        FROM ${testSchema}.trails t
        CROSS JOIN spur_endpoint se
        WHERE t.name = 'Enchanted Mesa Trail'
      )
      SELECT 
        app_uuid,
        name,
        segment_order,
        ST_AsText(snapped_point) as snapped_point_text,
        ST_AsText(split_geometry) as split_geometry_text,
        ST_Length(split_geometry::geography) as length_meters,
        ST_NumPoints(split_geometry) as num_points
      FROM split_segments
      WHERE ST_IsValid(split_geometry) 
        AND ST_NumPoints(split_geometry) >= 2
        AND ST_Length(split_geometry::geography) > 0
      ORDER BY segment_order
    `);

    console.log('Complete split results:');
    if (completeSplit.rows.length === 0) {
      console.log('  No complete splits found');
    } else {
      completeSplit.rows.forEach(row => {
        console.log(`  ${row.name} - Segment ${row.segment_order}:`);
        console.log(`    UUID: ${row.app_uuid}`);
        console.log(`    Snapped point: ${row.snapped_point_text}`);
        console.log(`    Geometry: ${row.split_geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
        console.log(`    Points: ${row.num_points}`);
        console.log('');
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

testRealTrailGeometries().catch(console.error);
