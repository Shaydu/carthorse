#!/usr/bin/env ts-node

import { Pool } from 'pg';

interface OptimizationTest {
  name: string;
  oldQuery: string;
  newQuery: string;
  params: any[];
  expectedResults: number;
}

async function testQueryOptimization() {
  const pgClient = new Pool({
    host: 'localhost',
    user: 'shaydu',
    password: '',
    database: 'trail_master_db'
  });

  try {
    // Find the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    // Test 1: Trail Endpoints Query Optimization
    console.log('\n🔍 Test 1: Trail Endpoints Query Optimization');
    
    // OLD: CROSS JOIN with expensive GeoJSON conversions
    const oldEndpointsQuery = `
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
          ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
          geometry as trail_geom
        FROM ${stagingSchema}.trails
        WHERE ST_Length(geometry::geography) >= $1
      )
      SELECT COUNT(*) as count
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id != t2.trail_id
        AND ST_DWithin(t1.start_point::geometry, t2.trail_geom, $2)
      LIMIT 100
    `;

    // NEW: Optimized with spatial indexing (simplified for testing)
    const newEndpointsQuery = `
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry as trail_geom
        FROM ${stagingSchema}.trails
        WHERE ST_Length(geometry::geography) >= $1
      )
      SELECT COUNT(*) as count
      FROM trail_endpoints t1
      JOIN trail_endpoints t2 ON t1.trail_id != t2.trail_id
        AND ST_DWithin(t1.start_point, t2.trail_geom, $2)
      LIMIT 100
    `;

    // Test 2: Trail Pairs Query Optimization
    console.log('\n🔍 Test 2: Trail Pairs Query Optimization');
    
    // OLD: CROSS JOIN for trail comparisons
    const oldPairsQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${stagingSchema}.trails t1
        CROSS JOIN ${stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.geometry, t2.geometry, $1)
      )
      SELECT COUNT(*) as count
      FROM trail_pairs
      WHERE ST_Distance(trail1_geom::geography, trail2_geom::geography) <= $2
      LIMIT 100
    `;

    // NEW: Optimized with spatial indexing (FIXED for data integrity)
    const newPairsQuery = `
      WITH trail_candidates AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom,
          ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
          AND ST_DWithin(t1.geometry, t2.geometry, $1)  -- Same spatial filter as OLD
      )
      SELECT COUNT(*) as count
      FROM trail_candidates
      WHERE distance_meters <= $2
      LIMIT 100
    `;

    const tests: OptimizationTest[] = [
      {
        name: 'Trail Endpoints (OLD)',
        oldQuery: oldEndpointsQuery,
        newQuery: '',
        params: [5, 10],
        expectedResults: 0
      },
      {
        name: 'Trail Endpoints (NEW)',
        oldQuery: '',
        newQuery: newEndpointsQuery,
        params: [5, 10],
        expectedResults: 0
      },
      {
        name: 'Trail Pairs (OLD)',
        oldQuery: oldPairsQuery,
        newQuery: '',
        params: [0.00002, 100],
        expectedResults: 0
      },
      {
        name: 'Trail Pairs (NEW)',
        oldQuery: '',
        newQuery: newPairsQuery,
        params: [0.00002, 100],
        expectedResults: 0
      }
    ];

    // Run performance tests
    for (const test of tests) {
      console.log(`\n⏱️  Testing: ${test.name}`);
      
      const query = test.oldQuery || test.newQuery;
      const startTime = Date.now();
      
      try {
        const result = await pgClient.query(query, test.params);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`   ✅ Success: ${duration}ms, ${result.rows.length} rows`);
        console.log(`   📊 Result: ${result.rows[0]?.count || 'N/A'} matches`);
        
        if (duration > 1000) {
          console.log(`   ⚠️  SLOW: Query took ${duration}ms (>1s)`);
        } else if (duration < 100) {
          console.log(`   🚀 FAST: Query took ${duration}ms (<100ms)`);
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${error}`);
      }
    }

    // Test data integrity by comparing results
    console.log('\n🔍 Data Integrity Test: Comparing OLD vs NEW results');
    
    try {
      // Run both queries and compare results
      const oldResult = await pgClient.query(oldPairsQuery, [0.00002, 100]);
      const newResult = await pgClient.query(newPairsQuery, [0.00002, 100]);
      
      console.log(`   OLD query result: ${oldResult.rows[0]?.count || 0} matches`);
      console.log(`   NEW query result: ${newResult.rows[0]?.count || 0} matches`);
      
      if (oldResult.rows[0]?.count === newResult.rows[0]?.count) {
        console.log(`   ✅ Data integrity: PASSED - Results match`);
      } else {
        console.log(`   ❌ Data integrity: FAILED - Results differ`);
      }
      
    } catch (error) {
      console.log(`   ❌ Data integrity test failed: ${error}`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testQueryOptimization().catch(console.error);
