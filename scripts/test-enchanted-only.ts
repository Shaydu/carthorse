#!/usr/bin/env ts-node

import { Pool } from 'pg';

// Database connection
const client = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: process.env.PGPASSWORD || 'your_password_here'
});

const STAGING_SCHEMA = 'test_enchanted_only_1234567890';

async function testEnchantedOnly() {
  console.log('🧪 Testing geometry simplification + pgr_separateTouching on real Enchanted data...');
  
  try {
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
    
    // Copy ONLY the Enchanted trails from the real data
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
      FROM carthorse_1755292522137.trails
      WHERE name ILIKE '%enchanted%'
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
    `);
    
    const trailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCountResult.rows[0].count} Enchanted trails`);
    
    // Show what we have
    const trailDetailsResult = await client.query(`
      SELECT id, name, ST_Length(geometry::geography) as length_meters, 
             ST_NumPoints(geometry) as num_points,
             ST_IsValid(geometry) as is_valid, ST_GeometryType(geometry) as geom_type
      FROM ${STAGING_SCHEMA}.trails 
      ORDER BY name, id
    `);
    console.log('\n📋 Enchanted trail details before processing:');
    trailDetailsResult.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid}, type: ${row.geom_type})`);
    });
    
    // Step 1: Apply geometry simplification (same as in our service)
    console.log('\n🔧 Step 1: Applying geometry simplification...');
    const simplifyResult = await client.query(`
      UPDATE ${STAGING_SCHEMA}.trails 
      SET geometry = ST_Simplify(geometry, 0.00001)  -- ~1 meter tolerance
      WHERE ST_IsValid(geometry) 
        AND ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_NumPoints(geometry) > 2
    `);
    console.log(`✅ Simplified ${simplifyResult.rowCount} trails`);
    
    // Check simplification results
    const afterSimplifyResult = await client.query(`
      SELECT id, name, ST_Length(geometry::geography) as length_meters, 
             ST_NumPoints(geometry) as num_points,
             ST_IsValid(geometry) as is_valid
      FROM ${STAGING_SCHEMA}.trails 
      ORDER BY name, id
    `);
    console.log('\n📋 After simplification:');
    afterSimplifyResult.rows.forEach(row => {
      console.log(`   ID ${row.id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid})`);
    });
    
    // Step 2: Create temporary table for pgr_separateTouching results
    console.log('\n📋 Step 2: Creating temporary table for results...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_split_results (
        original_id INTEGER,
        sub_id INTEGER,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
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
        source_tags JSONB,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Step 3: Apply pgr_separateTouching with very small tolerance
    console.log('\n🔍 Step 3: Applying pgr_separateTouching with very small tolerance...');
    const toleranceDegrees = 0.0000001; // Very small tolerance to catch the close trails
    
    try {
      const separateResult = await client.query(`
        INSERT INTO ${STAGING_SCHEMA}.trails_split_results (
          original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry
        )
        SELECT 
          s.id as original_id,
          s.sub_id,
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.bbox_min_lng,
          t.bbox_max_lng,
          t.bbox_min_lat,
          t.bbox_max_lat,
          t.source,
          t.source_tags,
          ST_Force3D(s.geom) as geometry
        FROM pgr_separateTouching(
          'SELECT id, ST_Force2D(geometry) as geom FROM ${STAGING_SCHEMA}.trails',
          ${toleranceDegrees}
        ) s
        JOIN ${STAGING_SCHEMA}.trails t ON t.id = s.id
        WHERE ST_IsValid(s.geom)
          AND ST_Length(s.geom::geography) > 10  -- Minimum 10 meters to avoid artifacts
          AND ST_Length(s.geom::geography) > 10  -- Minimum 10 meters to avoid artifacts
      `);
      
      console.log(`✅ pgr_separateTouching completed: ${separateResult.rowCount} segments created`);
      
    } catch (error) {
      console.log(`❌ pgr_separateTouching failed: ${(error as Error).message}`);
      
      // Try with smaller tolerance
      console.log('\n🔄 Trying with smaller tolerance (0.5m)...');
      const smallerToleranceDegrees = 0.000004491555874955085; // ~0.5 meter
      
      try {
        const separateResult2 = await client.query(`
          INSERT INTO ${STAGING_SCHEMA}.trails_split_results (
            original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry
          )
          SELECT 
            t.id as original_id,
            row_number() OVER (PARTITION BY t.id ORDER BY sub_id) as sub_id,
            t.osm_id,
            t.name,
            t.region,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.max_elevation,
            t.min_elevation,
            t.avg_elevation,
            t.bbox_min_lng,
            t.bbox_max_lng,
            t.bbox_min_lat,
            t.bbox_max_lat,
            t.source,
            t.source_tags,
            ST_Force3D(geom) as geometry
          FROM ${STAGING_SCHEMA}.trails t
          CROSS JOIN LATERAL pgr_separateTouching(
            'SELECT id, ST_AsText(ST_Force2D(geometry)) as geom FROM ${STAGING_SCHEMA}.trails WHERE id = ' || t.id,
            ${smallerToleranceDegrees}
          ) s
          WHERE ST_IsValid(geom)
        `);
        
        console.log(`✅ pgr_separateTouching with smaller tolerance completed: ${separateResult2.rowCount} segments created`);
        
             } catch (error2) {
         console.log(`❌ pgr_separateTouching with smaller tolerance also failed: ${(error2 as Error).message}`);
         throw error2;
      }
    }
    
    // Step 4: Check results
    const resultsCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_split_results`);
    console.log(`\n📊 Results: ${resultsCount.rows[0].count} segments in trails_split_results`);
    
    // Show detailed results
    const resultsDetails = await client.query(`
      SELECT original_id, sub_id, name, ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points, ST_IsValid(geometry) as is_valid
      FROM ${STAGING_SCHEMA}.trails_split_results
      ORDER BY original_id, sub_id
    `);
    
    console.log('\n📋 Split results:');
    resultsDetails.rows.forEach(row => {
      console.log(`   Original ID ${row.original_id}, Sub ${row.sub_id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid})`);
    });
    
    // Export results for visualization
    console.log('\n📤 Exporting results for visualization...');
    await exportResults();
    
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
    
    console.log(`📊 Found ${result.rows.length} trails in results`);
    
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
    const outputFile = 'test-output/enchanted-only-separate-touching-results.geojson';
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
    
  } catch (error) {
    console.error('❌ Error exporting results:', error);
  }
}

// Run the test
testEnchantedOnly().catch(console.error);
