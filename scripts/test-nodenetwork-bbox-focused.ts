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

async function testNodeNetworkOnBbox() {
  try {
    await client.connect();
    console.log('🔍 Testing pgr_nodeNetwork on focused bbox...');

    // Define the bbox coordinates
    const bbox = {
      minX: -105.33917192801866,
      minY: 39.95803339005218,
      maxX: -105.2681945500977,
      maxY: 40.0288146943966
    };

    console.log(`\n📊 Bbox: [${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}]`);

    // Create table with trails in this bbox
    const query = `
      CREATE TEMP TABLE ways_bbox_focused AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
        app_uuid as trail_uuid,
        name,
        CASE
          WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
          ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
        END as the_geom
      FROM staging_boulder_1754318437837.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `;

    try {
      await client.query('DROP TABLE IF EXISTS ways_bbox_focused');
      await client.query(query, [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]);
      
      const countResult = await client.query('SELECT COUNT(*) as count FROM ways_bbox_focused');
      const trailCount = parseInt(countResult.rows[0].count);
      
      console.log(`Found ${trailCount} trails in bbox`);
      
      if (trailCount === 0) {
        console.log('❌ No trails found in bbox');
        return;
      }

      // Analyze the geometries
      console.log('\n🔍 Analyzing geometries...');
      const geometryAnalysis = await client.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN ST_IsSimple(the_geom) THEN 1 END) as simple_geometries,
          COUNT(CASE WHEN NOT ST_IsSimple(the_geom) THEN 1 END) as non_simple_geometries,
          COUNT(CASE WHEN ST_IsValid(the_geom) THEN 1 END) as valid_geometries,
          COUNT(CASE WHEN NOT ST_IsValid(the_geom) THEN 1 END) as invalid_geometries,
          COUNT(CASE WHEN ST_GeometryType(the_geom) = 'ST_LineString' THEN 1 END) as linestrings,
          COUNT(CASE WHEN ST_GeometryType(the_geom) = 'ST_MultiLineString' THEN 1 END) as multilinestrings,
          COUNT(CASE WHEN ST_GeometryType(the_geom) = 'ST_GeometryCollection' THEN 1 END) as geometrycollections
        FROM ways_bbox_focused
      `);
      
      const analysis = geometryAnalysis.rows[0];
      console.log(`  Total trails: ${analysis.total_trails}`);
      console.log(`  Simple geometries: ${analysis.simple_geometries}`);
      console.log(`  Non-simple geometries: ${analysis.non_simple_geometries}`);
      console.log(`  Valid geometries: ${analysis.valid_geometries}`);
      console.log(`  Invalid geometries: ${analysis.invalid_geometries}`);
      console.log(`  LineStrings: ${analysis.linestrings}`);
      console.log(`  MultiLineStrings: ${analysis.multilinestrings}`);
      console.log(`  GeometryCollections: ${analysis.geometrycollections}`);

      // Export the input data for inspection
      await exportBboxData();

      // Try pgr_nodeNetwork
      console.log('\n🧪 Testing pgr_nodeNetwork...');
      await client.query(`SELECT pgr_nodeNetwork('ways_bbox_focused', 0.000001, 'id', 'the_geom')`);
      
      console.log('✅ pgr_nodeNetwork succeeded!');
      
      // Get results
      const nodeResult = await client.query('SELECT COUNT(*) as count FROM ways_bbox_focused_noded_vertices_pgr');
      const edgeResult = await client.query('SELECT COUNT(*) as count FROM ways_bbox_focused_noded');
      
      const nodeCount = parseInt(nodeResult.rows[0].count);
      const edgeCount = parseInt(edgeResult.rows[0].count);
      
      console.log(`  Created ${nodeCount} nodes and ${edgeCount} edges`);
      
      // Export results
      await exportResults();
      
    } catch (error) {
      console.log(`❌ pgr_nodeNetwork failed: ${(error as Error).message}`);
      
      // Try to identify the problematic geometry
      await identifyProblematicGeometry();
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function exportBboxData() {
  console.log('\n📁 Exporting bbox data for inspection...');
  
  try {
    // Export input trails to GeoJSON
    const geojsonQuery = `
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'id', id,
                'trail_uuid', trail_uuid,
                'name', name,
                'is_simple', ST_IsSimple(the_geom),
                'is_valid', ST_IsValid(the_geom),
                'geometry_type', ST_GeometryType(the_geom),
                'num_points', ST_NumPoints(the_geom)
              ),
              'geometry', ST_AsGeoJSON(the_geom)::json
            )
          )
        ) as geojson
      FROM ways_bbox_focused
    `;
    
    const result = await client.query(geojsonQuery);
    const geojson = result.rows[0].geojson;
    
    fs.writeFileSync('bbox-focused-input.geojson', JSON.stringify(geojson, null, 2));
    console.log('  ✅ Exported to bbox-focused-input.geojson');
    
  } catch (error) {
    console.log(`  ❌ Error exporting data: ${(error as Error).message}`);
  }
}

async function identifyProblematicGeometry() {
  console.log('\n🔍 Identifying problematic geometries...');
  
  try {
    // Check for non-simple geometries
    const nonSimpleQuery = `
      SELECT id, trail_uuid, name, ST_GeometryType(the_geom) as geom_type, ST_NumPoints(the_geom) as num_points
      FROM ways_bbox_focused 
      WHERE NOT ST_IsSimple(the_geom)
      LIMIT 5
    `;
    
    const nonSimpleResult = await client.query(nonSimpleQuery);
    if (nonSimpleResult.rows.length > 0) {
      console.log('  Non-simple geometries found:');
      nonSimpleResult.rows.forEach(row => {
        console.log(`    ID ${row.id}: ${row.name} (${row.geom_type}, ${row.num_points} points)`);
      });
    }
    
    // Check for invalid geometries
    const invalidQuery = `
      SELECT id, trail_uuid, name, ST_GeometryType(the_geom) as geom_type
      FROM ways_bbox_focused 
      WHERE NOT ST_IsValid(the_geom)
      LIMIT 5
    `;
    
    const invalidResult = await client.query(invalidQuery);
    if (invalidResult.rows.length > 0) {
      console.log('  Invalid geometries found:');
      invalidResult.rows.forEach(row => {
        console.log(`    ID ${row.id}: ${row.name} (${row.geom_type})`);
      });
    }
    
  } catch (error) {
    console.log(`  ❌ Error identifying problematic geometries: ${(error as Error).message}`);
  }
}

async function exportResults() {
  console.log('\n📁 Exporting results...');
  
  try {
    // Export noded network to GeoJSON
    const geojsonQuery = `
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'id', id,
                'trail_uuid', trail_uuid,
                'name', name,
                'source', source,
                'target', target
              ),
              'geometry', ST_AsGeoJSON(the_geom)::json
            )
          )
        ) as geojson
      FROM ways_bbox_focused_noded
    `;
    
    const result = await client.query(geojsonQuery);
    const geojson = result.rows[0].geojson;
    
    fs.writeFileSync('bbox-focused-noded.geojson', JSON.stringify(geojson, null, 2));
    console.log('  ✅ Exported to bbox-focused-noded.geojson');
    
    // Export vertices
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
      FROM ways_bbox_focused_noded_vertices_pgr
    `;
    
    const verticesResult = await client.query(verticesQuery);
    const verticesGeojson = verticesResult.rows[0].geojson;
    
    fs.writeFileSync('bbox-focused-vertices.geojson', JSON.stringify(verticesGeojson, null, 2));
    console.log('  ✅ Exported to bbox-focused-vertices.geojson');
    
  } catch (error) {
    console.log(`  ❌ Error exporting results: ${(error as Error).message}`);
  }
}

testNodeNetworkOnBbox(); 