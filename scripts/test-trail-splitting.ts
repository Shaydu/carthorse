#!/usr/bin/env ts-node

import { Client } from 'pg';

async function testTrailSplitting() {
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
    const testSchema = 'test_splitting_' + Date.now();
    console.log(`Creating test schema: ${testSchema}`);
    
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create trails table with all required columns
    await client.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        osm_id TEXT,
        name TEXT NOT NULL,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create intersection_points table
    await client.query(`
      CREATE TABLE ${testSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters FLOAT
      )
    `);

    // Insert test data with T-intersection
    await client.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, region, geometry) VALUES
      ('trail1', 'Enchanted Mesa Trail', 'boulder', ST_GeomFromText('LINESTRING(-105.2824 39.9886, -105.2820 39.9888)', 4326)),
      ('trail2', 'Enchanted-Kohler Spur Trail', 'boulder', ST_GeomFromText('LINESTRING(-105.2822 39.9884, -105.282387 39.988581)', 4326))
    `);

    console.log('Test data created');

    // Check original trail count
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

    // Test the detect_trail_intersections function
    console.log('\n=== Step 2: Test intersection detection ===');
    const intersections = await client.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM detect_trail_intersections($1, 'trails', 3.0)
      ORDER BY distance_meters
    `, [testSchema]);

    console.log('Detected intersections:');
    if (intersections.rows.length === 0) {
      console.log('  No intersections detected');
    } else {
      intersections.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Point: ${row.point_text}`);
        console.log(`     Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`     Type: ${row.node_type}`);
        console.log(`     Distance: ${row.distance_meters.toFixed(4)}m`);
      });
    }

    // Test manual splitting logic
    console.log('\n=== Step 3: Test manual splitting logic ===');
    
    // First, let's manually split one trail at the intersection point
    const splitTest = await client.query(`
      WITH intersection_point AS (
        SELECT ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry)) as point
        FROM ${testSchema}.trails t1
        JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE t1.name = 'Enchanted Mesa Trail' AND t2.name = 'Enchanted-Kohler Spur Trail'
        LIMIT 1
      ),
      split_result AS (
        SELECT 
          t.app_uuid,
          t.name,
          (ST_Dump(ST_Split(t.geometry, ip.point))).geom as split_geometry,
          (ST_Dump(ST_Split(t.geometry, ip.point))).path[1] as segment_order
        FROM ${testSchema}.trails t
        CROSS JOIN intersection_point ip
        WHERE t.name = 'Enchanted Mesa Trail'
      )
      SELECT 
        app_uuid,
        name,
        segment_order,
        ST_AsText(split_geometry) as geometry_text,
        ST_Length(split_geometry::geography) as length_meters
      FROM split_result
      ORDER BY segment_order
    `);

    console.log('Manual split results:');
    if (splitTest.rows.length === 0) {
      console.log('  No split results');
    } else {
      splitTest.rows.forEach(row => {
        console.log(`  Segment ${row.segment_order}:`);
        console.log(`    Trail: ${row.name}`);
        console.log(`    UUID: ${row.app_uuid}`);
        console.log(`    Geometry: ${row.geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
      });
    }

    // Test the full copy_and_split_trails_to_staging_native function
    console.log('\n=== Step 4: Test full splitting function ===');
    const splitResult = await client.query(`
      SELECT * FROM copy_and_split_trails_to_staging_native(
        $1, 'trails', 'boulder', NULL, NULL, NULL, NULL, NULL, 3.0
      )
    `, [testSchema]);

    console.log('Full splitting result:');
    splitResult.rows.forEach(row => {
      console.log(`  Original: ${row.original_count}`);
      console.log(`  Split: ${row.split_count}`);
      console.log(`  Intersections: ${row.intersection_count}`);
      console.log(`  Success: ${row.success}`);
      console.log(`  Message: ${row.message}`);
    });

    // Check the resulting trails after splitting
    console.log('\n=== Step 5: Check trails after splitting ===');
    const splitTrails = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(geometry) as geometry_text,
        ST_Length(geometry::geography) as length_meters
      FROM ${testSchema}.trails
      ORDER BY name, ST_Length(geometry::geography)
    `);

    console.log('Trails after splitting:');
    if (splitTrails.rows.length === 0) {
      console.log('  No trails found after splitting');
    } else {
      splitTrails.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. ${row.name}:`);
        console.log(`    UUID: ${row.app_uuid}`);
        console.log(`    Geometry: ${row.geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
      });
    }

    // Check intersection_points table
    console.log('\n=== Step 6: Check intersection_points table ===');
    const intersectionPoints = await client.query(`
      SELECT 
        ST_AsText(point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM ${testSchema}.intersection_points
      ORDER BY distance_meters
    `);

    console.log('Intersection points in table:');
    if (intersectionPoints.rows.length === 0) {
      console.log('  No intersection points found');
    } else {
      intersectionPoints.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Point: ${row.point_text}`);
        console.log(`     Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`     Type: ${row.node_type}`);
        console.log(`     Distance: ${row.distance_meters.toFixed(4)}m`);
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

testTrailSplitting().catch(console.error);
