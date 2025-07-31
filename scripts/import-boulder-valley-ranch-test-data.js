#!/usr/bin/env node

const { Client } = require('pg');

// Boulder Valley Ranch test data import script
async function importBoulderValleyRanchTestData() {
  console.log('🗺️  Importing Boulder Valley Ranch test data...');
  
  // Boulder Valley Ranch bbox coordinates from the provided polygon
  const BOULDER_VALLEY_BBOX = {
    minLat: 40.068313334562816,
    maxLat: 40.098317098641445,
    minLng: -105.28122955793897,
    maxLng: -105.23604178494656
  };
  
  // Connect to PostgreSQL
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Clear existing test data
    console.log('🧹 Clearing existing test data...');
    await client.query('DELETE FROM trails WHERE region = $1', ['boulder_valley_ranch_test']);
    
    // Add the test region to the regions table
    console.log('📝 Adding test region...');
    await client.query(`
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
      BOULDER_VALLEY_BBOX.minLng,
      BOULDER_VALLEY_BBOX.maxLng,
      BOULDER_VALLEY_BBOX.minLat,
      BOULDER_VALLEY_BBOX.maxLat
    ]);
    
    // Extract trails from the existing Boulder Valley Ranch area in the database
    console.log('📝 Extracting trails from Boulder Valley Ranch area...');
    const trailsResult = await client.query(`
      SELECT 
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry, source_tags, created_at, updated_at
      FROM trail_master_db.trails 
      WHERE region = 'boulder_valley_ranch_test'
    `);
    
    const trails = trailsResult.rows;
    console.log(`📍 Found ${trails.length} trails in Boulder Valley Ranch area`);
    
    if (trails.length === 0) {
      console.log('⚠️  No trails found in Boulder Valley Ranch area');
      console.log('💡 Make sure you have Boulder Valley Ranch trails in the main database');
      return;
    }
    
    // Insert trails as test data
    console.log('📝 Inserting trails as test data...');
    let insertedCount = 0;
    
    for (const trail of trails) {
      // Create a new app_uuid for test data
      const testAppUuid = `bvr_test_${trail.app_uuid}`;
      
      await client.query(`
        INSERT INTO trails (
          app_uuid, name, region, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          geometry, source_tags, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          ST_GeomFromText($13, 4326), $14, NOW(), NOW()
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
          source: 'boulder_valley_ranch',
          original_app_uuid: trail.app_uuid 
        }) // source_tags
      ]);
      
      insertedCount++;
      
      if (insertedCount % 10 === 0) {
        console.log(`⏳ Inserted ${insertedCount}/${trails.length} trails...`);
      }
    }
    
    console.log(`✅ Successfully inserted ${insertedCount} trails`);
    
    // Verify the data
    const result = await client.query(`
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
    
    // Check for intersection types
    const intersectionResult = await client.query(`
      SELECT 
        COUNT(*) as total_intersections,
        COUNT(CASE WHEN ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point' THEN 1 END) as point_intersections,
        COUNT(CASE WHEN ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_MultiPoint' THEN 1 END) as multipoint_intersections
      FROM trails t1
      JOIN trails t2 ON t1.id < t2.id
      WHERE t1.region = 'boulder_valley_ranch_test' 
      AND t2.region = 'boulder_valley_ranch_test'
      AND ST_Intersects(t1.geometry, t2.geometry)
    `);
    
    const intersectionStats = intersectionResult.rows[0];
    console.log(`   - Total intersections: ${intersectionStats.total_intersections}`);
    console.log(`   - Point intersections: ${intersectionStats.point_intersections}`);
    console.log(`   - Multi-point intersections: ${intersectionStats.multipoint_intersections}`);
    
    console.log('\n🎉 Boulder Valley Ranch test data imported successfully!');
    console.log('💡 You can now run tests with: npm test');
    
  } catch (error) {
    console.error('❌ Error importing test data:', error);
  } finally {
    await client.end();
  }
}

// Run the import if this script is executed directly
if (require.main === module) {
  importBoulderValleyRanchTestData().catch(console.error);
}

module.exports = { importBoulderValleyRanchTestData };