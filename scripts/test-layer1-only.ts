#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { getDatabaseConfig } from '../src/utils/config-loader';

async function testLayer1Only() {
  const dbConfig = getDatabaseConfig();
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    await pgClient.connect();
    console.log('🔍 Testing Layer 1 processing...');

    // Create a test staging schema
    const stagingSchema = `test_layer1_${Date.now()}`;
    console.log(`📁 Creating staging schema: ${stagingSchema}`);
    
    await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${stagingSchema}`);

    // Create basic staging tables
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        region TEXT,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION
      )
    `);

    // Step 1: Copy trail data with bbox filter
    console.log('📊 Copying trail data...');
    const insertResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation, region,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      )
      SELECT
        app_uuid::text, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation, region,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM public.trails
      WHERE geometry IS NOT NULL 
        AND region = 'boulder'
        AND source = 'cotrex'
    `);
    
    console.log(`✅ Copied ${insertResult.rowCount} trails`);

    // Step 2: Clean up trails
    console.log('🧹 Cleaning up trails...');
    
    // Remove invalid geometries
    const invalidResult = await pgClient.query(`
      DELETE FROM ${stagingSchema}.trails 
      WHERE geometry IS NULL OR NOT ST_IsValid(geometry)
    `);
    console.log(`   🗑️ Removed ${invalidResult.rowCount} trails with invalid geometries`);

    // Remove short trails
    const shortResult = await pgClient.query(`
      DELETE FROM ${stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < 0.1
    `);
    console.log(`   🗑️ Removed ${shortResult.rowCount} trails shorter than 0.1m`);

    // Remove zero length trails
    const zeroResult = await pgClient.query(`
      DELETE FROM ${stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) = 0
    `);
    console.log(`   🗑️ Removed ${zeroResult.rowCount} trails with zero length`);

    // Get final count
    const finalCountResult = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    const finalCount = parseInt(finalCountResult.rows[0].count);
    console.log(`   📊 Final trail count: ${finalCount}`);

    // Step 3: Check for geometry issues
    console.log('🔍 Checking for geometry issues...');
    const geometryIssues = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_GeometryType(geometry) as geometry_type,
        ST_IsValid(geometry) as is_valid,
        ST_IsSimple(geometry) as is_simple,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE NOT ST_IsValid(geometry) OR NOT ST_IsSimple(geometry)
      ORDER BY length_meters DESC
    `);

    console.log(`📊 Found ${geometryIssues.rows.length} trails with geometry issues:`);
    geometryIssues.rows.forEach((row, index) => {
      console.log(`${index + 1}. Trail ID: ${row.id}, Name: "${row.name}", Type: ${row.geometry_type}, Valid: ${row.is_valid}, Simple: ${row.is_simple}, Length: ${row.length_meters?.toFixed(1)}m`);
    });

    // Export to GeoJSON for inspection
    console.log('📤 Exporting Layer 1 results to GeoJSON...');
    const geojsonResult = await pgClient.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geometry)::json,
              'properties', json_build_object(
                'id', id,
                'name', name,
                'trail_type', trail_type,
                'surface', surface,
                'difficulty', difficulty,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'elevation_loss', elevation_loss
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.trails
    `);

    const fs = require('fs');
    const outputPath = '/Users/shaydu/dev/carthorse/test-output/boulder-layer1-test.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojsonResult.rows[0].geojson, null, 2));
    console.log(`✅ Layer 1 results exported to: ${outputPath}`);

    console.log('✅ Layer 1 processing test completed successfully!');

  } catch (error) {
    console.error('❌ Layer 1 test failed:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  testLayer1Only().catch(console.error);
}
