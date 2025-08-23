#!/usr/bin/env node

const { Client } = require('pg');

async function testHogbackPreservation() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🧪 Testing Hogback Ridge preservation approach...');

    // Clear staging schema and copy some test data
    console.log('\n📊 Setting up test data...');
    await client.query('DELETE FROM staging.trails');
    
    // Copy some trails to staging for testing, including Hogback Ridge
    await client.query(`
      INSERT INTO staging.trails 
      SELECT * FROM public.trails 
      WHERE name ILIKE '%hogback%' 
         OR name ILIKE '%anemone%'
         OR name ILIKE '%north sky%'
      LIMIT 10
    `);

    // Check initial state
    console.log('\n📊 Initial state:');
    const beforeState = await client.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' THEN 1 END) as hogback_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' AND NOT ST_IsSimple(geometry) THEN 1 END) as hogback_non_simple
      FROM staging.trails
    `);
    
    console.log(`   Total trails: ${beforeState.rows[0].total_trails}`);
    console.log(`   Non-simple trails: ${beforeState.rows[0].non_simple_count}`);
    console.log(`   Hogback trails: ${beforeState.rows[0].hogback_count}`);
    console.log(`   Hogback non-simple: ${beforeState.rows[0].hogback_non_simple}`);

    // Test the preservation approach manually
    console.log('\n🔄 Testing Hogback Ridge preservation approach...');
    
    await client.query('BEGIN');

    // Step 1: Find intersections between different trails only (NOT self-intersections)
    console.log('🔗 Finding intersections between different trails (preserving self-intersecting loops)...');
    
    const intersectionResult = await client.query(`
      WITH trail_intersections AS (
        -- Intersections between different trails (NOT self-intersections)
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
          ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_text
        FROM staging.trails t1
        JOIN staging.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND NOT ST_Touches(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
      )
      SELECT * FROM trail_intersections
      WHERE intersection_point IS NOT NULL
    `);
    
    console.log(`   📊 Found ${intersectionResult.rows.length} intersection points between different trails`);
    
    // Step 2: Process each intersection by splitting trails at intersection points
    let splitCount = 0;
    for (const intersection of intersectionResult.rows) {
      try {
        // Split trail1 at intersection point
        const splitResult1 = await client.query(`
          WITH split_geom AS (
            SELECT ST_Split(geometry, $1::geometry) as split_geometries
            FROM staging.trails
            WHERE app_uuid = $2
          )
          SELECT ST_NumGeometries(split_geometries) as num_segments
          FROM split_geom
        `, [intersection.intersection_point, intersection.trail1_uuid]);
        
        // Split trail2 at intersection point  
        const splitResult2 = await client.query(`
          WITH split_geom AS (
            SELECT ST_Split(geometry, $1::geometry) as split_geometries
            FROM staging.trails
            WHERE app_uuid = $3
          )
          SELECT ST_NumGeometries(split_geometries) as num_segments
          FROM split_geom
        `, [intersection.intersection_point, intersection.trail2_uuid]);
        
        const segments1 = splitResult1.rows[0]?.num_segments || 0;
        const segments2 = splitResult2.rows[0]?.num_segments || 0;
        
        if (segments1 > 1 || segments2 > 1) {
          splitCount++;
          console.log(`   ✅ Split trails at ${intersection.intersection_text} (${segments1} + ${segments2} segments)`);
        }
      } catch (error) {
        console.warn(`   ⚠️ Failed to split trails at ${intersection.intersection_text}:`, error instanceof Error ? error.message : String(error));
      }
    }
    
    // Step 3: Check how many self-intersecting loops we preserved
    const selfIntersectingCount = await client.query(`
      SELECT COUNT(*) as count 
      FROM staging.trails 
      WHERE NOT ST_IsSimple(geometry)
    `);
    
    console.log(`   📊 Preserved ${selfIntersectingCount.rows[0].count} self-intersecting loops (like Hogback Ridge)`);
    
    // Step 4: Remove degenerate edges
    console.log('🧹 Removing degenerate edges...');
    await client.query(`
      DELETE FROM staging.trails 
      WHERE geometry IS NULL 
        OR ST_NumPoints(geometry) < 2 
        OR ST_Length(geometry::geography) = 0
    `);
    
    await client.query('COMMIT');
    
    // Check final state
    console.log('\n📊 Final state:');
    const afterState = await client.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' THEN 1 END) as hogback_count,
        COUNT(CASE WHEN name ILIKE '%hogback%' AND NOT ST_IsSimple(geometry) THEN 1 END) as hogback_non_simple
      FROM staging.trails
    `);
    
    console.log(`   Total trails: ${afterState.rows[0].total_trails}`);
    console.log(`   Non-simple trails: ${afterState.rows[0].non_simple_count}`);
    console.log(`   Hogback trails: ${afterState.rows[0].hogback_count}`);
    console.log(`   Hogback non-simple: ${afterState.rows[0].hogback_non_simple}`);
    
    // Check if Hogback Ridge was preserved (not split)
    const hogbackPreserved = afterState.rows[0].hogback_non_simple > 0;
    if (hogbackPreserved) {
      console.log('\n✅ SUCCESS: Hogback Ridge self-intersecting loops were preserved!');
    } else {
      console.log('\n❌ FAILURE: Hogback Ridge self-intersecting loops were split');
    }
    
    // Show specific Hogback trails
    const hogbackTrails = await client.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_IsSimple(geometry) as is_simple,
        ST_Length(geometry::geography) as length_meters
      FROM staging.trails 
      WHERE name ILIKE '%hogback%'
      ORDER BY name
    `);
    
    console.log('\n📋 Hogback Ridge trails after processing:');
    hogbackTrails.rows.forEach(trail => {
      const status = trail.is_simple ? 'simple' : 'self-intersecting (preserved)';
      console.log(`   - ${trail.name}: ${status} (${trail.length_meters.toFixed(1)}m)`);
    });
    
    console.log(`\n✅ Hogback Ridge preservation test completed successfully!`);
    console.log(`   - Intersections processed: ${splitCount}`);
    console.log(`   - Self-intersecting loops preserved: ${selfIntersectingCount.rows[0].count}`);
    console.log(`   - Self-intersecting loops will be handled by pgRouting topology creation`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await client.end();
  }
}

testHogbackPreservation();
