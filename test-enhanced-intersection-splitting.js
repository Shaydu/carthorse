const { Pool } = require('pg');
const path = require('path');

// Test configuration
const TEST_SCHEMA = 'test_enhanced_splitting';
const config = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'postgres',
  password: 'postgres'
};

async function testEnhancedIntersectionSplitting() {
  const pool = new Pool(config);
  
  try {
    console.log('🧪 Testing Enhanced Intersection Splitting Service...');
    
    // Step 1: Create test schema
    console.log('📋 Creating test schema...');
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Step 2: Create trails table with original_trail_uuid column
    console.log('📋 Creating trails table...');
    await pool.query(`
      CREATE TABLE ${TEST_SCHEMA}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        original_trail_uuid TEXT,  -- Reference to parent trail UUID when this trail is a split segment
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
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Step 3: Insert test data - create intersecting trails
    console.log('📋 Inserting test data...');
    
    // Trail 1: Horizontal line that will be split
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.trails (
        app_uuid, name, region, geometry, length_km
      ) VALUES (
        'trail-1-original', 'Hogback Ridge Trail', 'boulder',
        ST_GeomFromText('LINESTRINGZ(-105.28 40.10 1600, -105.27 40.10 1600, -105.26 40.10 1600)', 4326),
        2.0
      )
    `);
    
    // Trail 2: Vertical line that intersects Trail 1
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.trails (
        app_uuid, name, region, geometry, length_km
      ) VALUES (
        'trail-2', 'North Sky Trail', 'boulder',
        ST_GeomFromText('LINESTRINGZ(-105.27 40.09 1600, -105.27 40.10 1600, -105.27 40.11 1600)', 4326),
        2.0
      )
    `);
    
    // Trail 3: Another trail that doesn't intersect (should be preserved)
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.trails (
        app_uuid, name, region, geometry, length_km
      ) VALUES (
        'trail-3', 'Standalone Trail', 'boulder',
        ST_GeomFromText('LINESTRINGZ(-105.25 40.10 1600, -105.24 40.10 1600)', 4326),
        1.0
      )
    `);
    
    // Step 4: Check initial state
    console.log('📊 Checking initial state...');
    const initialCount = await pool.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.trails`);
    console.log(`   Initial trail count: ${initialCount.rows[0].count}`);
    
    const initialTrails = await pool.query(`SELECT app_uuid, name FROM ${TEST_SCHEMA}.trails ORDER BY app_uuid`);
    console.log('   Initial trails:');
    initialTrails.rows.forEach(trail => {
      console.log(`     - ${trail.app_uuid}: ${trail.name}`);
    });
    
    // Step 5: Apply enhanced intersection splitting
    console.log('🔗 Applying enhanced intersection splitting...');
    
    // Import and use the enhanced service
    const { EnhancedIntersectionSplittingService } = require('./src/services/layer1/EnhancedIntersectionSplittingService.ts');
    
    const splittingService = new EnhancedIntersectionSplittingService({
      stagingSchema: TEST_SCHEMA,
      pgClient: pool,
      minTrailLengthMeters: 5.0
    });
    
    const result = await splittingService.applyEnhancedIntersectionSplitting();
    
    console.log('📊 Splitting results:');
    console.log(`   Trails processed: ${result.trailsProcessed}`);
    console.log(`   Segments created: ${result.segmentsCreated}`);
    console.log(`   Intersections found: ${result.intersectionsFound}`);
    console.log(`   Original trails deleted: ${result.originalTrailsDeleted}`);
    
    // Step 6: Check final state
    console.log('📊 Checking final state...');
    const finalCount = await pool.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.trails`);
    console.log(`   Final trail count: ${finalCount.rows[0].count}`);
    
    const finalTrails = await pool.query(`
      SELECT app_uuid, original_trail_uuid, name, 
             ST_Length(geometry::geography) as length_meters
      FROM ${TEST_SCHEMA}.trails 
      ORDER BY name, app_uuid
    `);
    
    console.log('   Final trails:');
    finalTrails.rows.forEach(trail => {
      const originalRef = trail.original_trail_uuid ? ` (split from ${trail.original_trail_uuid})` : ' (original)';
      console.log(`     - ${trail.app_uuid}: ${trail.name}${originalRef} (${trail.length_meters.toFixed(1)}m)`);
    });
    
    // Step 7: Verify that the original unsplit trail was deleted
    const originalTrailExists = await pool.query(`
      SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.trails 
      WHERE app_uuid = 'trail-1-original'
    `);
    
    if (originalTrailExists.rows[0].count === 0) {
      console.log('✅ SUCCESS: Original unsplit trail was properly deleted');
    } else {
      console.log('❌ FAILURE: Original unsplit trail still exists');
    }
    
    // Step 8: Verify that standalone trail was preserved
    const standaloneTrailExists = await pool.query(`
      SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.trails 
      WHERE app_uuid = 'trail-3'
    `);
    
    if (standaloneTrailExists.rows[0].count === 1) {
      console.log('✅ SUCCESS: Standalone trail was properly preserved');
    } else {
      console.log('❌ FAILURE: Standalone trail was not preserved');
    }
    
    // Step 9: Verify that split segments have original_trail_uuid references
    const splitSegments = await pool.query(`
      SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.trails 
      WHERE original_trail_uuid = 'trail-1-original'
    `);
    
    if (splitSegments.rows[0].count > 0) {
      console.log(`✅ SUCCESS: Found ${splitSegments.rows[0].count} split segments with original_trail_uuid references`);
    } else {
      console.log('❌ FAILURE: No split segments found with original_trail_uuid references');
    }
    
    console.log('🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testEnhancedIntersectionSplitting();
