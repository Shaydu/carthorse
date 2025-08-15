#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testTIntersectionSplitting() {
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
    const testSchema = 'test_t_splitting_' + Date.now();
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

    // Test T-intersection splitting logic manually
    console.log('\n=== Step 2: Test T-intersection splitting logic ===');
    const tIntersectionSplit = await client.query(`
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
          -- Add the intersection point to the trail first
          ST_AddPoint(t.geometry, ti.snapped_point, 
              ST_LineLocatePoint(t.geometry, ti.snapped_point)::integer
          ) as geometry_with_point,
          -- Then split at the intersection point
          (ST_Dump(ST_Split(
              ST_AddPoint(t.geometry, ti.snapped_point, 
                  ST_LineLocatePoint(t.geometry, ti.snapped_point)::integer
              ), 
              ti.snapped_point
          ))).geom as split_geometry,
          (ST_Dump(ST_Split(
              ST_AddPoint(t.geometry, ti.snapped_point, 
                  ST_LineLocatePoint(t.geometry, ti.snapped_point)::integer
              ), 
              ti.snapped_point
          ))).path[1] as segment_order
        FROM ${testSchema}.trails t
        JOIN t_intersections ti ON t.app_uuid = ti.nearby_trail_uuid
      )
      SELECT 
        app_uuid,
        name,
        segment_order,
        ST_AsText(snapped_point) as snapped_point_text,
        ST_AsText(geometry_with_point) as geometry_with_point_text,
        ST_AsText(split_geometry) as split_geometry_text,
        ST_Length(split_geometry::geography) as length_meters
      FROM split_result
      ORDER BY segment_order
    `);

    console.log('T-intersection split results:');
    if (tIntersectionSplit.rows.length === 0) {
      console.log('  No T-intersection splits found');
    } else {
      tIntersectionSplit.rows.forEach(row => {
        console.log(`  Segment ${row.segment_order}:`);
        console.log(`    Trail: ${row.name}`);
        console.log(`    UUID: ${row.app_uuid}`);
        console.log(`    Snapped point: ${row.snapped_point_text}`);
        console.log(`    Geometry with point: ${row.geometry_with_point_text}`);
        console.log(`    Split geometry: ${row.split_geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
        console.log('');
      });
    }

    // Test the complete splitting logic from the function
    console.log('\n=== Step 3: Test complete splitting logic ===');
    const completeSplit = await client.query(`
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
      snapped_trails AS (
        SELECT 
          ti.endpoint_trail_uuid,
          ti.nearby_trail_uuid,
          ti.snapped_point,
          ti.endpoint_type,
          -- Snap the endpoint trail to the intersection point
          CASE 
            WHEN ti.endpoint_type = 'start' THEN
              ST_SetPoint(t.geometry, 0, ti.snapped_point)
            ELSE
              ST_SetPoint(t.geometry, ST_NPoints(t.geometry) - 1, ti.snapped_point)
          END as snapped_endpoint_trail_geom
        FROM t_intersections ti
        JOIN ${testSchema}.trails t ON t.app_uuid = ti.endpoint_trail_uuid
      ),
      trails_with_snapped_geometries AS (
        SELECT 
          t.id, t.app_uuid, t.name, t.geometry,
          COALESCE(st.snapped_endpoint_trail_geom, t.geometry) as snapped_geometry
        FROM ${testSchema}.trails t
        LEFT JOIN snapped_trails st ON t.app_uuid = st.endpoint_trail_uuid
      ),
      t_intersection_splits AS (
        SELECT
          tsg.app_uuid,
          tsg.name,
          ti.snapped_point,
          (ST_Dump(ST_Split(
              ST_AddPoint(tsg.snapped_geometry, ti.snapped_point, 
                  ST_LineLocatePoint(tsg.snapped_geometry, ti.snapped_point)::integer
              ), 
              ti.snapped_point
          ))).geom as split_geometry,
          (ST_Dump(ST_Split(
              ST_AddPoint(tsg.snapped_geometry, ti.snapped_point, 
                  ST_LineLocatePoint(tsg.snapped_geometry, ti.snapped_point)::integer
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
        ST_Length(split_geometry::geography) as length_meters
      FROM t_intersection_splits
      ORDER BY name, segment_order
    `);

    console.log('Complete split results:');
    if (completeSplit.rows.length === 0) {
      console.log('  No complete splits found');
    } else {
      completeSplit.rows.forEach(row => {
        console.log(`  ${row.name} - Segment ${row.segment_order}:`);
        console.log(`    UUID: ${row.app_uuid}`);
        console.log(`    Snapped point: ${row.snapped_point_text}`);
        console.log(`    Split geometry: ${row.split_geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
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

testTIntersectionSplitting().catch(console.error);
