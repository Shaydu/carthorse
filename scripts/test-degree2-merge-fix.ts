#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { EdgeProcessingService } from '../src/services/layer2/EdgeProcessingService';

// Test configuration
const TEST_SCHEMA = 'test_degree2_merge_fix';
const TEST_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'tester',
  password: process.env.PGPASSWORD || 'your_password_here'
};

async function testDegree2MergeFix() {
  console.log('🔧 Testing Degree-2 Merge Fix with EdgeProcessingService');
  console.log('======================================================');
  
  const pgClient = new Pool(TEST_CONFIG);
  
  try {
    // Step 1: Create test schema
    console.log('📋 Creating test schema...');
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Step 2: Create tables with proper structure
    console.log('📋 Creating test tables...');
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id BIGINT PRIMARY KEY,
        source BIGINT,
        target BIGINT,
        the_geom GEOMETRY(LINESTRING, 4326),
        length_km NUMERIC,
        elevation_gain NUMERIC,
        elevation_loss NUMERIC,
        name TEXT,
        app_uuid TEXT,
        old_id BIGINT
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id BIGINT PRIMARY KEY,
        the_geom GEOMETRY(POINT, 4326),
        cnt INTEGER
      )
    `);
    
    // Step 3: Insert test data - the exact problematic case from user
    console.log('📋 Inserting test data...');
    
    // Insert vertices
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, the_geom, cnt) VALUES
      (44, ST_GeomFromText('POINT(-105.267434 39.976661)', 4326), 1),
      (35, ST_GeomFromText('POINT(-105.276630268 39.97489484)', 4326), 2),
      (17, ST_GeomFromText('POINT(-105.283775 39.973602)', 4326), 1)
    `);
    
    // Insert edges - the exact data from user
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid) VALUES
      (916, 44, 35, ST_GeomFromText('LINESTRING(-105.267434 39.976661, -105.267549 39.97661, -105.267584 39.97652, -105.267488 39.975826, -105.26751 39.975484, -105.267497 39.975142, -105.267613 39.974988, -105.26787 39.974852, -105.268268 39.974734, -105.268724 39.974526, -105.269214 39.974074, -105.269424 39.973957, -105.269891 39.973487, -105.270008 39.973406, -105.270148 39.973351, -105.270382 39.973324, -105.271062 39.973484, -105.271168 39.973502, -105.271343 39.973493, -105.27153 39.973447, -105.272103 39.973203, -105.272606 39.973021, -105.272887 39.973021, -105.273532 39.973145, -105.274107 39.97363, -105.274518 39.973747, -105.274717 39.973827, -105.274917 39.973998, -105.27514 39.974241, -105.275258 39.97433, -105.275446 39.974429, -105.275985 39.974662, -105.276372 39.974778, -105.27663 39.974895)', 4326), 1.1252481604316273, 135, 2.759999990463257, 'NCAR - Bear Canyon Trail', '76650245-8959-475b-9527-40d86ffd2200'),
      (546, 35, 17, ST_GeomFromText('LINESTRING(-105.27663 39.974895, -105.277391 39.974848, -105.277813 39.974955, -105.278165 39.97499, -105.27888 39.97525, -105.279782 39.975185, -105.280215 39.97512, -105.280625 39.975156, -105.280976 39.975236, -105.281105 39.975235, -105.281292 39.975199, -105.281398 39.975226, -105.281598 39.975351, -105.281738 39.975333, -105.281901 39.975225, -105.282205 39.974926, -105.282497 39.974682, -105.283196 39.973951, -105.283593 39.973734, -105.283775 39.973602)', 4326), 0.7149166600315213, 38.59000015258789, 225.13999938964844, 'Mallory Cave Trail', '8f4446af-38fd-4a41-b489-ccb7a09a6055')
    `);
    
    // Step 4: Verify initial state
    console.log('📋 Verifying initial state...');
    const initialState = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr) as vertices,
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2) as degree2_vertices
    `);
    
    console.log(`   Initial state: ${initialState.rows[0].edges} edges, ${initialState.rows[0].vertices} vertices, ${initialState.rows[0].degree2_vertices} degree-2 vertices`);
    
    // Verify the specific problematic case exists
    const vertex35Exists = await pgClient.query(`
      SELECT id, cnt FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 35
    `);
    
    if (vertex35Exists.rows.length === 0) {
      console.log('   ❌ Vertex 35 not found - test data setup failed');
      return;
    }
    
    console.log(`   ✅ Vertex 35 exists with degree ${vertex35Exists.rows[0].cnt}`);
    
    // Step 5: Create EdgeProcessingService and test the merge
    console.log('🔧 Testing EdgeProcessingService merge logic...');
    
    const edgeProcessingService = new EdgeProcessingService({
      stagingSchema: TEST_SCHEMA,
      pgClient: pgClient
    });
    
    // Test the iterative merge function directly
    console.log('   🔄 Calling iterativeDegree2ChainMerge...');
    const chainsMerged = await edgeProcessingService['iterativeDegree2ChainMerge']();
    
    console.log(`   📊 Merge result: ${chainsMerged} chains merged`);
    
    // Step 6: Verify the fix worked
    console.log('🔍 Verifying the fix...');
    
    // Check final state
    const finalState = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr) as vertices,
        (SELECT COUNT(*) FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2) as degree2_vertices
    `);
    
    console.log(`   Final state: ${finalState.rows[0].edges} edges, ${finalState.rows[0].vertices} vertices, ${finalState.rows[0].degree2_vertices} degree-2 vertices`);
    
    // Check if vertex 35 was removed
    const vertex35StillExists = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 35
    `);
    
    if (parseInt(vertex35StillExists.rows[0].count) === 0) {
      console.log('   ✅ Vertex 35 was successfully removed');
    } else {
      console.log('   ❌ Vertex 35 still exists - merge failed');
    }
    
    // Check if edges 916 and 546 were replaced with a new edge
    const oldEdgesExist = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.ways_noded WHERE id IN (916, 546)
    `);
    
    if (parseInt(oldEdgesExist.rows[0].count) === 0) {
      console.log('   ✅ Original edges 916 and 546 were removed');
    } else {
      console.log('   ❌ Original edges still exist - merge failed');
    }
    
    // Check for new merged edge
    const newEdge = await pgClient.query(`
      SELECT id, source, target, length_km, name FROM ${TEST_SCHEMA}.ways_noded WHERE app_uuid LIKE 'merged-degree2-vertex-%'
    `);
    
    if (newEdge.rows.length > 0) {
      const edge = newEdge.rows[0];
      console.log(`   ✅ New merged edge created: ID ${edge.id}, ${edge.source} -> ${edge.target}, length: ${edge.length_km}, name: ${edge.name}`);
      
      // Verify the merged edge connects the correct endpoints
      if ((edge.source === 44 && edge.target === 17) || (edge.source === 17 && edge.target === 44)) {
        console.log('   ✅ Merged edge connects correct endpoints (44 <-> 17)');
      } else {
        console.log(`   ❌ Merged edge has wrong endpoints: ${edge.source} -> ${edge.target}, expected 44 <-> 17`);
      }
      
      // Verify the length is approximately correct (sum of original edges)
      const expectedLength = 1.1252481604316273 + 0.7149166600315213;
      const actualLength = parseFloat(edge.length_km);
      const lengthDiff = Math.abs(actualLength - expectedLength);
      
      if (lengthDiff < 0.001) {
        console.log(`   ✅ Merged edge length is correct: ${actualLength} (expected ~${expectedLength})`);
      } else {
        console.log(`   ❌ Merged edge length is wrong: ${actualLength} (expected ~${expectedLength})`);
      }
    } else {
      console.log('   ❌ No new merged edge found');
    }
    
    // Step 7: Test that no degree-2 vertices remain
    const remainingDegree2 = await pgClient.query(`
      SELECT id, cnt FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE cnt = 2
    `);
    
    if (remainingDegree2.rows.length === 0) {
      console.log('   ✅ No degree-2 vertices remain - merge was complete');
    } else {
      console.log(`   ❌ ${remainingDegree2.rows.length} degree-2 vertices still remain:`, remainingDegree2.rows.map(v => `ID ${v.id} (degree ${v.cnt})`));
    }
    
    // Step 8: Summary
    console.log('\n📊 TEST SUMMARY:');
    console.log('================');
    
    const initialEdges = parseInt(initialState.rows[0].edges);
    const finalEdges = parseInt(finalState.rows[0].edges);
    const edgesMerged = initialEdges - finalEdges;
    
    const initialVertices = parseInt(initialState.rows[0].vertices);
    const finalVertices = parseInt(finalState.rows[0].vertices);
    const verticesRemoved = initialVertices - finalVertices;
    
    console.log(`   Initial: ${initialEdges} edges, ${initialVertices} vertices`);
    console.log(`   Final: ${finalEdges} edges, ${finalVertices} vertices`);
    console.log(`   Merged: ${edgesMerged} edges, removed ${verticesRemoved} vertices`);
    console.log(`   Chains merged: ${chainsMerged}`);
    
    if (chainsMerged > 0 && edgesMerged === 1 && verticesRemoved === 1) {
      console.log('   ✅ TEST PASSED: Degree-2 merge fix is working correctly!');
    } else {
      console.log('   ❌ TEST FAILED: Degree-2 merge fix is not working correctly');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testDegree2MergeFix().catch(console.error);
