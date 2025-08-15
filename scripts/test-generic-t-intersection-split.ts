#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testGenericTIntersectionSplit() {
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
    const testSchema = 'test_generic_t_' + Date.now();
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

    // Insert test data with multiple trails to test generic T-intersection detection
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('57d38475-3e44-4d24-82ce-c8ac4d5fb717', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.281535 39.994968, -105.281456 39.995011, -105.281023 39.995156, -105.280708 39.995391, -105.280509 39.995473, -105.280275 39.995528, -105.279584 39.995565, -105.278753 39.995702, -105.278612 39.995676, -105.278518 39.995622, -105.278271 39.995352, -105.278141 39.995028, -105.27814 39.994929, -105.278187 39.99483)', 4326)),
      ('c575ee00-44da-48ca-b8b5-ddf9e8994f59', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.280213 39.987924, -105.28033 39.987927, -105.280452 39.987899, -105.280589 39.987885, -105.280674 39.987892, -105.280816 39.987867, -105.280881 39.987874, -105.281039 39.987855, -105.281202 39.987849, -105.281358 39.987886, -105.281479 39.987875, -105.281601 39.987875, -105.281648 39.987865, -105.281702 39.987836, -105.281752 39.987836, -105.281852 39.987836, -105.281952 39.987836, -105.282052 39.987836, -105.282152 39.987836, -105.282252 39.987836, -105.282313 39.98847, -105.282387 39.988581)', 4326)),
      ('test-trail-3', 'Another Trail', ST_GeomFromText('LINESTRING(-105.2800 39.9900, -105.2795 39.9905, -105.2790 39.9910)', 4326)),
      ('test-trail-4', 'Connector Trail', ST_GeomFromText('LINESTRING(-105.2795 39.9905, -105.2792 39.9908)', 4326))
    `);

    console.log('Test data created with multiple trails');

    // Generic T-intersection detection and splitting function
    console.log('\n=== Step 1: Generic T-intersection detection ===');
    const tIntersections = await client.query(`
      WITH
      -- Find all potential T-intersections (endpoints near other trails)
      t_intersection_candidates AS (
          SELECT 
              t1.app_uuid AS endpoint_trail_uuid,
              t1.name AS endpoint_trail_name,
              t2.app_uuid AS nearby_trail_uuid,
              t2.name AS nearby_trail_name,
              ST_EndPoint(t1.geometry) AS endpoint_point,
              ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) AS distance_meters,
              'end' AS endpoint_type
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, 3.0)
          
          UNION ALL
          
          SELECT 
              t1.app_uuid AS endpoint_trail_uuid,
              t1.name AS endpoint_trail_name,
              t2.app_uuid AS nearby_trail_uuid,
              t2.name AS nearby_trail_name,
              ST_StartPoint(t1.geometry) AS endpoint_point,
              ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_StartPoint(t1.geometry), t2.geometry) AS distance_meters,
              'start' AS endpoint_type
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE ST_DWithin(ST_StartPoint(t1.geometry), t2.geometry, 3.0)
      ),
      -- Filter to valid T-intersections (within tolerance)
      valid_t_intersections AS (
          SELECT *
          FROM t_intersection_candidates
          WHERE distance_meters <= 3.0
      )
      SELECT 
          endpoint_trail_uuid,
          endpoint_trail_name,
          nearby_trail_uuid,
          nearby_trail_name,
          ST_AsText(endpoint_point) AS endpoint_point_text,
          ST_AsText(snapped_point) AS snapped_point_text,
          distance_meters,
          endpoint_type,
          ST_LineLocatePoint(
              (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = nearby_trail_uuid),
              snapped_point
          ) AS location_ratio
      FROM valid_t_intersections
      ORDER BY distance_meters
    `);

    console.log('T-intersection candidates found:');
    if (tIntersections.rows.length === 0) {
      console.log('  No T-intersections found within 3-meter tolerance');
    } else {
      tIntersections.rows.forEach(row => {
        console.log(`  ${row.endpoint_trail_name} (${row.endpoint_type}) → ${row.nearby_trail_name}:`);
        console.log(`    Distance: ${row.distance_meters.toFixed(2)}m`);
        console.log(`    Endpoint: ${row.endpoint_point_text}`);
        console.log(`    Snapped to: ${row.snapped_point_text}`);
        console.log(`    Location ratio: ${row.location_ratio.toFixed(4)}`);
        console.log('');
      });
    }

    // Generic splitting function
    console.log('\n=== Step 2: Generic trail splitting ===');
    const splitResults = await client.query(`
      WITH
      -- Get all valid T-intersections
      t_intersections AS (
          SELECT 
              t1.app_uuid AS endpoint_trail_uuid,
              t1.name AS endpoint_trail_name,
              t2.app_uuid AS nearby_trail_uuid,
              t2.name AS nearby_trail_name,
              ST_EndPoint(t1.geometry) AS endpoint_point,
              ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) AS distance_meters
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, 3.0)
          
          UNION ALL
          
          SELECT 
              t1.app_uuid AS endpoint_trail_uuid,
              t1.name AS endpoint_trail_name,
              t2.app_uuid AS nearby_trail_uuid,
              t2.name AS nearby_trail_name,
              ST_StartPoint(t1.geometry) AS endpoint_point,
              ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_StartPoint(t1.geometry), t2.geometry) AS distance_meters
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE ST_DWithin(ST_StartPoint(t1.geometry), t2.geometry, 3.0)
      ),
      -- Split the nearby trails at the snapped points
      split_segments AS (
          SELECT
              ti.nearby_trail_uuid,
              ti.nearby_trail_name,
              ti.snapped_point,
              -- Split the trail and get all segments
              (ST_Dump(ST_Split(
                  (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.nearby_trail_uuid),
                  ti.snapped_point
              ))).geom AS split_geometry,
              (ST_Dump(ST_Split(
                  (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.nearby_trail_uuid),
                  ti.snapped_point
              ))).path[1] AS segment_order
          FROM t_intersections ti
      ),
      -- Create snapped versions of endpoint trails
      snapped_endpoint_trails AS (
          SELECT
              ti.endpoint_trail_uuid,
              ti.endpoint_trail_name,
              ti.snapped_point,
              ST_SetSRID(
                  ST_MakeLine(
                      ST_StartPoint((SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.endpoint_trail_uuid)),
                      ti.snapped_point
                  ),
                  4326
              ) AS snapped_geometry
          FROM t_intersections ti
      )
      -- Combine all results
      SELECT
          'split_segment' AS result_type,
          nearby_trail_uuid AS trail_uuid,
          nearby_trail_name AS trail_name,
          segment_order,
          ST_AsText(split_geometry) AS geometry_text,
          ST_Length(split_geometry::geography) AS length_meters,
          ST_NumPoints(split_geometry) AS num_points
      FROM split_segments
      WHERE ST_IsValid(split_geometry) 
        AND ST_NumPoints(split_geometry) >= 2
        AND ST_Length(split_geometry::geography) > 0
        
      UNION ALL
      
      SELECT
          'snapped_trail' AS result_type,
          endpoint_trail_uuid AS trail_uuid,
          endpoint_trail_name AS trail_name,
          1 AS segment_order,
          ST_AsText(snapped_geometry) AS geometry_text,
          ST_Length(snapped_geometry::geography) AS length_meters,
          ST_NumPoints(snapped_geometry) AS num_points
      FROM snapped_endpoint_trails
      WHERE ST_IsValid(snapped_geometry) 
        AND ST_NumPoints(snapped_geometry) >= 2
        AND ST_Length(snapped_geometry::geography) > 0
        
      ORDER BY result_type, trail_name, segment_order
    `);

    console.log('Split results:');
    if (splitResults.rows.length === 0) {
      console.log('  No valid splits generated');
    } else {
      splitResults.rows.forEach(row => {
        console.log(`  ${row.result_type} - ${row.trail_name} - Segment ${row.segment_order}:`);
        console.log(`    UUID: ${row.trail_uuid}`);
        console.log(`    Geometry: ${row.geometry_text}`);
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

testGenericTIntersectionSplit().catch(console.error);
