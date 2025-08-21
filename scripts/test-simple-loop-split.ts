import { Pool } from 'pg';
import { createLoopSplittingHelpers } from '../src/utils/loop-splitting-helpers';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || 'carthorse'
});

async function testSimpleLoopSplit() {
  const stagingSchema = `simple_test_${Date.now()}`;
  const client = await pool.connect();
  
  try {
    console.log(`🧪 Testing simple loop split: 1 loop → 2 segments → delete original in ${stagingSchema}...`);
    
    // Create test schema
    await client.query(`CREATE SCHEMA ${stagingSchema}`);
    
    // Create trails table
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
    
    // Copy ONE real Hogback Ridge trail from public.trails
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
    
    // Add an intersecting trail to trigger splitting (make it NOT a loop)
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, geometry, length_km, region
      ) VALUES (
        'intersecting-trail-001',
        'Test Intersecting Trail',
        ST_GeomFromText('LINESTRING Z (-105.295 40.069 1750, -105.295 40.070 1800, -105.300 40.075 1850)', 4326),
        2.0,
        'boulder'
      )
    `);
    
    // Check initial state
    const initialCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`📊 Initial trails: ${initialCount.rows[0].count}`);
    
    const hogbackTrails = await client.query(`
      SELECT app_uuid, name, original_trail_uuid 
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%hogback%'
      ORDER BY app_uuid
    `);
    
    console.log('📋 Hogback trails before splitting:');
    hogbackTrails.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.app_uuid} - "${trail.name}" (original: ${trail.original_trail_uuid})`);
    });
    
    const originalHogbackUuid = hogbackTrails.rows[0].app_uuid;
    
    // Run loop splitting
    const loopSplittingHelpers = createLoopSplittingHelpers(stagingSchema, pool);
    const result = await loopSplittingHelpers.splitLoopTrails();
    
    if (result.success) {
      console.log('✅ Loop splitting completed successfully');
      
      // Check final state
      const finalCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
      console.log(`📊 Final trails: ${finalCount.rows[0].count}`);
      
      const finalHogbackTrails = await client.query(`
        SELECT app_uuid, name, original_trail_uuid 
        FROM ${stagingSchema}.trails 
        WHERE name ILIKE '%hogback%'
        ORDER BY name, app_uuid
      `);
      
      console.log('📋 Hogback trails after splitting:');
      finalHogbackTrails.rows.forEach((trail, index) => {
        console.log(`  ${index + 1}. ${trail.app_uuid} - "${trail.name}" (original: ${trail.original_trail_uuid})`);
      });
      
      // Check if original was deleted
      const originalExists = finalHogbackTrails.rows.some(trail => trail.app_uuid === originalHogbackUuid);
      if (originalExists) {
        console.log('❌ Original loop trail still exists - should have been deleted');
      } else {
        console.log('✅ Original loop trail was properly deleted');
      }
      
      // Check split segments
      const splitSegments = finalHogbackTrails.rows.filter(trail => trail.name.includes('Segment'));
      console.log(`📊 Split segments: ${splitSegments.length}`);
      
      if (splitSegments.length === 2) {
        console.log('✅ Correct: Got 2 split segments as expected');
      } else {
        console.log(`❌ Expected 2 split segments, got ${splitSegments.length}`);
      }
      
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

testSimpleLoopSplit();
