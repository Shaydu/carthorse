import { Pool } from 'pg';
import { createLoopSplittingHelpers } from '../src/utils/loop-splitting-helpers';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || 'carthorse'
});

async function testLoopSplittingDeletionFix() {
  const stagingSchema = `staging_test_${Date.now()}`;
  const client = await pool.connect();
  
  try {
    console.log(`🧪 Testing loop splitting deletion fix with real Hogback Ridge data in ${stagingSchema}...`);
    
    // Create test schema
    await client.query(`CREATE SCHEMA ${stagingSchema}`);
    
    // Create trails table with same structure as public.trails
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        original_trail_uuid TEXT,
        osm_id TEXT,
        name TEXT NOT NULL,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Copy real Hogback Ridge trail data from public.trails
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, geometry
      )
      SELECT 
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, geometry
      FROM public.trails 
      WHERE name ILIKE '%hogback ridge%'
      LIMIT 1
    `);
    
    // Get the original trail UUID
    const originalTrail = await client.query(`
      SELECT app_uuid, name FROM ${stagingSchema}.trails WHERE name ILIKE '%hogback%'
    `);
    
    if (originalTrail.rows.length === 0) {
      throw new Error('No Hogback Ridge trail found in public.trails');
    }
    
    const originalTrailUuid = originalTrail.rows[0].app_uuid;
    const duplicateUuid = 'duplicate-hogback-test-001';
    
    // Create a duplicate trail with the same geometry but different UUID
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, original_trail_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, geometry
      )
      SELECT 
        $1, $2, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, geometry
      FROM ${stagingSchema}.trails 
      WHERE app_uuid = $3
    `, [duplicateUuid, originalTrailUuid, originalTrailUuid]);
    
    // Add an intersecting trail to trigger splitting
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, geometry, length_km, region
      )
      SELECT 
        'intersecting-trail-001',
        'Test Intersecting Trail',
        ST_GeomFromText('LINESTRING Z (-105.295 40.069 1750, -105.295 40.070 1800, -105.295 40.071 1850)', 4326),
        2.0,
        'boulder'
    `);
    
    console.log(`✅ Real Hogback Ridge data copied with original UUID: ${originalTrailUuid}`);
    
    // Check initial state
    const initialTrails = await client.query(`
      SELECT app_uuid, name, original_trail_uuid 
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%hogback%'
      ORDER BY app_uuid
    `);
    
    console.log('📊 Initial trails:');
    initialTrails.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.app_uuid} - "${trail.name}" (original: ${trail.original_trail_uuid})`);
    });
    
    // Run loop splitting
    const loopSplittingHelpers = createLoopSplittingHelpers(stagingSchema, pool);
    const result = await loopSplittingHelpers.splitLoopTrails();
    
    if (result.success) {
      console.log('✅ Loop splitting completed successfully');
      
      // Check final state
      const finalTrails = await client.query(`
        SELECT app_uuid, name, original_trail_uuid 
        FROM ${stagingSchema}.trails 
        WHERE name ILIKE '%hogback%'
        ORDER BY name, app_uuid
      `);
      
      console.log('📊 Final trails:');
      finalTrails.rows.forEach((trail, index) => {
        console.log(`  ${index + 1}. ${trail.app_uuid} - "${trail.name}" (original: ${trail.original_trail_uuid})`);
      });
      
      // Check if the duplicate was properly deleted
      const duplicateExists = finalTrails.rows.some(trail => trail.app_uuid === duplicateUuid);
      if (duplicateExists) {
        console.log('❌ Duplicate unsplit trail still exists - deletion failed');
      } else {
        console.log('✅ Duplicate unsplit trail was properly deleted');
      }
      
      // Check if we have split segments
      const splitSegments = finalTrails.rows.filter(trail => trail.name.includes('Segment'));
      console.log(`📊 Split segments: ${splitSegments.length}`);
      
    } else {
      console.error('❌ Loop splitting failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up test schema
    await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    client.release();
    await pool.end();
  }
}

testLoopSplittingDeletionFix();
