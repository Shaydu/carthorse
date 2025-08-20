#!/usr/bin/env node

const { Pool } = require('pg');

// Test configuration
const TEST_CONFIG = {
  minGapDistance: 1,  // 1 meter
  maxGapDistance: 10, // 10 meters
  stagingSchema: 'carthorse_1755653593916' // Use the current staging schema
};

// Original query (slow)
const ORIGINAL_QUERY = `
  WITH trail_endpoints AS (
    SELECT 
      id,
      app_uuid,
      name,
      ST_StartPoint(geometry) as start_pt,
      ST_EndPoint(geometry) as end_pt,
      geometry
    FROM ${TEST_CONFIG.stagingSchema}.trails
  )
  SELECT 
    t1.id as trail1_id,
    t1.app_uuid as trail1_uuid,
    t1.name as trail1_name,
    t2.id as trail2_id,
    t2.app_uuid as trail2_uuid,
    t2.name as trail2_name,
    ST_Distance(t1.end_pt::geography, t2.start_pt::geography) as gap_distance,
    t1.end_pt as trail1_end,
    t2.start_pt as trail2_start
  FROM trail_endpoints t1
  CROSS JOIN trail_endpoints t2
  WHERE t1.id != t2.id
    AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) >= $1
    AND ST_Distance(t1.end_pt::geography, t2.start_pt::geography) <= $2
  ORDER BY gap_distance ASC
`;

// Optimized query (fast)
const OPTIMIZED_QUERY = `
  WITH trail_endpoints AS (
    SELECT 
      id,
      app_uuid,
      name,
      ST_StartPoint(geometry) as start_pt,
      ST_EndPoint(geometry) as end_pt,
      geometry
    FROM ${TEST_CONFIG.stagingSchema}.trails
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
  ),
  -- Pre-filter using spatial indexes to reduce CROSS JOIN complexity
  candidate_pairs AS (
    SELECT 
      t1.id as trail1_id,
      t1.app_uuid as trail1_uuid,
      t1.name as trail1_name,
      t1.end_pt as trail1_end,
      t2.id as trail2_id,
      t2.app_uuid as trail2_uuid,
      t2.name as trail2_name,
      t2.start_pt as trail2_start
    FROM trail_endpoints t1
    JOIN trail_endpoints t2 ON (
      t1.id != t2.id 
      AND ST_DWithin(t1.end_pt::geography, t2.start_pt::geography, $2)  -- Use maxGapDistance for initial filtering
    )
  )
  SELECT 
    trail1_id,
    trail1_uuid,
    trail1_name,
    trail2_id,
    trail2_uuid,
    trail2_name,
    ST_Distance(trail1_end::geography, trail2_start::geography) as gap_distance,
    trail1_end,
    trail2_start
  FROM candidate_pairs
  WHERE ST_Distance(trail1_end::geography, trail2_start::geography) >= $1  -- minGapDistance
    AND ST_Distance(trail1_end::geography, trail2_start::geography) <= $2  -- maxGapDistance
  ORDER BY gap_distance ASC
`;

async function testQueryOptimization() {
  const pool = new Pool({
    user: process.env.PGUSER || 'carthorse',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🔍 Testing query optimization data integrity...');
    console.log(`📊 Using staging schema: ${TEST_CONFIG.stagingSchema}`);
    console.log(`📏 Gap distance range: ${TEST_CONFIG.minGapDistance}m - ${TEST_CONFIG.maxGapDistance}m`);
    
    // Check if staging schema exists
    const schemaCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = $1
      ) as schema_exists
    `, [TEST_CONFIG.stagingSchema]);
    
    if (!schemaCheck.rows[0].schema_exists) {
      console.error(`❌ Staging schema ${TEST_CONFIG.stagingSchema} does not exist!`);
      return;
    }
    
    // Check trail count
    const trailCount = await pool.query(`
      SELECT COUNT(*) as count FROM ${TEST_CONFIG.stagingSchema}.trails
    `);
    console.log(`📈 Total trails in schema: ${trailCount.rows[0].count}`);
    
    // Test original query
    console.log('\n🔄 Running original query...');
    const startTime1 = Date.now();
    const originalResult = await pool.query(ORIGINAL_QUERY, [TEST_CONFIG.minGapDistance, TEST_CONFIG.maxGapDistance]);
    const originalTime = Date.now() - startTime1;
    console.log(`⏱️  Original query time: ${originalTime}ms`);
    console.log(`📊 Original query results: ${originalResult.rows.length} gaps found`);
    
    // Test optimized query
    console.log('\n⚡ Running optimized query...');
    const startTime2 = Date.now();
    const optimizedResult = await pool.query(OPTIMIZED_QUERY, [TEST_CONFIG.minGapDistance, TEST_CONFIG.maxGapDistance]);
    const optimizedTime = Date.now() - startTime2;
    console.log(`⏱️  Optimized query time: ${optimizedTime}ms`);
    console.log(`📊 Optimized query results: ${optimizedResult.rows.length} gaps found`);
    
    // Compare results
    console.log('\n🔍 Comparing results...');
    
    if (originalResult.rows.length !== optimizedResult.rows.length) {
      console.error(`❌ RESULT COUNT MISMATCH!`);
      console.error(`   Original: ${originalResult.rows.length} results`);
      console.error(`   Optimized: ${optimizedResult.rows.length} results`);
      console.error(`   Difference: ${Math.abs(originalResult.rows.length - optimizedResult.rows.length)} results`);
      
      // Show some sample differences
      const originalIds = new Set(originalResult.rows.map(r => `${r.trail1_id}-${r.trail2_id}`));
      const optimizedIds = new Set(optimizedResult.rows.map(r => `${r.trail1_id}-${r.trail2_id}`));
      
      const missingInOptimized = [...originalIds].filter(id => !optimizedIds.has(id));
      const extraInOptimized = [...optimizedIds].filter(id => !originalIds.has(id));
      
      if (missingInOptimized.length > 0) {
        console.error(`   Missing in optimized: ${missingInOptimized.slice(0, 5).join(', ')}${missingInOptimized.length > 5 ? '...' : ''}`);
      }
      if (extraInOptimized.length > 0) {
        console.error(`   Extra in optimized: ${extraInOptimized.slice(0, 5).join(', ')}${extraInOptimized.length > 5 ? '...' : ''}`);
      }
      
      return;
    }
    
    // Compare individual results
    let differences = 0;
    const tolerance = 0.001; // 1mm tolerance for floating point differences
    
    for (let i = 0; i < Math.min(originalResult.rows.length, optimizedResult.rows.length); i++) {
      const orig = originalResult.rows[i];
      const opt = optimizedResult.rows[i];
      
      // Compare key fields
      if (orig.trail1_id !== opt.trail1_id || 
          orig.trail2_id !== opt.trail2_id ||
          Math.abs(orig.gap_distance - opt.gap_distance) > tolerance) {
        differences++;
        if (differences <= 5) {
          console.error(`   Difference at row ${i}:`);
          console.error(`     Original: trail1=${orig.trail1_id}, trail2=${orig.trail2_id}, distance=${orig.gap_distance}`);
          console.error(`     Optimized: trail1=${opt.trail1_id}, trail2=${opt.trail2_id}, distance=${opt.gap_distance}`);
        }
      }
    }
    
    if (differences > 0) {
      console.error(`❌ DATA MISMATCH! ${differences} differences found`);
      return;
    }
    
    // Performance comparison
    const speedup = originalTime / optimizedTime;
    console.log(`\n✅ SUCCESS! Both queries return identical results`);
    console.log(`🚀 Performance improvement: ${speedup.toFixed(2)}x faster`);
    console.log(`⏱️  Time saved: ${(originalTime - optimizedTime).toFixed(0)}ms`);
    
    // Show sample results
    if (originalResult.rows.length > 0) {
      console.log('\n📋 Sample results (first 3):');
      originalResult.rows.slice(0, 3).forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.trail1_name} → ${row.trail2_name} (${row.gap_distance.toFixed(2)}m)`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error during testing:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testQueryOptimization().catch(console.error);
