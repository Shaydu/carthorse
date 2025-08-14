#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { PgRoutingSplittingService } from '../src/services/layer1/PgRoutingSplittingService';
import * as fs from 'fs';
import * as path from 'path';

const client = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
  properties: {
    id: string;
    name: string;
    original_trail_uuid: string;
    length_km: number;
    segment_id: number;
    intersection_type?: string;
    [key: string]: any;
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function testPgRoutingSplittingWithGeoJSONExport() {
  try {
    await client.connect();
    console.log('🔗 Testing PgRoutingSplittingService with GeoJSON export...');

    const stagingSchema = 'test_pgrouting_splitting_geojson';
    const outputDir = 'test-output/pgrouting-splitting';
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create test staging schema
    await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    await client.query(`CREATE SCHEMA ${stagingSchema}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        region TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB
      )
    `);

    // Create intersection_points table
    await client.query(`
      CREATE TABLE ${stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters DOUBLE PRECISION
      )
    `);

    // Copy test data from production - focus on areas with known intersections
    console.log('📋 Copying test data from production...');
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, geometry, length_km, 
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      )
      SELECT 
        app_uuid, name, region, geometry, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      FROM trails 
      WHERE region = 'boulder' 
        AND ST_Intersects(geometry, ST_MakeEnvelope(-105.3, 40.0, -105.2, 40.1, 4326))
      LIMIT 100
    `);

    const initialCountResult = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    const initialCount = parseInt(initialCountResult.rows[0].count);
    console.log(`📊 Loaded ${initialCount} test trails in Boulder area`);

    // Export original trails to GeoJSON
    console.log('\n📤 Exporting original trails to GeoJSON...');
    const originalGeoJSON = await exportTrailsToGeoJSON(stagingSchema, 'original');
    fs.writeFileSync(path.join(outputDir, '01-original-trails.geojson'), JSON.stringify(originalGeoJSON, null, 2));
    console.log(`✅ Exported ${originalGeoJSON.features.length} original trails`);

    // Test 1: Modern PostGIS ST_Node() approach
    console.log('\n🧪 Test 1: Modern PostGIS ST_Node() approach');
    const postgisSplittingService = new PgRoutingSplittingService({
      stagingSchema,
      pgClient: client,
      toleranceMeters: 0.00001,
      minSegmentLengthMeters: 1.0,
      preserveOriginalTrails: true
    });

    const postgisResult = await postgisSplittingService.splitTrailsAtIntersections();
    console.log('✅ PostGIS ST_Node() splitting completed:');
    console.log(`   📊 Original trails: ${postgisResult.originalTrailCount}`);
    console.log(`   🔗 Split segments: ${postgisResult.splitSegmentCount}`);
    console.log(`   📍 Intersection points: ${postgisResult.intersectionPointsFound}`);

    // Export PostGIS split trails to GeoJSON
    console.log('\n📤 Exporting PostGIS split trails to GeoJSON...');
    const postgisGeoJSON = await exportTrailsToGeoJSON(stagingSchema, 'postgis-split');
    fs.writeFileSync(path.join(outputDir, '02-postgis-split-trails.geojson'), JSON.stringify(postgisGeoJSON, null, 2));
    console.log(`✅ Exported ${postgisGeoJSON.features.length} PostGIS split segments`);

    // Export intersection points to GeoJSON
    console.log('\n📤 Exporting intersection points to GeoJSON...');
    const intersectionPointsGeoJSON = await exportIntersectionPointsToGeoJSON(stagingSchema);
    fs.writeFileSync(path.join(outputDir, '03-intersection-points.geojson'), JSON.stringify(intersectionPointsGeoJSON, null, 2));
    console.log(`✅ Exported ${intersectionPointsGeoJSON.features.length} intersection points`);

    // Test 2: Modern pgRouting functions approach
    console.log('\n🧪 Test 2: Modern pgRouting functions approach');
    
    // Reset trails table for second test
    await client.query(`DROP TABLE ${stagingSchema}.trails`);
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, geometry, length_km, 
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      )
      SELECT 
        app_uuid, name, region, geometry, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags
      FROM trails 
      WHERE region = 'boulder' 
        AND ST_Intersects(geometry, ST_MakeEnvelope(-105.3, 40.0, -105.2, 40.1, 4326))
      LIMIT 100
    `);

    const pgroutingResult = await postgisSplittingService.splitTrailsWithPgRouting();
    console.log('✅ pgRouting functions splitting completed:');
    console.log(`   📊 Original trails: ${pgroutingResult.originalTrailCount}`);
    console.log(`   🔗 Split segments: ${pgroutingResult.splitSegmentCount}`);
    console.log(`   📍 Intersection points: ${pgroutingResult.intersectionPointsFound}`);

    // Export pgRouting split trails to GeoJSON
    console.log('\n📤 Exporting pgRouting split trails to GeoJSON...');
    const pgroutingGeoJSON = await exportTrailsToGeoJSON(stagingSchema, 'pgrouting-split');
    fs.writeFileSync(path.join(outputDir, '04-pgrouting-split-trails.geojson'), JSON.stringify(pgroutingGeoJSON, null, 2));
    console.log(`✅ Exported ${pgroutingGeoJSON.features.length} pgRouting split segments`);

    // Get detailed statistics
    console.log('\n📊 Detailed Statistics:');
    const stats = await postgisSplittingService.getSplitStatistics();
    console.log('✅ Split statistics:');
    console.log(`   📊 Total segments: ${stats.total_segments}`);
    console.log(`   🛤️ Original trails: ${stats.original_trails}`);
    console.log(`   📏 Average length: ${parseFloat(stats.avg_length_km).toFixed(3)}km`);
    console.log(`   📏 Min length: ${parseFloat(stats.min_length_km).toFixed(3)}km`);
    console.log(`   📏 Max length: ${parseFloat(stats.max_length_km).toFixed(3)}km`);
    console.log(`   📏 Total length: ${parseFloat(stats.total_length_km).toFixed(3)}km`);

    // Compare results
    console.log('\n📊 Comparison Results:');
    console.log(`   PostGIS ST_Node(): ${postgisResult.splitSegmentCount} segments`);
    console.log(`   pgRouting functions: ${pgroutingResult.splitSegmentCount} segments`);
    console.log(`   Difference: ${Math.abs(postgisResult.splitSegmentCount - pgroutingResult.splitSegmentCount)} segments`);

    // Create summary report
    const summaryReport = {
      testDate: new Date().toISOString(),
      stagingSchema,
      originalTrailCount: initialCount,
      postgisResults: {
        splitSegments: postgisResult.splitSegmentCount,
        intersectionPoints: postgisResult.intersectionPointsFound,
        segmentsRemoved: postgisResult.segmentsRemoved
      },
      pgroutingResults: {
        splitSegments: pgroutingResult.splitSegmentCount,
        intersectionPoints: pgroutingResult.intersectionPointsFound,
        segmentsRemoved: pgroutingResult.segmentsRemoved
      },
      statistics: stats,
      outputFiles: [
        '01-original-trails.geojson',
        '02-postgis-split-trails.geojson',
        '03-intersection-points.geojson',
        '04-pgrouting-split-trails.geojson'
      ]
    };

    fs.writeFileSync(path.join(outputDir, 'summary-report.json'), JSON.stringify(summaryReport, null, 2));
    console.log(`\n📄 Summary report saved to: ${path.join(outputDir, 'summary-report.json')}`);

    console.log('\n✅ PgRoutingSplittingService GeoJSON export tests completed successfully!');
    console.log(`📁 All GeoJSON files saved to: ${outputDir}`);
    console.log('\n🔍 To verify intersection splitting:');
    console.log('   1. Open the GeoJSON files in a GIS viewer (QGIS, Mapbox, etc.)');
    console.log('   2. Compare original vs split trails');
    console.log('   3. Check intersection points overlay with trail endpoints');
    console.log('   4. Verify X, Y, and T intersections are properly split');

  } catch (error) {
    console.error('❌ Error during PgRoutingSplittingService GeoJSON export tests:', error);
  } finally {
    await client.end();
  }
}

async function exportTrailsToGeoJSON(stagingSchema: string, prefix: string): Promise<GeoJSONCollection> {
  const result = await client.query(`
    SELECT 
      app_uuid,
      name,
      original_app_uuid,
      id as segment_id,
      length_km,
      ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
    FROM ${stagingSchema}.trails
    WHERE ST_IsValid(geometry) 
      AND ST_GeometryType(geometry) = 'ST_LineString'
    ORDER BY original_app_uuid, segment_id
  `);

  const features: GeoJSONFeature[] = result.rows.map(row => {
    const geometry = JSON.parse(row.geometry_json);
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: geometry.coordinates
      },
      properties: {
        id: row.app_uuid,
        name: row.name || 'Unnamed Trail',
        original_trail_uuid: row.original_app_uuid,
        length_km: parseFloat(row.length_km),
        segment_id: row.segment_id,
        intersection_type: prefix.includes('split') ? 'split_segment' : 'original_trail'
      }
    };
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

async function exportIntersectionPointsToGeoJSON(stagingSchema: string): Promise<GeoJSONCollection> {
  const result = await client.query(`
    SELECT 
      id,
      node_type,
      connected_trail_names,
      distance_meters,
      ST_AsGeoJSON(ST_Force2D(point)) as geometry_json
    FROM ${stagingSchema}.intersection_points
    WHERE point IS NOT NULL
    ORDER BY id
  `);

  const features: GeoJSONFeature[] = result.rows.map(row => {
    const geometry = JSON.parse(row.geometry_json);
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [geometry.coordinates, geometry.coordinates] // Convert point to tiny line for visibility
      },
      properties: {
        id: `intersection_${row.id}`,
        name: `Intersection ${row.id}`,
        node_type: row.node_type,
        connected_trails: row.connected_trail_names,
        distance_meters: parseFloat(row.distance_meters),
        intersection_type: 'intersection_point'
      }
    };
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

// Run the test
testPgRoutingSplittingWithGeoJSONExport().catch(console.error);
