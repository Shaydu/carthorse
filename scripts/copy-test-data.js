#!/usr/bin/env node

const { Client } = require('pg');

async function copyTestData() {
  console.log('🗺️  Copying Boulder Valley Ranch test data...');
  
  // Connect to main database to get data
  const mainClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD || ''
  });
  
  // Connect to test database
  const testClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || ''
  });
  
  try {
    await mainClient.connect();
    await testClient.connect();
    
    console.log('📝 Getting Boulder Valley Ranch trails from main database...');
    const trailsResult = await mainClient.query(`
      SELECT 
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, source_tags, created_at, updated_at
      FROM trails 
      WHERE region = 'boulder_valley_ranch_test'
    `);
    
    const trails = trailsResult.rows;
    console.log(`📍 Found ${trails.length} trails in Boulder Valley Ranch area`);
    
    if (trails.length === 0) {
      console.log('⚠️  No trails found in Boulder Valley Ranch area');
      return;
    }
    
    // Clear existing test data
    console.log('🧹 Clearing existing test data...');
    await testClient.query('DELETE FROM trails WHERE region = $1', ['boulder_valley_ranch_test']);
    
    // Add the test region
    console.log('📝 Adding test region...');
    await testClient.query(`
      INSERT INTO regions (region_key, name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (region_key) DO UPDATE SET
        name = EXCLUDED.name,
        bbox_min_lng = EXCLUDED.bbox_min_lng,
        bbox_max_lng = EXCLUDED.bbox_max_lng,
        bbox_min_lat = EXCLUDED.bbox_min_lat,
        bbox_max_lat = EXCLUDED.bbox_max_lat
    `, [
      'boulder_valley_ranch_test',
      'Boulder Valley Ranch Test',
      -105.28122955793897,
      -105.23604178494656,
      40.068313334562816,
      40.098317098641445
    ]);
    
    // Insert trails
    console.log('📝 Inserting trails...');
    let insertedCount = 0;
    
    for (const trail of trails) {
      // Create a new app_uuid for test data
      const testAppUuid = `bvr_test_${trail.app_uuid}`;
      
      await testClient.query(`
        INSERT INTO trails (
          app_uuid, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          geometry, source_tags, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, NOW(), NOW()
        )
      `, [
        testAppUuid, // app_uuid
        trail.name, // name
        'boulder_valley_ranch_test', // region
        trail.trail_type, // trail_type
        trail.surface, // surface
        trail.difficulty, // difficulty
        trail.length_km, // length_km
        trail.elevation_gain, // elevation_gain
        trail.elevation_loss, // elevation_loss
        trail.max_elevation, // max_elevation
        trail.min_elevation, // min_elevation
        trail.avg_elevation, // avg_elevation
        trail.geometry, // geometry
        JSON.stringify({ 
          test_data: true, 
          original_app_uuid: trail.app_uuid,
          imported_from: 'boulder_valley_ranch_test'
        }) // source_tags
      ]);
      
      insertedCount++;
      
      if (insertedCount % 10 === 0) {
        console.log(`⏳ Inserted ${insertedCount}/${trails.length} trails...`);
      }
    }
    
    console.log(`✅ Successfully imported ${insertedCount} trails`);
    
    // Verify the data
    const result = await testClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as trails_with_elevation,
        COUNT(CASE WHEN geometry IS NOT NULL THEN 1 END) as trails_with_geometry,
        ROUND(AVG(length_km)::numeric, 2) as avg_length_km,
        ROUND(AVG(elevation_gain)::numeric, 2) as avg_elevation_gain
      FROM trails 
      WHERE region = 'boulder_valley_ranch_test'
    `);
    
    const stats = result.rows[0];
    console.log('\n📊 Test Data Summary:');
    console.log(`   - Total trails: ${stats.total_trails}`);
    console.log(`   - Trails with elevation: ${stats.trails_with_elevation}`);
    console.log(`   - Trails with geometry: ${stats.trails_with_geometry}`);
    console.log(`   - Average length: ${stats.avg_length_km} km`);
    console.log(`   - Average elevation gain: ${stats.avg_elevation_gain} m`);
    
  } catch (error) {
    console.error('❌ Error copying test data:', error.message);
  } finally {
    await mainClient.end();
    await testClient.end();
  }
}

copyTestData(); 