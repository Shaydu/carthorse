#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testProperSplitting() {
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
    const testSchema = 'test_proper_split_' + Date.now();
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

    // Insert test data with T-intersection
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('trail1', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.2824 39.9886, -105.2820 39.9888)', 4326)),
      ('trail2', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.2822 39.9884, -105.282387 39.988581)', 4326))
    `);

    console.log('Test data created');

    // Check original trails
    console.log('\n=== Step 1: Check original trails ===');
    const originalTrails = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(geometry) as geometry_text,
        ST_Length(geometry::geography) as length_meters
      FROM ${testSchema}.trails
      ORDER BY name
    `);

    console.log('Original trails:');
    originalTrails.rows.forEach(row => {
      console.log(`  ${row.name}:`);
      console.log(`    UUID: ${row.app_uuid}`);
      console.log(`    Geometry: ${row.geometry_text}`);
      console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
    });

    // Test proper splitting logic
    console.log('\n=== Step 2: Test proper splitting logic ===');
    const properSplit = await client.query(`
      WITH t_intersections AS (
        SELECT 
          t1.app_uuid as endpoint_trail_uuid,
          t2.app_uuid as nearby_trail_uuid,
          ST_EndPoint(t1.geometry) as endpoint_point,
          ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) as snapped_point,
          'end' as endpoint_type
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE t1.name = 'Enchanted-Kohler Spur Trail' 
          AND t2.name = 'Enchanted Mesa Trail'
          AND ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, 3.0)
      ),
      split_result AS (
        SELECT
          t.app_uuid,
          t.name,
          ti.snapped_point,
          -- First, add the intersection point to the trail
          ST_AddPoint(t.geometry, ti.snapped_point, 
              ST_LineLocatePoint(t.geometry, ti.snapped_point)::integer
          ) as geometry_with_point,
          -- Then split at the intersection point and get ALL segments
          ST_Split(
              ST_AddPoint(t.geometry, ti.snapped_point, 
                  ST_LineLocatePoint(t.geometry, ti.snapped_point)::integer
              ), 
              ti.snapped_point
          ) as split_geometry_collection
        FROM ${testSchema}.trails t
        JOIN t_intersections ti ON t.app_uuid = ti.nearby_trail_uuid
      ),
      dumped_segments AS (
        SELECT
          sr.app_uuid,
          sr.name,
          sr.snapped_point,
          (ST_Dump(sr.split_geometry_collection)).geom as segment_geometry,
          (ST_Dump(sr.split_geometry_collection)).path[1] as segment_order
        FROM split_result sr
      )
      SELECT 
        app_uuid,
        name,
        segment_order,
        ST_AsText(snapped_point) as snapped_point_text,
        ST_AsText(segment_geometry) as segment_geometry_text,
        ST_Length(segment_geometry::geography) as length_meters,
        ST_NumPoints(segment_geometry) as num_points
      FROM dumped_segments
      WHERE ST_IsValid(segment_geometry) 
        AND ST_NumPoints(segment_geometry) >= 2
        AND ST_Length(segment_geometry::geography) > 0
      ORDER BY name, segment_order
    `);

    console.log('Proper split results:');
    if (properSplit.rows.length === 0) {
      console.log('  No proper splits found');
    } else {
      properSplit.rows.forEach(row => {
        console.log(`  ${row.name} - Segment ${row.segment_order}:`);
        console.log(`    UUID: ${row.app_uuid}`);
        console.log(`    Snapped point: ${row.snapped_point_text}`);
        console.log(`    Geometry: ${row.segment_geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
        console.log(`    Points: ${row.num_points}`);
        console.log('');
      });
    }

    // Test what ST_Split actually returns
    console.log('\n=== Step 3: Debug ST_Split output ===');
    const debugSplit = await client.query(`
      WITH intersection_point AS (
        SELECT ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry)) as point
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
          ST_AsText(ip.point) as intersection_point,
          ST_AsText(ST_AddPoint(t.geometry, ip.point, 
              ST_LineLocatePoint(t.geometry, ip.point)::integer
          )) as geometry_with_point,
          ST_AsText(ST_Split(
              ST_AddPoint(t.geometry, ip.point, 
                  ST_LineLocatePoint(t.geometry, ip.point)::integer
              ), 
              ip.point
          )) as split_result,
          ST_NumGeometries(ST_Split(
              ST_AddPoint(t.geometry, ip.point, 
                  ST_LineLocatePoint(t.geometry, ip.point)::integer
              ), 
              ip.point
          )) as num_geometries
        FROM ${testSchema}.trails t
        CROSS JOIN intersection_point ip
        WHERE t.name = 'Enchanted Mesa Trail'
      )
      SELECT * FROM split_debug
    `);

    console.log('ST_Split debug:');
    debugSplit.rows.forEach(row => {
      console.log(`  Trail: ${row.name}`);
      console.log(`    Original: ${row.original_geometry}`);
      console.log(`    Intersection point: ${row.intersection_point}`);
      console.log(`    With point: ${row.geometry_with_point}`);
      console.log(`    Split result: ${row.split_result}`);
      console.log(`    Number of geometries: ${row.num_geometries}`);
      console.log('');
    });

    // Test the complete logic that should create multiple segments
    console.log('\n=== Step 4: Test complete multi-segment logic ===');
    const multiSegmentSplit = await client.query(`
      WITH t_intersections AS (
        SELECT 
          t1.app_uuid as endpoint_trail_uuid,
          t2.app_uuid as nearby_trail_uuid,
          ST_EndPoint(t1.geometry) as endpoint_point,
          ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) as snapped_point,
          'end' as endpoint_type
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, 3.0)
      ),
      trails_with_snapped_geometries AS (
        SELECT 
          t.id, t.app_uuid, t.name, t.geometry
        FROM ${testSchema}.trails t
      ),
      t_intersection_splits AS (
        SELECT
          tsg.app_uuid,
          tsg.name,
          ti.snapped_point,
          -- Add point and split, then dump all segments
          (ST_Dump(ST_Split(
              ST_AddPoint(tsg.geometry, ti.snapped_point, 
                  ST_LineLocatePoint(tsg.geometry, ti.snapped_point)::integer
              ), 
              ti.snapped_point
          ))).geom as split_geometry,
          (ST_Dump(ST_Split(
              ST_AddPoint(tsg.geometry, ti.snapped_point, 
                  ST_LineLocatePoint(tsg.geometry, ti.snapped_point)::integer
              ), 
              ti.snapped_point
          ))).path[1] as segment_order
        FROM trails_with_snapped_geometries tsg
        JOIN t_intersections ti ON tsg.app_uuid = ti.nearby_trail_uuid
      )
      SELECT 
        app_uuid,
        name,
        segment_order,
        ST_AsText(snapped_point) as snapped_point_text,
        ST_AsText(split_geometry) as split_geometry_text,
        ST_Length(split_geometry::geography) as length_meters,
        ST_NumPoints(split_geometry) as num_points
      FROM t_intersection_splits
      WHERE ST_IsValid(split_geometry) 
        AND ST_NumPoints(split_geometry) >= 2
        AND ST_Length(split_geometry::geography) > 0
      ORDER BY name, segment_order
    `);

    console.log('Multi-segment split results:');
    if (multiSegmentSplit.rows.length === 0) {
      console.log('  No multi-segment splits found');
    } else {
      multiSegmentSplit.rows.forEach(row => {
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

testProperSplitting().catch(console.error);
