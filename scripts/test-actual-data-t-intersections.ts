#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface GeoJSONFeature {
  type: string;
  properties: {
    id: string;
    name: string;
    region: string;
    [key: string]: any;
  };
  geometry: {
    type: string;
    coordinates: number[][];
  };
}

interface GeoJSON {
  type: string;
  features: GeoJSONFeature[];
}

async function testActualDataTIntersections() {
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
    const testSchema = 'test_actual_data_' + Date.now();
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

    // Load actual data from the GeoJSON file
    console.log('Loading actual trail data from GeoJSON file...');
    const geojsonPath = path.join(__dirname, '..', 'test-output', 'boulder-degree-colored-export-layer1-trails.geojson');
    const geojsonData: GeoJSON = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

    // Insert trails into the test database
    let insertedCount = 0;
    for (const feature of geojsonData.features) {
      if (feature.geometry.type === 'LineString' && feature.properties.name) {
        const coordinates = feature.geometry.coordinates.map(coord => `${coord[0]} ${coord[1]}`).join(',');
        const linestring = `LINESTRING(${coordinates})`;
        
        try {
          await client.query(`
            INSERT INTO ${testSchema}.trails (app_uuid, name, geometry) 
            VALUES ($1, $2, ST_GeomFromText($3, 4326))
          `, [feature.properties.id, feature.properties.name, linestring]);
          insertedCount++;
        } catch (error) {
          console.log(`Skipping trail ${feature.properties.name}: ${(error as Error).message}`);
        }
      }
    }

    console.log(`Inserted ${insertedCount} trails into test database`);

    // Test T-intersection detection
    console.log('\n=== Step 1: T-intersection detection ===');
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
      LIMIT 10
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

    // Test specific Enchanted Mesa and Enchanted-Kohler Spur intersection
    console.log('\n=== Step 2: Specific test for Enchanted trails ===');
    const specificTest = await client.query(`
      WITH
      enchanted_trails AS (
          SELECT 
              t1.app_uuid AS spur_uuid,
              t1.name AS spur_name,
              t2.app_uuid AS mesa_uuid,
              t2.name AS mesa_name,
              ST_EndPoint(t1.geometry) AS spur_endpoint,
              ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) AS distance_meters
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE t1.name LIKE '%Enchanted-Kohler Spur%' 
            AND t2.name LIKE '%Enchanted Mesa%'
      ),
      split_test AS (
          SELECT
              spur_uuid,
              spur_name,
              mesa_uuid,
              mesa_name,
              spur_endpoint,
              snapped_point,
              distance_meters,
              -- Split the Mesa trail at the snapped point
              (ST_Dump(ST_Split(
                  (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = mesa_uuid),
                  snapped_point
              ))).geom AS split_geometry,
              (ST_Dump(ST_Split(
                  (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = mesa_uuid),
                  snapped_point
              ))).path[1] AS segment_order
          FROM enchanted_trails
      )
      SELECT 
          spur_name,
          mesa_name,
          ST_AsText(spur_endpoint) AS spur_endpoint_text,
          ST_AsText(snapped_point) AS snapped_point_text,
          distance_meters,
          segment_order,
          ST_AsText(split_geometry) AS split_geometry_text,
          ST_Length(split_geometry::geography) AS length_meters,
          ST_NumPoints(split_geometry) AS num_points
      FROM split_test
      WHERE ST_IsValid(split_geometry) 
        AND ST_NumPoints(split_geometry) >= 2
        AND ST_Length(split_geometry::geography) > 0
      ORDER BY segment_order
    `);

    console.log('Enchanted trails specific test:');
    if (specificTest.rows.length === 0) {
      console.log('  No Enchanted trails found or no valid splits generated');
    } else {
      specificTest.rows.forEach(row => {
        console.log(`  ${row.spur_name} → ${row.mesa_name} - Segment ${row.segment_order}:`);
        console.log(`    Spur endpoint: ${row.spur_endpoint_text}`);
        console.log(`    Snapped point: ${row.snapped_point_text}`);
        console.log(`    Distance: ${row.distance_meters.toFixed(2)}m`);
        console.log(`    Split geometry: ${row.split_geometry_text}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
        console.log(`    Points: ${row.num_points}`);
        console.log('');
      });
    }

    // Test generic splitting function
    console.log('\n=== Step 3: Generic splitting test ===');
    const genericSplits = await client.query(`
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
      )
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
      ORDER BY trail_name, segment_order
      LIMIT 5
    `);

    console.log('Generic split results (first 5):');
    if (genericSplits.rows.length === 0) {
      console.log('  No valid splits generated');
    } else {
      genericSplits.rows.forEach(row => {
        console.log(`  ${row.result_type} - ${row.trail_name} - Segment ${row.segment_order}:`);
        console.log(`    UUID: ${row.trail_uuid}`);
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

testActualDataTIntersections().catch(console.error);
