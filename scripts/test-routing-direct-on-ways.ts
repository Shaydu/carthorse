#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';
import { createLoopSplittingHelpers } from '../src/utils/loop-splitting-helpers';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

const STAGING_SCHEMA = 'staging_boulder_test_direct_routing';

async function testRoutingDirectOnWays() {
  try {
    await client.connect();
    console.log('🔧 Testing routing directly on ways table (skipping pgr_nodeNetwork)...');

    // Step 1: Create staging environment
    console.log('\n📊 Step 1: Creating staging environment...');
    await createStagingEnvironment();

    // Step 2: Copy region data to staging
    console.log('\n📊 Step 2: Copying region data to staging...');
    await copyRegionDataToStaging();

    // Step 3: Apply improved loop splitting
    console.log('\n📊 Step 3: Applying improved loop splitting...');
    const loopSplittingHelpers = createLoopSplittingHelpers(STAGING_SCHEMA, client, 2.0);
    const loopResult = await loopSplittingHelpers.splitLoopTrails();
    
    if (!loopResult.success) {
      throw new Error(`Loop splitting failed: ${loopResult.error}`);
    }
    
    console.log(`✅ Loop splitting completed: ${loopResult.loopCount} loops, ${loopResult.splitSegments} segments`);

    // Step 4: Replace loop trails with split segments
    console.log('\n📊 Step 4: Replacing loop trails with split segments...');
    const replaceResult = await loopSplittingHelpers.replaceLoopTrailsWithSegments();
    
    if (!replaceResult.success) {
      throw new Error(`Loop replacement failed: ${replaceResult.error}`);
    }

    // Step 5: Create pgRouting tables (ways only, no noded)
    console.log('\n📊 Step 5: Creating ways table (no pgr_nodeNetwork)...');
    await createWaysTableOnly();

    // Step 6: Test routing directly on ways table
    console.log('\n📊 Step 6: Testing routing directly on ways table...');
    await testRoutingOnWaysTable();

    // Step 7: Generate export
    console.log('\n📊 Step 7: Generating export...');
    await generateDirectRoutingExport();

    console.log('\n✅ Direct routing test finished successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function createStagingEnvironment() {
  // Drop existing staging schema
  await client.query(`DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE`);
  
  // Create new staging schema
  await client.query(`CREATE SCHEMA ${STAGING_SCHEMA}`);
  
  // Create trails table with 3D geometry support
  await client.query(`
    CREATE TABLE ${STAGING_SCHEMA}.trails (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL,
      name TEXT,
      trail_type TEXT,
      surface TEXT,
      difficulty TEXT,
      source_tags JSONB,
      osm_id TEXT,
      region TEXT,
      length_km DOUBLE PRECISION,
      elevation_gain DOUBLE PRECISION,
      elevation_loss DOUBLE PRECISION,
      max_elevation DOUBLE PRECISION,
      min_elevation DOUBLE PRECISION,
      avg_elevation DOUBLE PRECISION,
      geometry GEOMETRY(LINESTRINGZ, 4326),
      bbox_min_lng DOUBLE PRECISION,
      bbox_max_lng DOUBLE PRECISION,
      bbox_min_lat DOUBLE PRECISION,
      bbox_max_lat DOUBLE PRECISION,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ Staging environment created');
}

// Update bbox to user-provided values
const bbox = [
  -105.33917192801866, // minLng (west)
  39.95803339005218,   // minLat (south)
  -105.2681945500977,  // maxLng (east)
  40.0288146943966     // maxLat (north)
];

async function copyRegionDataToStaging() {
  // Copy trails from public to staging with user-provided bbox
  await client.query(`
    INSERT INTO ${STAGING_SCHEMA}.trails (
      app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id, region,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    )
    SELECT 
      app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id, region,
      length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
      ST_Force3D(geometry), bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    FROM public.trails
    WHERE geometry IS NOT NULL
    AND bbox_min_lng >= ${bbox[0]}
    AND bbox_max_lng <= ${bbox[2]}
    AND bbox_min_lat >= ${bbox[1]}
    AND bbox_max_lat <= ${bbox[3]}
  `);

  const result = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
  console.log(`✅ Copied ${result.rows[0].count} trails to staging`);
}

async function createWaysTableOnly() {
  // Create ways table directly from trails (no pgr_nodeNetwork)
  await client.query(`
    CREATE TABLE ${STAGING_SCHEMA}.ways AS
    SELECT 
      id,
      app_uuid as trail_uuid,
      name,
      length_km,
      elevation_gain,
      elevation_loss,
      geometry as the_geom
    FROM ${STAGING_SCHEMA}.trails
    WHERE geometry IS NOT NULL
  `);

  // Add source/target columns (we'll need to create these manually)
  await client.query(`
    ALTER TABLE ${STAGING_SCHEMA}.ways 
    ADD COLUMN source INTEGER,
    ADD COLUMN target INTEGER
  `);

  console.log('✅ Created ways table (no pgr_nodeNetwork)');
}

async function testRoutingOnWaysTable() {
  try {
    console.log('  Testing routing directly on ways table...');

    // First, let's see what we have
    const waysStats = await client.query(`
      SELECT COUNT(*) as total_ways FROM ${STAGING_SCHEMA}.ways
    `);
    
    console.log(`  📊 Total ways: ${waysStats.rows[0].total_ways}`);

    // Check if we have any valid geometries
    const validGeoms = await client.query(`
      SELECT COUNT(*) as valid_count 
      FROM ${STAGING_SCHEMA}.ways 
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    
    console.log(`  📊 Valid geometries: ${validGeoms.rows[0].valid_count}`);

    // Show some sample ways
    const sampleWays = await client.query(`
      SELECT id, name, length_km, ST_Length(the_geom::geography) as geom_length_m
      FROM ${STAGING_SCHEMA}.ways 
      WHERE the_geom IS NOT NULL 
      ORDER BY RANDOM() 
      LIMIT 5
    `);
    
    console.log('  📋 Sample ways:');
    sampleWays.rows.forEach(way => {
      console.log(`    Way ${way.id}: ${way.name} (${way.length_km}km, ${way.geom_length_m.toFixed(1)}m)`);
    });

    // Note: Without pgr_nodeNetwork, we don't have proper source/target relationships
    // This is just to show what the original ways look like
    console.log('  ⚠️  Note: Without pgr_nodeNetwork, we lack proper source/target relationships for routing');

  } catch (error) {
    console.error('  ❌ Routing test failed:', error);
  }
}

async function generateDirectRoutingExport() {
  console.log('  Generating direct routing export...');

  // Export the original ways (before pgr_nodeNetwork)
  const waysQuery = `
    SELECT 
      json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(feature)
      ) as geojson
    FROM (
      SELECT 
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(
            'type', 'original_way',
            'id', id,
            'name', name,
            'trail_uuid', trail_uuid,
            'length_km', length_km,
            'elevation_gain', elevation_gain,
            'color', '#0066cc',
            'weight', 3,
            'opacity', 0.8
          ),
          'geometry', ST_AsGeoJSON(the_geom)::json
        ) as feature
      FROM ${STAGING_SCHEMA}.ways
      WHERE the_geom IS NOT NULL
    ) features
  `;
  
  const waysResult = await client.query(waysQuery);
  if (waysResult.rows[0].geojson) {
    fs.writeFileSync('direct-routing-ways.geojson', JSON.stringify(waysResult.rows[0].geojson, null, 2));
    console.log('  ✅ Exported original ways to direct-routing-ways.geojson');
  }

  // Export statistics
  const statsQuery = `
    SELECT 
      COUNT(*) as total_ways,
      SUM(length_km) as total_length_km,
      AVG(length_km) as avg_length_km,
      COUNT(CASE WHEN elevation_gain > 0 THEN 1 END) as ways_with_elevation
    FROM ${STAGING_SCHEMA}.ways
  `;
  
  const statsResult = await client.query(statsQuery);
  const stats = statsResult.rows[0];
  
  const statsReport = {
    direct_routing_summary: {
      total_ways: stats.total_ways,
      total_length_km: stats.total_length_km,
      avg_length_km: stats.avg_length_km,
      ways_with_elevation: stats.ways_with_elevation
    },
    note: "This export shows original ways before pgr_nodeNetwork processing"
  };
  
  fs.writeFileSync('direct-routing-statistics.json', JSON.stringify(statsReport, null, 2));
  console.log('  ✅ Exported direct routing statistics to direct-routing-statistics.json');
  console.log(`  📊 Direct Routing Summary: ${stats.total_ways} ways, ${stats.total_length_km.toFixed(1)}km total`);
}

testRoutingDirectOnWays(); 