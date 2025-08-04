#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

async function exportUteSplittingResults() {
  try {
    await client.connect();
    console.log('📁 Exporting Ute Trail splitting results...');

    // Export the original Ute Trail
    console.log('\n📊 Exporting original Ute Trail...');
    await exportOriginalUteTrail();

    // Export the interval-split segments
    console.log('\n📊 Exporting interval-split segments...');
    await exportIntervalSplitSegments();

    // Export the nodeNetwork results
    console.log('\n📊 Exporting nodeNetwork results...');
    await exportNodeNetworkResults();

    // Fix and export vertices table
    console.log('\n📊 Fixing and exporting vertices table...');
    await fixAndExportVerticesTable();

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function exportOriginalUteTrail() {
  const query = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'name', name,
              'app_uuid', app_uuid,
              'num_points', ST_NumPoints(geometry),
              'is_simple', ST_IsSimple(geometry),
              'is_loop', NOT ST_IsSimple(geometry)
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        )
      ) as geojson
    FROM staging_boulder_1754318437837.trails 
    WHERE name LIKE '%Ute%' AND NOT ST_IsSimple(geometry)
  `;
  
  const result = await client.query(query);
  if (result.rows[0].geojson) {
    fs.writeFileSync('ute-trail-original.geojson', JSON.stringify(result.rows[0].geojson, null, 2));
    console.log('  ✅ Exported original Ute Trail to ute-trail-original.geojson');
  }
}

async function exportIntervalSplitSegments() {
  // Get the interval-split segments from our test
  const query = `
    WITH ute_trail AS (
      SELECT ST_Force2D(geometry) as geom, ST_NumPoints(geometry) as num_points
      FROM staging_boulder_1754318437837.trails 
      WHERE name LIKE '%Ute%' AND NOT ST_IsSimple(geometry)
    ),
    split_points AS (
      SELECT 
        generate_series(1, num_points - 1, 10) as point_index  -- Split every 10 points
      FROM ute_trail
    ),
    segments AS (
      SELECT 
        ST_LineSubstring(geom, 
          (point_index::float / num_points), 
          LEAST((point_index + 10)::float / num_points, 1.0)
        ) as segment,
        point_index
      FROM split_points, ute_trail
      WHERE point_index < num_points
    )
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'segment_index', point_index,
              'num_points', ST_NumPoints(segment),
              'is_simple', ST_IsSimple(segment),
              'start_point', ST_AsText(ST_StartPoint(segment)),
              'end_point', ST_AsText(ST_EndPoint(segment))
            ),
            'geometry', ST_AsGeoJSON(segment)::json
          )
        )
      ) as geojson
    FROM segments
    WHERE ST_GeometryType(segment) = 'ST_LineString'
      AND ST_NumPoints(segment) > 1
      AND ST_IsSimple(segment)
  `;
  
  const result = await client.query(query);
  if (result.rows[0].geojson) {
    fs.writeFileSync('ute-trail-interval-split.geojson', JSON.stringify(result.rows[0].geojson, null, 2));
    console.log('  ✅ Exported interval-split segments to ute-trail-interval-split.geojson');
  }
}

async function exportNodeNetworkResults() {
  // Export the nodeNetwork edges
  const edgesQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'old_id', old_id,
              'sub_id', sub_id,
              'source', source,
              'target', target
            ),
            'geometry', ST_AsGeoJSON(the_geom)::json
          )
        )
      ) as geojson
    FROM staging_boulder_1754318437837.ways_bbox_simple_interval_noded
    WHERE the_geom IS NOT NULL
  `;
  
  const edgesResult = await client.query(edgesQuery);
  if (edgesResult.rows[0].geojson) {
    fs.writeFileSync('ute-trail-nodenetwork-edges.geojson', JSON.stringify(edgesResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported nodeNetwork edges to ute-trail-nodenetwork-edges.geojson');
  }
}

async function fixAndExportVerticesTable() {
  // Check if vertices table exists in public schema
  const checkPublicQuery = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'ways_bbox_simple_interval_noded_vertices_pgr'
    )
  `;
  
  const publicExists = await client.query(checkPublicQuery);
  
  if (publicExists.rows[0].exists) {
    console.log('  Found vertices table in public schema, copying to staging...');
    
    // Copy vertices table to staging schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS staging_boulder_1754318437837.ways_bbox_simple_interval_noded_vertices_pgr AS
      SELECT * FROM public.ways_bbox_simple_interval_noded_vertices_pgr
    `);
    
    console.log('  ✅ Copied vertices table to staging schema');
  } else {
    console.log('  Creating vertices table from edges...');
    
    // Create vertices table from the edges
    await client.query(`
      CREATE TABLE IF NOT EXISTS staging_boulder_1754318437837.ways_bbox_simple_interval_noded_vertices_pgr AS
      SELECT DISTINCT
        id,
        the_geom,
        cnt,
        chk,
        ein,
        eout
      FROM (
        SELECT 
          source as id,
          ST_StartPoint(the_geom) as the_geom,
          1 as cnt,
          0 as chk,
          0 as ein,
          1 as eout
        FROM staging_boulder_1754318437837.ways_bbox_simple_interval_noded
        WHERE source IS NOT NULL
        UNION
        SELECT 
          target as id,
          ST_EndPoint(the_geom) as the_geom,
          1 as cnt,
          0 as chk,
          1 as ein,
          0 as eout
        FROM staging_boulder_1754318437837.ways_bbox_simple_interval_noded
        WHERE target IS NOT NULL
      ) vertices
      ORDER BY id
    `);
    
    console.log('  ✅ Created vertices table from edges');
  }
  
  // Export vertices to GeoJSON
  const verticesQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'cnt', cnt,
              'chk', chk,
              'ein', ein,
              'eout', eout
            ),
            'geometry', ST_AsGeoJSON(the_geom)::json
          )
        )
      ) as geojson
    FROM staging_boulder_1754318437837.ways_bbox_simple_interval_noded_vertices_pgr
    WHERE the_geom IS NOT NULL
  `;
  
  const verticesResult = await client.query(verticesQuery);
  if (verticesResult.rows[0].geojson) {
    fs.writeFileSync('ute-trail-nodenetwork-vertices.geojson', JSON.stringify(verticesResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported vertices to ute-trail-nodenetwork-vertices.geojson');
  }
  
  // Get statistics
  const statsQuery = `
    SELECT 
      COUNT(*) as total_edges,
      (SELECT COUNT(*) FROM staging_boulder_1754318437837.ways_bbox_simple_interval_noded_vertices_pgr) as total_vertices
    FROM staging_boulder_1754318437837.ways_bbox_simple_interval_noded
  `;
  
  const statsResult = await client.query(statsQuery);
  const stats = statsResult.rows[0];
  console.log(`  📊 Network stats: ${stats.total_edges} edges, ${stats.total_vertices} vertices`);
}

exportUteSplittingResults(); 