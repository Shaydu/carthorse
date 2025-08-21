import { Pool } from 'pg';
import { createLoopSplittingHelpers } from '../src/utils/loop-splitting-helpers';

async function testLoopSplittingParentChild() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'carthorse',
    password: process.env.DB_PASSWORD || '',
  });

  const stagingSchema = process.env.STAGING_SCHEMA || 'staging_loop_test_' + Date.now();
  
  try {
    console.log('🧪 Testing loop splitting parent-child relationship...');
    
    // Create test staging schema if it doesn't exist
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Create trails table with original_trail_uuid column
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        original_trail_uuid TEXT,
        osm_id TEXT,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        length_km REAL CHECK(length_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Create index for original_trail_uuid
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_trails_original_uuid ON ${stagingSchema}.trails(original_trail_uuid)
    `);
    
    // Clear existing data
    await pool.query(`DELETE FROM ${stagingSchema}.trails`);
    
    // Insert a test loop trail (Hogback Ridge-like)
    const testLoopTrail = {
      app_uuid: 'hogback-ridge-test-001',
      name: 'Hogback Ridge Test Loop',
      region: 'boulder',
      trail_type: 'hiking',
      surface: 'dirt',
      difficulty: 'moderate',
      length_km: 5.0,
      elevation_gain: 200,
      elevation_loss: 200,
      max_elevation: 2000,
      min_elevation: 1800,
      avg_elevation: 1900,
      geometry: 'LINESTRINGZ(-105.0 40.0 1800, -105.01 40.01 1900, -105.02 40.0 2000, -105.01 39.99 1900, -105.0 40.0 1800)'
    };
    
    await pool.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ST_GeomFromText($13, 4326))
    `, [
      testLoopTrail.app_uuid, testLoopTrail.name, testLoopTrail.region,
      testLoopTrail.trail_type, testLoopTrail.surface, testLoopTrail.difficulty,
      testLoopTrail.length_km, testLoopTrail.elevation_gain, testLoopTrail.elevation_loss,
      testLoopTrail.max_elevation, testLoopTrail.min_elevation, testLoopTrail.avg_elevation,
      testLoopTrail.geometry
    ]);
    
    // Insert a simple trail that intersects with the loop
    const testSimpleTrail = {
      app_uuid: 'simple-trail-test-001',
      name: 'Simple Trail Test',
      region: 'boulder',
      trail_type: 'hiking',
      surface: 'dirt',
      difficulty: 'easy',
      length_km: 2.0,
      elevation_gain: 50,
      elevation_loss: 50,
      max_elevation: 1950,
      min_elevation: 1900,
      avg_elevation: 1925,
      geometry: 'LINESTRINGZ(-105.01 40.0 1900, -105.01 40.01 1950)'
    };
    
    await pool.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ST_GeomFromText($13, 4326))
    `, [
      testSimpleTrail.app_uuid, testSimpleTrail.name, testSimpleTrail.region,
      testSimpleTrail.trail_type, testSimpleTrail.surface, testSimpleTrail.difficulty,
      testSimpleTrail.length_km, testSimpleTrail.elevation_gain, testSimpleTrail.elevation_loss,
      testSimpleTrail.max_elevation, testSimpleTrail.min_elevation, testSimpleTrail.avg_elevation,
      testSimpleTrail.geometry
    ]);
    
    console.log('✅ Test data inserted');
    
    // Get initial count and verify parent exists
    const initialCount = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`📊 Initial trail count: ${initialCount.rows[0].count}`);
    
    const parentExists = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${stagingSchema}.trails 
      WHERE app_uuid = $1
    `, [testLoopTrail.app_uuid]);
    console.log(`📊 Parent trail exists: ${parentExists.rows[0].count > 0}`);
    
    // Debug: Check if our test trail is actually a loop
    const loopCheck = await pool.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance
      FROM ${stagingSchema}.trails 
      WHERE app_uuid = $1
    `, [testLoopTrail.app_uuid]);
    
    console.log('🔍 Loop check:', loopCheck.rows[0]);
    
    // Test loop splitting
    const loopSplittingHelpers = createLoopSplittingHelpers(stagingSchema, pool, 5.0);
    const result = await loopSplittingHelpers.splitLoopTrails();
    
    if (result.success) {
      console.log('✅ Loop splitting completed successfully');
      console.log(`📊 Loop count: ${result.loopCount}`);
      console.log(`📊 Split segments: ${result.splitSegments}`);
      console.log(`📊 Intersection points: ${result.intersectionPoints}`);
      console.log(`📊 Apex points: ${result.apexPoints}`);
      
      // Get final count
      const finalCount = await pool.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
      console.log(`📊 Final trail count: ${finalCount.rows[0].count}`);
      
      // Check for split segments with original_trail_uuid
      const splitSegments = await pool.query(`
        SELECT app_uuid, original_trail_uuid, name 
        FROM ${stagingSchema}.trails 
        WHERE original_trail_uuid IS NOT NULL
        ORDER BY app_uuid
      `);
      
      console.log(`📊 Split segments with original_trail_uuid: ${splitSegments.rows.length}`);
      splitSegments.rows.forEach(row => {
        console.log(`  - ${row.app_uuid} (original: ${row.original_trail_uuid}) - ${row.name}`);
      });
      
      // Verify that the original loop trail was deleted
      const originalTrail = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [testLoopTrail.app_uuid]);
      
      if (parseInt(originalTrail.rows[0].count) === 0) {
        console.log('✅ Original loop trail was properly deleted');
      } else {
        console.log('❌ Original loop trail was NOT deleted - THIS IS THE PROBLEM!');
      }
      
      // Check that simple trail still exists and wasn't affected
      const simpleTrail = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [testSimpleTrail.app_uuid]);
      
      if (parseInt(simpleTrail.rows[0].count) === 1) {
        console.log('✅ Simple trail was not affected (as expected)');
      } else {
        console.log('❌ Simple trail was affected unexpectedly');
      }
      
      // Get detailed stats
      const stats = await loopSplittingHelpers.getLoopSplittingStats();
      console.log('📊 Detailed stats:', stats);
      
      // Generate GeoJSON for visualization
      const geojsonResults = await pool.query(`
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'properties', jsonb_build_object(
                'app_uuid', app_uuid,
                'name', name,
                'original_trail_uuid', original_trail_uuid,
                'trail_type', CASE 
                  WHEN original_trail_uuid IS NOT NULL THEN 'split_segment'
                  ELSE 'unsplit_trail'
                END,
                'length_km', length_km
              ),
              'geometry', ST_AsGeoJSON(geometry)::jsonb
            )
          )
        ) as geojson
        FROM ${stagingSchema}.trails
      `);
      
      const geojson = geojsonResults.rows[0].geojson;
      
      // Write GeoJSON to file
      const fs = require('fs');
      const outputPath = 'test-output/loop-splitting-test-result.geojson';
      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      console.log(`📄 GeoJSON written to: ${outputPath}`);
      
    } else {
      console.error('❌ Loop splitting failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up test schema
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
      console.log(`🧹 Cleaned up test schema: ${stagingSchema}`);
    } catch (cleanupError) {
      console.warn('Warning: Could not clean up test schema:', cleanupError);
    }
    await pool.end();
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testLoopSplittingParentChild().catch(console.error);
}

export { testLoopSplittingParentChild };
