#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { PgRoutingSeparateTouchingService } from '../src/services/layer1/PgRoutingSeparateTouchingService';
import { loadConfig } from '../src/utils/config-loader';

// Database connection
const client = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: process.env.PGPASSWORD || 'your_password_here'
});

const STAGING_SCHEMA = 'test_separate_touching_simple_1234567890';

async function testSeparateTouchingSimple() {
  console.log('🧪 Testing pgr_separateTouching with temporary table approach...');
  
  try {
    // Load configuration
    const config = loadConfig();
    const toleranceMeters = 1.0; // Use smaller tolerance to avoid errors
    
    console.log(`🎯 Using tolerance: ${toleranceMeters}m`);
    
    // Create fresh staging schema for testing
    console.log(`📋 Creating fresh staging schema: ${STAGING_SCHEMA}`);
    
    // Drop and recreate schema
    await client.query(`DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${STAGING_SCHEMA}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails (
        id SERIAL PRIMARY KEY,
        old_id INTEGER,
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
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        osm_id TEXT
      )
    `);
    
    // Copy trails from an earlier schema that has Enchanted trails
    await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails (
        id, old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      )
      SELECT 
        id, id as old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      FROM carthorse_1755276930452.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      LIMIT 20
    `);
    
    const trailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCountResult.rows[0].count} test trails`);
    
    // Debug: Check what trails we have
    const trailDetailsResult = await client.query(`
      SELECT id, name, ST_Length(geometry::geography) as length_meters, 
             ST_IsValid(geometry) as is_valid, ST_GeometryType(geometry) as geom_type
      FROM ${STAGING_SCHEMA}.trails 
      WHERE name ILIKE '%Enchanted%'
      ORDER BY id
    `);
    console.log('\n📋 Enchanted trail details before processing:');
    trailDetailsResult.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.name} - ${row.length_meters.toFixed(1)}m (valid: ${row.is_valid}, type: ${row.geom_type})`);
    });
    
    // Create the separate touching service
    const separateTouchingService = new PgRoutingSeparateTouchingService({
      stagingSchema: STAGING_SCHEMA,
      pgClient: client,
      toleranceMeters: toleranceMeters,
      verbose: true
    });
    
    // Apply separate touching (this will create trails_split_results table)
    console.log('🔍 Applying pgr_separateTouching...');
    const result = await separateTouchingService.separateTouchingTrailsAndReplace();
    
    if (result.success) {
      console.log('✅ Separate touching completed successfully!');
      console.log(`📊 Results:`);
      console.log(`   - Original trails: ${result.originalTrails}`);
      console.log(`   - Trails split: ${result.splitTrails}`);
      console.log(`   - Total segments: ${result.totalSegments}`);
      
      // Export the results for visualization
      console.log('\n📤 Exporting results for visualization...');
      await exportResults();
      
    } else {
      console.log(`❌ Separate touching failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  } finally {
    // Don't cleanup - keep schema for debugging
    console.log(`🔍 Keeping schema ${STAGING_SCHEMA} for debugging`);
    await client.end();
  }
}

async function exportResults() {
  try {
    const fs = require('fs');
    
    // Get all trails from the temporary results table
    const result = await client.query(`
      SELECT 
        original_id,
        sub_id,
        osm_id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
      FROM ${STAGING_SCHEMA}.trails_split_results
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      ORDER BY original_id, sub_id
    `);
    
    console.log(`📊 Found ${result.rows.length} trails in temporary results`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          original_id: row.original_id,
          sub_id: row.sub_id,
          osm_id: row.osm_id,
          name: row.name,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          is_split: row.sub_id > 1 ? 'Yes' : 'No'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    // Write to file
    const outputFile = 'test-output/simple-separate-touching-results.geojson';
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${outputFile}`);
    
    // Show summary
    const originalTrails = new Set(result.rows.map(r => r.original_id).filter(id => id !== null));
    const splitTrails = result.rows.filter(r => r.sub_id > 1).length;
    const unsplitTrails = result.rows.filter(r => r.sub_id === 1).length;
    
    console.log('\n📋 Summary:');
    console.log(`   - Total segments: ${result.rows.length}`);
    console.log(`   - Original trail IDs: ${originalTrails.size}`);
    console.log(`   - Split segments: ${splitTrails}`);
    console.log(`   - Unsplit trails: ${unsplitTrails}`);
    
    // Check for Enchanted trails specifically
    const enchantedTrails = result.rows.filter(r => r.name && r.name.toLowerCase().includes('enchanted'));
    console.log(`\n🔮 Enchanted trails found: ${enchantedTrails.length}`);
    enchantedTrails.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.original_id}, sub: ${row.sub_id}) - ${row.length_km.toFixed(2)}km`);
    });
    
  } catch (error) {
    console.error('❌ Error exporting results:', error);
  }
}

// Run the test
testSeparateTouchingSimple().catch(console.error);
