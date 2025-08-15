#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testUtmSnapSplit() {
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
    const testSchema = 'test_utm_snap_' + Date.now();
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

    // Insert test data with the actual trail geometries
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) VALUES
      ('57d38475-3e44-4d24-82ce-c8ac4d5fb717', 'Enchanted Mesa Trail', ST_GeomFromText('LINESTRING(-105.281535 39.994968, -105.281456 39.995011, -105.281023 39.995156, -105.280708 39.995391, -105.280509 39.995473, -105.280275 39.995528, -105.279584 39.995565, -105.278753 39.995702, -105.278612 39.995676, -105.278518 39.995622, -105.278271 39.995352, -105.278141 39.995028, -105.27814 39.994929, -105.278187 39.99483)', 4326)),
      ('c575ee00-44da-48ca-b8b5-ddf9e8994f59', 'Enchanted-Kohler Spur Trail', ST_GeomFromText('LINESTRING(-105.280213 39.987924, -105.28033 39.987927, -105.280452 39.987899, -105.280589 39.987885, -105.280674 39.987892, -105.280816 39.987867, -105.280881 39.987874, -105.281039 39.987855, -105.281202 39.987849, -105.281358 39.987886, -105.281479 39.987875, -105.281601 39.987875, -105.281648 39.987865, -105.281702 39.987836, -105.281752 39.987836, -105.281852 39.987836, -105.281952 39.987836, -105.282052 39.987836, -105.282152 39.987836, -105.282252 39.987836, -105.282313 39.98847, -105.282387 39.988581)', 4326))
    `);

    console.log('Test data created with actual trail geometries');

    // Test the UTM-based snap and split approach
    console.log('\n=== Step 1: Test UTM-based snap and split ===');
    const utmSnapSplit = await client.query(`
      WITH
      mesa AS (
          SELECT 
              app_uuid,
              name,
              geometry AS geom
          FROM ${testSchema}.trails 
          WHERE name = 'Enchanted Mesa Trail'
      ),
      spur AS (
          SELECT 
              app_uuid,
              name,
              geometry AS geom
          FROM ${testSchema}.trails 
          WHERE name = 'Enchanted-Kohler Spur Trail'
      ),
      -- Step 2: Get the endpoint of the spur
      spur_end AS (
          SELECT ST_Transform(ST_EndPoint(geom), 26913) AS geom_utm
          FROM spur
      ),
      -- Step 3: Find the nearest point on Enchanted Mesa to the spur endpoint
      nearest_snap AS (
          SELECT
              ST_ClosestPoint(
                  ST_Transform(mesa.geom, 26913),
                  spur_end.geom_utm
              ) AS snap_pt_utm
          FROM mesa, spur_end
      ),
      -- Step 4: Ensure it's within 3 meters
      valid_snap AS (
          SELECT snap_pt_utm
          FROM nearest_snap, spur_end
          WHERE ST_Distance(snap_pt_utm, spur_end.geom_utm) <= 3
      ),
      -- Step 5: Transform snap point back to WGS84
      snap_wgs AS (
          SELECT ST_Transform(snap_pt_utm, 4326) AS geom
          FROM valid_snap
      ),
      -- Step 6: Split Enchanted Mesa at snap point
      split_mesa AS (
          SELECT (ST_Dump(ST_Split(mesa.geom, snap_wgs.geom))).geom AS geom,
                 (ST_Dump(ST_Split(mesa.geom, snap_wgs.geom))).path[1] AS segment_order
          FROM mesa, snap_wgs
      )
      -- Final output: snapped spur and split mesa
      SELECT
          'mesa_segment' AS feature,
          segment_order,
          ST_AsText(geom) AS geometry_text,
          ST_Length(geom::geography) AS length_meters,
          ST_NumPoints(geom) AS num_points
      FROM split_mesa
      WHERE ST_IsValid(geom) 
        AND ST_NumPoints(geom) >= 2
        AND ST_Length(geom::geography) > 0
      UNION ALL
      SELECT
          'spur_snapped' AS feature,
          1 AS segment_order,
          ST_AsText(ST_SetSRID(
              ST_MakeLine(
                  ST_StartPoint(spur.geom),
                  snap_wgs.geom
              ),
              4326
          )) AS geometry_text,
          ST_Length(ST_SetSRID(
              ST_MakeLine(
                  ST_StartPoint(spur.geom),
                  snap_wgs.geom
              ),
              4326
          )::geography) AS length_meters,
          ST_NumPoints(ST_SetSRID(
              ST_MakeLine(
                  ST_StartPoint(spur.geom),
                  snap_wgs.geom
              ),
              4326
          )) AS num_points
      FROM spur, snap_wgs
      ORDER BY feature, segment_order
    `);

    console.log('UTM-based snap and split results:');
    if (utmSnapSplit.rows.length === 0) {
      console.log('  No results found - spur endpoint may be too far from main trail');
    } else {
      utmSnapSplit.rows.forEach(row => {
        console.log(`  ${row.feature} - Segment ${row.segment_order}:`);
        console.log(`    Geometry: ${row.geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
        console.log(`    Points: ${row.num_points}`);
        console.log('');
      });
    }

    // Debug: Check distances and snap points
    console.log('\n=== Step 2: Debug distances and snap points ===');
    const debugInfo = await client.query(`
      WITH
      mesa AS (
          SELECT geometry AS geom FROM ${testSchema}.trails WHERE name = 'Enchanted Mesa Trail'
      ),
      spur AS (
          SELECT geometry AS geom FROM ${testSchema}.trails WHERE name = 'Enchanted-Kohler Spur Trail'
      ),
      spur_end AS (
          SELECT ST_EndPoint(geom) AS geom FROM spur
      ),
      nearest_snap AS (
          SELECT
              ST_ClosestPoint(mesa.geom, spur_end.geom) AS snap_pt,
              ST_Distance(mesa.geom, spur_end.geom) AS distance_meters
          FROM mesa, spur_end
      )
      SELECT 
          ST_AsText(spur_end.geom) AS spur_endpoint,
          ST_AsText(snap_pt) AS snapped_point,
          distance_meters,
          ST_LineLocatePoint(mesa.geom, snap_pt) AS location_ratio
      FROM nearest_snap, spur_end, mesa
    `);

    console.log('Debug information:');
    debugInfo.rows.forEach(row => {
      console.log(`  Spur endpoint: ${row.spur_endpoint}`);
      console.log(`  Snapped point: ${row.snapped_point}`);
      console.log(`  Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`  Location ratio: ${row.location_ratio.toFixed(4)}`);
      console.log('');
    });

    // Clean up
    await client.query(`DROP SCHEMA ${testSchema} CASCADE`);
    console.log(`\nCleaned up test schema: ${testSchema}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testUtmSnapSplit().catch(console.error);
