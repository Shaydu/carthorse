#!/usr/bin/env ts-node

import { Client } from 'pg';

async function debugEnchantedMesaTIntersection() {
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

    // Test 1: Check if the trails exist and their geometries
    console.log('\n=== Test 1: Check trail geometries ===');
    const trailsResult = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ORDER BY name
    `);

    console.log('Trails found:');
    trailsResult.rows.forEach(row => {
      console.log(`  ${row.name}:`);
      console.log(`    UUID: ${row.app_uuid}`);
      console.log(`    Start: ${row.start_point}`);
      console.log(`    End: ${row.end_point}`);
      console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
    });

    // Test 2: Check for T-intersections manually
    console.log('\n=== Test 2: Manual T-intersection detection ===');
    const tIntersectionResult = await client.query(`
      WITH trail_data AS (
        SELECT 
          app_uuid,
          name,
          geometry,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM public.trails 
        WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
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
        distance_meters,
        CASE 
          WHEN distance_meters <= 3.0 THEN 'Within tolerance'
          ELSE 'Outside tolerance'
        END as tolerance_status
      FROM t_intersections
      ORDER BY distance_meters
    `);

    console.log('T-intersections found:');
    if (tIntersectionResult.rows.length === 0) {
      console.log('  No T-intersections found within 3-meter tolerance');
    } else {
      tIntersectionResult.rows.forEach(row => {
        console.log(`  ${row.endpoint_trail_name} (${row.endpoint_type}) -> ${row.nearby_trail_name}:`);
        console.log(`    Distance: ${row.distance_meters.toFixed(2)} meters`);
        console.log(`    Status: ${row.tolerance_status}`);
        console.log(`    Endpoint: ${row.endpoint_point_text}`);
        console.log(`    Snapped: ${row.snapped_point_text}`);
      });
    }

    // Test 3: Check current intersection_points table
    console.log('\n=== Test 3: Current intersection_points table ===');
    const intersectionResult = await client.query(`
      SELECT 
        ST_AsText(point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM public.intersection_points
      WHERE 'Enchanted Mesa Trail' = ANY(connected_trail_names)
         OR 'Enchanted-Kohler Spur Trail' = ANY(connected_trail_names)
      ORDER BY distance_meters
    `);

    console.log('Intersections in table:');
    if (intersectionResult.rows.length === 0) {
      console.log('  No intersections found for these trails');
    } else {
      intersectionResult.rows.forEach(row => {
        console.log(`  Point: ${row.point_text}`);
        console.log(`  Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`  Type: ${row.node_type}`);
        console.log(`  Distance: ${row.distance_meters}m`);
      });
    }

    // Test 4: Test the detect_trail_intersections function
    console.log('\n=== Test 4: Test detect_trail_intersections function ===');
    const detectResult = await client.query(`
      SELECT * FROM detect_trail_intersections('public', 'trails', 3.0)
      WHERE 'Enchanted Mesa Trail' = ANY(connected_trail_names)
         OR 'Enchanted-Kohler Spur Trail' = ANY(connected_trail_names)
      ORDER BY distance_meters
    `);

    console.log('detect_trail_intersections results:');
    if (detectResult.rows.length === 0) {
      console.log('  No intersections detected by function');
    } else {
      detectResult.rows.forEach(row => {
        console.log(`  Point: ${row.intersection_point}`);
        console.log(`  Trails: ${row.connected_trail_names.join(' <-> ')}`);
        console.log(`  Type: ${row.node_type}`);
        console.log(`  Distance: ${row.distance_meters}m`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

debugEnchantedMesaTIntersection().catch(console.error);
