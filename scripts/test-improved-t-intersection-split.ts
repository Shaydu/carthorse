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

async function testImprovedTIntersectionSplit() {
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
    const testSchema = 'test_improved_t_' + Date.now();
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

    // Test improved T-intersection detection and splitting
    console.log('\n=== Step 1: Improved T-intersection detection and splitting ===');
    const improvedSplits = await client.query(`
      WITH
      -- Find T-intersections with improved logic
      t_intersections AS (
          SELECT 
              t1.app_uuid AS endpoint_trail_uuid,
              t1.name AS endpoint_trail_name,
              t2.app_uuid AS nearby_trail_uuid,
              t2.name AS nearby_trail_name,
              ST_EndPoint(t1.geometry) AS endpoint_point,
              ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) AS distance_meters,
              ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry))) AS location_ratio
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
              ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) AS location_ratio
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE ST_DWithin(ST_StartPoint(t1.geometry), t2.geometry, 3.0)
      ),
      -- Filter to valid T-intersections and ensure they're not at vertices
      valid_t_intersections AS (
          SELECT *
          FROM t_intersections
          WHERE distance_meters <= 3.0
            AND location_ratio > 0.0 
            AND location_ratio < 1.0  -- Ensure it's between vertices, not at endpoints
      ),
      -- Add the snapped point to the trail geometry and then split
      split_segments AS (
          SELECT
              ti.nearby_trail_uuid,
              ti.nearby_trail_name,
              ti.snapped_point,
              ti.location_ratio,
              -- Add point and split, then dump all segments
              (ST_Dump(ST_Split(
                  ST_AddPoint(
                      (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.nearby_trail_uuid),
                      ti.snapped_point,
                      (ti.location_ratio * (ST_NumPoints((SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.nearby_trail_uuid)) - 1))::integer
                  ), 
                  ti.snapped_point
              ))).geom AS split_geometry,
              (ST_Dump(ST_Split(
                  ST_AddPoint(
                      (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.nearby_trail_uuid),
                      ti.snapped_point,
                      (ti.location_ratio * (ST_NumPoints((SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = ti.nearby_trail_uuid)) - 1))::integer
                  ), 
                  ti.snapped_point
              ))).path[1] AS segment_order
          FROM valid_t_intersections ti
      )
      SELECT
          'split_segment' AS result_type,
          nearby_trail_uuid AS trail_uuid,
          nearby_trail_name AS trail_name,
          segment_order,
          ST_AsText(split_geometry) AS geometry_text,
          ST_Length(split_geometry::geography) AS length_meters,
          ST_NumPoints(split_geometry) AS num_points,
          ST_AsText(snapped_point) AS snapped_point_text,
          location_ratio
      FROM split_segments
      WHERE ST_IsValid(split_geometry) 
        AND ST_NumPoints(split_geometry) >= 2
        AND ST_Length(split_geometry::geography) > 0
      ORDER BY trail_name, segment_order
    `);

    console.log('Improved split results:');
    if (improvedSplits.rows.length === 0) {
      console.log('  No valid splits generated - all intersections may be at vertices');
    } else {
      improvedSplits.rows.forEach(row => {
        console.log(`  ${row.result_type} - ${row.trail_name} - Segment ${row.segment_order}:`);
        console.log(`    UUID: ${row.trail_uuid}`);
        console.log(`    Snapped point: ${row.snapped_point_text}`);
        console.log(`    Location ratio: ${row.location_ratio.toFixed(4)}`);
        console.log(`    Length: ${row.length_meters.toFixed(2)}m`);
        console.log(`    Points: ${row.num_points}`);
        console.log('');
      });
    }

    // Test specific Enchanted trails with detailed analysis
    console.log('\n=== Step 2: Detailed analysis of Enchanted trails ===');
    const enchantedAnalysis = await client.query(`
      WITH
      enchanted_trails AS (
          SELECT 
              t1.app_uuid AS spur_uuid,
              t1.name AS spur_name,
              t2.app_uuid AS mesa_uuid,
              t2.name AS mesa_name,
              ST_EndPoint(t1.geometry) AS spur_endpoint,
              ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry)) AS snapped_point,
              ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) AS distance_meters,
              ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_EndPoint(t1.geometry))) AS location_ratio,
              ST_NumPoints(t2.geometry) AS mesa_num_points
          FROM ${testSchema}.trails t1
          JOIN ${testSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
          WHERE t1.name LIKE '%Enchanted-Kohler Spur%' 
            AND t2.name LIKE '%Enchanted Mesa%'
      )
      SELECT 
          spur_name,
          mesa_name,
          ST_AsText(spur_endpoint) AS spur_endpoint_text,
          ST_AsText(snapped_point) AS snapped_point_text,
          distance_meters,
          location_ratio,
          mesa_num_points,
          CASE 
              WHEN location_ratio = 0.0 THEN 'at start'
              WHEN location_ratio = 1.0 THEN 'at end'
              WHEN location_ratio > 0.0 AND location_ratio < 1.0 THEN 'between vertices'
              ELSE 'at vertex'
          END AS position_type
      FROM enchanted_trails
    `);

    console.log('Enchanted trails detailed analysis:');
    enchantedAnalysis.rows.forEach(row => {
      console.log(`  ${row.spur_name} → ${row.mesa_name}:`);
      console.log(`    Spur endpoint: ${row.spur_endpoint_text}`);
      console.log(`    Snapped point: ${row.snapped_point_text}`);
      console.log(`    Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`    Location ratio: ${row.location_ratio.toFixed(4)}`);
      console.log(`    Mesa trail points: ${row.mesa_num_points}`);
      console.log(`    Position type: ${row.position_type}`);
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

testImprovedTIntersectionSplit().catch(console.error);
