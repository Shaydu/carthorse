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

async function testVertexAwareTIntersectionSplit() {
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

    // Read the actual trail data
    const geojsonPath = path.join(__dirname, '../test-output/boulder-degree-colored-export-layer1-trails.geojson');
    const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8')) as GeoJSON;

    // Create test schema
    const testSchema = 'test_vertex_aware_t_split';
    await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await client.query(`CREATE SCHEMA ${testSchema}`);

    // Create trails table
    await client.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        osm_id TEXT,
        geometry GEOMETRY(LINESTRING, 4326) NOT NULL
      )
    `);

    // Insert the actual trail data
    console.log('Inserting actual trail data...');
    for (const feature of geojsonData.features) {
      try {
        const coordinates = feature.geometry.coordinates;
        const linestring = `LINESTRING(${coordinates.map(coord => `${coord[0]} ${coord[1]}`).join(', ')})`;
        
        await client.query(`
          INSERT INTO ${testSchema}.trails (app_uuid, name, region, trail_type, osm_id, geometry)
          VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 4326))
        `, [
          feature.properties.id,
          feature.properties.name,
          feature.properties.region || 'boulder',
          feature.properties.trail_type || 'trail',
          feature.properties.osm_id || null,
          linestring
        ]);
      } catch (error) {
        console.log(`Skipping trail ${feature.properties.name}: ${(error as Error).message}`);
      }
    }

    console.log('Trail data inserted successfully');

    // Test the vertex-aware T-intersection detection and splitting
    console.log('\n=== Testing Vertex-Aware T-Intersection Detection and Splitting ===');
    
    const result = await client.query(`
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
      ),
      -- Find the line location and ensure we're between vertices
      vertex_aware_splits AS (
          SELECT
              ti.*,
              -- Get the line location (0.0 to 1.0) of the snapped point
              ST_LineLocatePoint(t2.geometry, ti.snapped_point) AS line_location,
              -- Get the number of vertices in the trail
              ST_NumPoints(t2.geometry) AS num_vertices,
              -- Check if we're at a vertex (within 0.001 tolerance)
              CASE 
                  WHEN ST_LineLocatePoint(t2.geometry, ti.snapped_point) < 0.001 
                       OR ST_LineLocatePoint(t2.geometry, ti.snapped_point) > 0.999
                       OR EXISTS (
                           SELECT 1 
                           FROM generate_series(1, ST_NumPoints(t2.geometry)) AS vertex_idx
                           WHERE ABS(ST_LineLocatePoint(t2.geometry, ti.snapped_point) - 
                                    ((vertex_idx - 1.0) / (ST_NumPoints(t2.geometry) - 1.0))) < 0.001
                       )
                  THEN true
                  ELSE false
              END AS is_at_vertex,
              -- If at vertex, move slightly to create a proper split
              CASE 
                  WHEN ST_LineLocatePoint(t2.geometry, ti.snapped_point) < 0.001 
                       OR ST_LineLocatePoint(t2.geometry, ti.snapped_point) > 0.999
                       OR EXISTS (
                           SELECT 1 
                           FROM generate_series(1, ST_NumPoints(t2.geometry)) AS vertex_idx
                           WHERE ABS(ST_LineLocatePoint(t2.geometry, ti.snapped_point) - 
                                    ((vertex_idx - 1.0) / (ST_NumPoints(t2.geometry) - 1.0))) < 0.001
                       )
                  THEN ST_LineInterpolatePoint(t2.geometry, 
                       GREATEST(0.001, LEAST(0.999, ST_LineLocatePoint(t2.geometry, ti.snapped_point) + 0.01)))
                  ELSE ti.snapped_point
              END AS adjusted_snapped_point
          FROM valid_t_intersections ti
          JOIN ${testSchema}.trails t2 ON ti.nearby_trail_uuid = t2.app_uuid
      ),
      -- Split the nearby trails at the adjusted snapped points
      split_segments AS (
          SELECT
              vas.nearby_trail_uuid,
              vas.nearby_trail_name,
              vas.adjusted_snapped_point,
              vas.line_location,
              vas.is_at_vertex,
              -- Split the trail and get all segments
              (ST_Dump(ST_Split(
                  (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = vas.nearby_trail_uuid),
                  vas.adjusted_snapped_point
              ))).geom AS split_geometry,
              (ST_Dump(ST_Split(
                  (SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = vas.nearby_trail_uuid),
                  vas.adjusted_snapped_point
              ))).path[1] AS segment_order
          FROM vertex_aware_splits vas
      ),
      -- Create snapped versions of endpoint trails
      snapped_endpoint_trails AS (
          SELECT
              vas.endpoint_trail_uuid,
              vas.endpoint_trail_name,
              vas.adjusted_snapped_point,
              ST_SetSRID(
                  ST_MakeLine(
                      ST_StartPoint((SELECT geometry FROM ${testSchema}.trails WHERE app_uuid = vas.endpoint_trail_uuid)),
                      vas.adjusted_snapped_point
                  ),
                  4326
              ) AS snapped_geometry
          FROM vertex_aware_splits vas
      )
      -- Combine all results
      SELECT
          'split_segment'::text AS operation_type,
          nearby_trail_uuid::text AS trail_uuid,
          nearby_trail_name::text AS trail_name,
          segment_order::integer,
          split_geometry AS geometry,
          ST_Length(split_geometry::geography) AS length_meters,
          ST_NumPoints(split_geometry)::integer AS num_points,
          line_location,
          is_at_vertex
      FROM split_segments
      WHERE ST_IsValid(split_geometry) 
        AND ST_NumPoints(split_geometry) >= 2
        AND ST_Length(split_geometry::geography) > 0
        
      UNION ALL
      
      SELECT
          'snapped_trail'::text AS operation_type,
          endpoint_trail_uuid::text AS trail_uuid,
          endpoint_trail_name::text AS trail_name,
          1::integer AS segment_order,
          snapped_geometry AS geometry,
          ST_Length(snapped_geometry::geography) AS length_meters,
          ST_NumPoints(snapped_geometry)::integer AS num_points,
          NULL AS line_location,
          NULL AS is_at_vertex
      FROM snapped_endpoint_trails
      WHERE ST_IsValid(snapped_geometry) 
        AND ST_NumPoints(snapped_geometry) >= 2
        AND ST_Length(snapped_geometry::geography) > 0
        
      ORDER BY operation_type, trail_name, segment_order
    `);

    console.log('\n=== T-Intersection Split Results ===');
    console.log(`Found ${result.rows.length} split/snapped segments:`);
    
    for (const row of result.rows) {
      console.log(`\n${row.operation_type.toUpperCase()}:`);
      console.log(`  Trail: ${row.trail_name}`);
      console.log(`  Segment Order: ${row.segment_order}`);
      console.log(`  Length: ${row.length_meters.toFixed(2)}m`);
      console.log(`  Points: ${row.num_points}`);
      if (row.line_location !== null) {
        console.log(`  Line Location: ${row.line_location.toFixed(4)}`);
        console.log(`  Was at vertex: ${row.is_at_vertex}`);
      }
    }

    // Check if we got the expected Enchanted Mesa split
    const mesaSplits = result.rows.filter(row => 
      row.trail_name === 'Enchanted Mesa Trail' && row.operation_type === 'split_segment'
    );
    
    console.log(`\n=== Enchanted Mesa Trail Splits ===`);
    console.log(`Found ${mesaSplits.length} split segments for Enchanted Mesa Trail`);
    
    if (mesaSplits.length >= 2) {
      console.log('✅ SUCCESS: Enchanted Mesa Trail was properly split into multiple segments!');
    } else {
      console.log('❌ ISSUE: Enchanted Mesa Trail was not split into multiple segments');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testVertexAwareTIntersectionSplit().catch(console.error);
