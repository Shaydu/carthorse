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

const STAGING_SCHEMA = 'test_separate_touching_fixed_1234567890';

async function testSeparateTouching() {
  console.log('🧪 Testing pgr_separateTouching integration...');
  
  try {
    // Load configuration
    const config = loadConfig();
    const toleranceMeters = 1.0; // Use smaller tolerance to avoid linear intersection errors
    
    console.log(`🎯 Using tolerance from config: ${toleranceMeters}m`);
    
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
    
    // Apply separate touching
    console.log('🔍 Applying pgr_separateTouching...');
    const result = await separateTouchingService.separateTouchingTrailsAndReplace();
    
    if (result.success) {
      console.log('✅ Separate touching completed successfully!');
      console.log(`📊 Results:`);
      console.log(`   - Original trails: ${result.originalTrails}`);
      console.log(`   - Trails split: ${result.splitTrails}`);
      console.log(`   - Total segments: ${result.totalSegments}`);
      
      // Show some details about the split trails
      const detailsResult = await client.query(`
        SELECT 
          old_id,
          name,
          ST_Length(geometry::geography) as length_meters,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM ${STAGING_SCHEMA}.trails
        ORDER BY old_id, id
      `);
      
      console.log('\n📋 Split trail details:');
      detailsResult.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ${row.name} (ID: ${row.old_id}) - ${row.length_meters.toFixed(1)}m`);
        console.log(`      Start: ${row.start_point}`);
        console.log(`      End: ${row.end_point}`);
      });
      
    } else {
      console.log(`❌ Separate touching failed: ${result.error}`);
    }
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  } finally {
    // Don't cleanup - this is a production schema
    console.log(`🔍 Using production schema ${STAGING_SCHEMA} - no cleanup needed`);
    await client.end();
  }
}

// Run the test
testSeparateTouching().catch(console.error);
