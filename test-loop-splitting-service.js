#!/usr/bin/env node

const { Client } = require('pg');

async function testLoopSplittingService() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🧪 Testing new LoopSplittingService...');

    // Check current state before testing
    console.log('\n📊 Current state before testing:');
    const beforeState = await client.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' THEN 1 END) as hogback_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' AND NOT ST_IsSimple(geometry) THEN 1 END) as hogback_non_simple
      FROM staging.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
    `);

    console.log(`   Total trails: ${beforeState.rows[0].total_trails}`);
    console.log(`   Non-simple trails: ${beforeState.rows[0].non_simple_count}`);
    console.log(`   Hogback trails: ${beforeState.rows[0].hogback_count}`);
    console.log(`   Non-simple Hogback trails: ${beforeState.rows[0].hogback_non_simple}`);

    // Show details of non-simple trails
    if (beforeState.rows[0].non_simple_count > 0) {
      const nonSimpleTrails = await client.query(`
        SELECT id, app_uuid, name, 
               ST_Length(geometry::geography) as length_meters,
               ST_NumPoints(geometry) as num_points,
               ST_IsSimple(geometry) as is_simple,
               ST_GeometryType(geometry) as geom_type
        FROM staging.trails 
        WHERE NOT ST_IsSimple(geometry)
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
        ORDER BY name
        LIMIT 5
      `);

      console.log('\n📋 Non-simple trails found:');
      nonSimpleTrails.rows.forEach((trail, index) => {
        console.log(`   ${index + 1}. ${trail.name} (${trail.app_uuid})`);
        console.log(`      Length: ${trail.length_meters?.toFixed(2)}m, Points: ${trail.num_points}, Type: ${trail.geom_type}`);
      });
    }

    // Test the new loop splitting logic directly
    console.log('\n🔧 Testing new loop splitting logic...');
    
    // Find a non-simple trail to test with
    const testTrail = await client.query(`
      SELECT app_uuid, name, geometry
      FROM staging.trails 
      WHERE NOT ST_IsSimple(geometry)
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
      LIMIT 1
    `);

    if (testTrail.rows.length === 0) {
      console.log('   ⚠️  No non-simple trails found to test with');
      return;
    }

    const trail = testTrail.rows[0];
    console.log(`   Testing with trail: ${trail.name} (${trail.app_uuid})`);

    // Test the splitting logic
    const splitQuery = `
      WITH loop_geometry AS (
        SELECT '${trail.app_uuid}' as trail_uuid, '${trail.name}' as name, ST_Force2D(geometry) as geom
        FROM staging.trails 
        WHERE app_uuid = '${trail.app_uuid}'
      ),
      split_segments AS (
        SELECT 
          (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment_geom,
          generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
        FROM loop_geometry
      )
      SELECT 
        segment_geom,
        segment_index,
        ST_GeometryType(segment_geom) as geom_type,
        ST_NumPoints(segment_geom) as num_points,
        ST_IsSimple(segment_geom) as is_simple,
        ST_Length(segment_geom::geography) as length_meters
      FROM split_segments
      WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
        AND ST_NumPoints(segment_geom) > 1
    `;

    const splitResult = await client.query(splitQuery);
    console.log(`   ✅ Split result: ${splitResult.rows.length} segments created`);

    splitResult.rows.forEach((segment, index) => {
      console.log(`      Segment ${index + 1}: ${segment.geom_type}, ${segment.num_points} points, ${segment.length_meters?.toFixed(2)}m, simple: ${segment.is_simple}`);
    });

    // Test validation
    console.log('\n✅ Validation:');
    const validation = await client.query(`
      SELECT COUNT(*) as count 
      FROM staging.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
        AND NOT ST_IsSimple(geometry)
    `);

    const nonSimpleCount = parseInt(validation.rows[0].count);
    console.log(`   Non-simple trails remaining: ${nonSimpleCount}`);
    console.log(`   Validation result: ${nonSimpleCount === 0 ? '✅ PASS' : '❌ FAIL'}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testLoopSplittingService();
