#!/usr/bin/env ts-node

/**
 * Debug test to understand degree2 merge chain detection
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_degree2_debug_20241215';

async function testDegree2Debug() {
  console.log('🔍 Debugging degree2 merge chain detection...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create simple test data: just the Marshall Mesa chain
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id integer PRIMARY KEY,
        source integer,
        target integer,
        the_geom geometry(LineString,4326),
        length_km real,
        elevation_gain real,
        elevation_loss real,
        name text,
        app_uuid text,
        old_id bigint
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id bigint PRIMARY KEY,
        cnt integer,
        chk integer,
        ein integer,
        eout integer,
        the_geom geometry(Point,4326)
      )
    `);
    
    // Insert just the Marshall Mesa chain
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      -- Edge 12: Marshall Mesa trail
      (12, 6, 19, ST_GeomFromText('LINESTRING(-105.227844 39.948591, -105.217581 39.954282)', 4326), 1.128, 47, 47, 'Marshall Mesa', 'marshall-mesa', NULL),
      
      -- Edge 19: Bridge connector
      (19, 19, 20, ST_GeomFromText('LINESTRING(-105.217581 39.954282, -105.217691 39.954359)', 4326), 0.013, 0, 0, 'bridge-extend', 'bridge-extend', NULL),
      
      -- Edge 13: Marshall Valley Trail
      (13, 10, 20, ST_GeomFromText('LINESTRING(-105.231126 39.951981, -105.217691 39.954359)', 4326), 1.307, 16, 16, 'Marshall Valley Trail', 'marshall-valley', NULL)
    `);
    
    // Create vertices
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      (6, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.227844 39.948591)', 4326)),
      (10, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.231126 39.951981)', 4326)),
      (19, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.217581 39.954282)', 4326)),
      (20, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.217691 39.954359)', 4326))
    `);
    
    console.log('✅ Created simple test data');
    
    // Show initial state
    console.log('\n📊 INITIAL STATE:');
    const edges = await pgClient.query(`
      SELECT id, source, target, name, length_km
      FROM ${TEST_SCHEMA}.ways_noded
      ORDER BY id
    `);
    
    edges.rows.forEach(e => {
      console.log(`   Edge ${e.id}: ${e.source} → ${e.target} (${e.name}, ${e.length_km.toFixed(3)}km)`);
    });
    
    // Test the chain detection logic manually
    console.log('\n🔍 Testing chain detection manually...');
    
    const tolerance = 0.000045; // 5m in degrees
    
    // Test 1: Check if edges are geometrically connected
    const connectionTest = await pgClient.query(`
      SELECT 
        e1.id as edge1_id,
        e1.name as edge1_name,
        e2.id as edge2_id,
        e2.name as edge2_name,
        ST_Distance(ST_EndPoint(e1.the_geom), ST_StartPoint(e2.the_geom)) as distance_1,
        ST_Distance(ST_EndPoint(e1.the_geom), ST_EndPoint(e2.the_geom)) as distance_2,
        ST_Distance(ST_StartPoint(e1.the_geom), ST_StartPoint(e2.the_geom)) as distance_3,
        ST_Distance(ST_StartPoint(e1.the_geom), ST_EndPoint(e2.the_geom)) as distance_4
      FROM ${TEST_SCHEMA}.ways_noded e1
      CROSS JOIN ${TEST_SCHEMA}.ways_noded e2
      WHERE e1.id < e2.id
    `);
    
    console.log('📏 Geometric connections:');
    connectionTest.rows.forEach(c => {
      const minDistance = Math.min(c.distance_1, c.distance_2, c.distance_3, c.distance_4);
      const connected = minDistance <= tolerance;
      console.log(`   ${c.edge1_name} → ${c.edge2_name}: min distance = ${minDistance.toFixed(6)} (${connected ? '✅ CONNECTED' : '❌ NOT CONNECTED'})`);
    });
    
    // Test 2: Check vertex degrees
    const vertexDegrees = await pgClient.query(`
      SELECT 
        v.id,
        v.cnt as degree,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat
      FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr v
      ORDER BY v.id
    `);
    
    console.log('\n📊 Vertex degrees:');
    vertexDegrees.rows.forEach(v => {
      console.log(`   Vertex ${v.id}: (${v.lng.toFixed(6)}, ${v.lat.toFixed(6)}) - degree ${v.degree}`);
    });
    
    // Test 3: Simulate the recursive CTE manually
    console.log('\n🔍 Simulating recursive CTE manually...');
    
    // Step 1: Start with edge 12 (Marshall Mesa)
    console.log('   Step 1: Starting with Edge 12 (Marshall Mesa)');
    console.log('   Chain: [12] → Vertex 19');
    
    // Check geometry endpoints
    const edgeEndpoints = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_AsText(ST_StartPoint(the_geom)) as start_point,
        ST_AsText(ST_EndPoint(the_geom)) as end_point
      FROM ${TEST_SCHEMA}.ways_noded
      ORDER BY id
    `);
    
    console.log('   📍 Edge endpoints:');
    edgeEndpoints.rows.forEach(e => {
      console.log(`      Edge ${e.id} (${e.name}): ${e.start_point} → ${e.end_point}`);
    });
    
    // Step 2: Can we extend to edge 19?
    const extendTo19 = await pgClient.query(`
      SELECT 
        ST_DWithin(ST_EndPoint(e1.the_geom), ST_StartPoint(e2.the_geom), $1) as can_extend_start,
        ST_DWithin(ST_EndPoint(e1.the_geom), ST_EndPoint(e2.the_geom), $1) as can_extend_end,
        ST_Distance(ST_EndPoint(e1.the_geom), ST_StartPoint(e2.the_geom)) as distance_start,
        ST_Distance(ST_EndPoint(e1.the_geom), ST_EndPoint(e2.the_geom)) as distance_end
      FROM ${TEST_SCHEMA}.ways_noded e1
      JOIN ${TEST_SCHEMA}.ways_noded e2 ON e2.id = 19
      WHERE e1.id = 12
    `, [tolerance]);
    
    console.log(`   Can extend Edge 12 → Edge 19: ${extendTo19.rows[0].can_extend_start ? '✅ YES (start)' : '❌ NO (start)'} / ${extendTo19.rows[0].can_extend_end ? '✅ YES (end)' : '❌ NO (end)'}`);
    console.log(`   Distances: start=${extendTo19.rows[0].distance_start.toFixed(6)}, end=${extendTo19.rows[0].distance_end.toFixed(6)}`);
    
    if (extendTo19.rows[0].can_extend_start || extendTo19.rows[0].can_extend_end) {
      console.log('   Chain: [12, 19] → Vertex 20');
      
      // Step 3: Can we extend to edge 13?
      const extendTo13 = await pgClient.query(`
        SELECT 
          ST_DWithin(ST_EndPoint(e1.the_geom), ST_StartPoint(e2.the_geom), $1) as can_extend_start,
          ST_DWithin(ST_EndPoint(e1.the_geom), ST_EndPoint(e2.the_geom), $1) as can_extend_end,
          ST_Distance(ST_EndPoint(e1.the_geom), ST_StartPoint(e2.the_geom)) as distance_start,
          ST_Distance(ST_EndPoint(e1.the_geom), ST_EndPoint(e2.the_geom)) as distance_end
        FROM ${TEST_SCHEMA}.ways_noded e1
        JOIN ${TEST_SCHEMA}.ways_noded e2 ON e2.id = 13
        WHERE e1.id = 19
      `, [tolerance]);
      
      console.log(`   Can extend Edge 19 → Edge 13: ${extendTo13.rows[0].can_extend_start ? '✅ YES (start)' : '❌ NO (start)'} / ${extendTo13.rows[0].can_extend_end ? '✅ YES (end)' : '❌ NO (end)'}`);
      console.log(`   Distances: start=${extendTo13.rows[0].distance_start.toFixed(6)}, end=${extendTo13.rows[0].distance_end.toFixed(6)}`);
      
      if (extendTo13.rows[0].can_extend_start || extendTo13.rows[0].can_extend_end) {
        console.log('   Chain: [12, 19, 13] → Vertex 10');
        console.log('   ✅ FULL CHAIN DETECTED: 6 → 19 → 20 → 10');
      }
    }
    
    // Test 4: Check what degrees the validation logic would calculate
    console.log('\n🔍 Testing validation logic...');
    
    const validationTest = await pgClient.query(`
      WITH test_chain AS (
        SELECT 
          6 as start_vertex,
          10 as end_vertex,
          ARRAY[12, 19, 13] as chain_edges
      ),
      start_degree_check AS (
        SELECT 
          (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded e 
           WHERE ST_DWithin(ST_StartPoint(e.the_geom), v.the_geom, $1) 
              OR ST_DWithin(ST_EndPoint(e.the_geom), v.the_geom, $1)) as calculated_degree
        FROM test_chain tc
        JOIN ${TEST_SCHEMA}.ways_noded_vertices_pgr v ON tc.start_vertex = v.id
      ),
      end_degree_check AS (
        SELECT 
          (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded e 
           WHERE ST_DWithin(ST_StartPoint(e.the_geom), v.the_geom, $1) 
              OR ST_DWithin(ST_EndPoint(e.the_geom), v.the_geom, $1)) as calculated_degree
        FROM test_chain tc
        JOIN ${TEST_SCHEMA}.ways_noded_vertices_pgr v ON tc.end_vertex = v.id
      )
      SELECT 
        (SELECT calculated_degree FROM start_degree_check) as start_degree,
        (SELECT calculated_degree FROM end_degree_check) as end_degree
    `, [tolerance]);
    
    const startDegree = validationTest.rows[0].start_degree;
    const endDegree = validationTest.rows[0].end_degree;
    
    console.log(`   📊 Validation degrees:`);
    console.log(`      Start vertex (6): calculated degree = ${startDegree} (${[1, 3, 4, 5].includes(startDegree) ? '✅ VALID' : '❌ INVALID'})`);
    console.log(`      End vertex (10): calculated degree = ${endDegree} (${[1, 3, 4, 5].includes(endDegree) ? '✅ VALID' : '❌ INVALID'})`);
    
    const isValid = [1, 3, 4, 5].includes(startDegree) && [1, 3, 4, 5].includes(endDegree);
    console.log(`   Chain validation: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
    
    // Test 5: Check what edges are being counted for each vertex
    console.log('\n🔍 Checking edge counts for vertices...');
    
    const edgeCounts = await pgClient.query(`
      SELECT 
        v.id,
        v.cnt as stored_degree,
        COUNT(e.id) as calculated_degree,
        array_agg(e.id ORDER BY e.id) as connected_edges
      FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr v
      LEFT JOIN ${TEST_SCHEMA}.ways_noded e ON (e.source = v.id OR e.target = v.id)
      GROUP BY v.id, v.cnt
      ORDER BY v.id
    `);
    
    console.log('   📊 Edge counts:');
    edgeCounts.rows.forEach(v => {
      console.log(`      Vertex ${v.id}: stored=${v.stored_degree}, calculated=${v.calculated_degree}, edges=[${v.connected_edges.join(', ')}]`);
    });
    
    console.log('\n✅ Debug test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testDegree2Debug();
