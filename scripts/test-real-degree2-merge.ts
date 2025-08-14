#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { EdgeProcessingService } from '../src/services/layer2/EdgeProcessingService';

const TEST_SCHEMA = 'test_real_degree2_merge';

async function testRealDegree2Merge() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here'
  });

  try {
    console.log('🧪 Testing degree-2 merge with real problematic data...');
    console.log(`📊 Using database: ${process.env.PGDATABASE || 'trail_master_db'}`);
    console.log(`👤 Using user: ${process.env.PGUSER || 'tester'}`);
    
    // Create test schema
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create test tables
    await pool.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id SERIAL PRIMARY KEY,
        source INTEGER,
        target INTEGER,
        the_geom GEOMETRY(LINESTRING, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION DEFAULT 0.0,
        elevation_loss DOUBLE PRECISION DEFAULT 0.0,
        app_uuid TEXT,
        name TEXT,
        old_id BIGINT
      )
    `);
    
    await pool.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id SERIAL PRIMARY KEY,
        the_geom GEOMETRY(POINT, 4326),
        cnt INTEGER DEFAULT 0
      )
    `);
    
    // Create spatial indexes
    await pool.query(`CREATE INDEX ON ${TEST_SCHEMA}.ways_noded USING GIST (the_geom)`);
    await pool.query(`CREATE INDEX ON ${TEST_SCHEMA}.ways_noded_vertices_pgr USING GIST (the_geom)`);
    
    // Insert real data: Create vertices based on the real scenario
    console.log('📊 Creating test network with real degree-2 connector data...');
    
    // Create vertices - using the real coordinates
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, the_geom, cnt) VALUES
      (44, ST_GeomFromText('POINT(-105.267434 39.976661)', 4326), 1),  -- Start of NCAR trail
      (35, ST_GeomFromText('POINT(-105.276630268 39.97489484)', 4326), 2),  -- Degree-2 connector (blue node)
      (17, ST_GeomFromText('POINT(-105.283775 39.973602)', 4326), 1)   -- End of Mallory Cave Trail
    `);
    
    // Create edges using the real geometries and correct IDs
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid) VALUES
      (916, 44, 35, ST_GeomFromText('LINESTRING(-105.267434 39.976661, -105.267549 39.97661, -105.267584 39.97652, -105.267488 39.975826, -105.26751 39.975484, -105.267497 39.975142, -105.267613 39.974988, -105.26787 39.974852, -105.268268 39.974734, -105.268724 39.974526, -105.269214 39.974074, -105.269424 39.973957, -105.269891 39.973487, -105.270008 39.973406, -105.270148 39.973351, -105.270382 39.973324, -105.271062 39.973484, -105.271168 39.973502, -105.271343 39.973493, -105.27153 39.973447, -105.272103 39.973203, -105.272606 39.973021, -105.272887 39.973021, -105.273532 39.973145, -105.274107 39.97363, -105.274518 39.973747, -105.274717 39.973827, -105.274917 39.973998, -105.27514 39.974241, -105.275258 39.97433, -105.275446 39.974429, -105.275985 39.974662, -105.276372 39.974778, -105.27663 39.974895)', 4326), 1.1252481604316273, 135, 2.759999990463257, 'NCAR - Bear Canyon Trail', '76650245-8959-475b-9527-40d86ffd2200'),
      (546, 35, 17, ST_GeomFromText('LINESTRING(-105.27663 39.974895, -105.277391 39.974848, -105.277813 39.974955, -105.278165 39.97499, -105.27888 39.97525, -105.279782 39.975185, -105.280215 39.97512, -105.280625 39.975156, -105.280976 39.975236, -105.281105 39.975235, -105.281292 39.975199, -105.281398 39.975226, -105.281598 39.975351, -105.281738 39.975333, -105.281901 39.975225, -105.282205 39.974926, -105.282497 39.974682, -105.283196 39.973951, -105.283593 39.973734, -105.283775 39.973602)', 4326), 0.7149166600315213, 38.59000015258789, 225.13999938964844, 'Mallory Cave Trail', '8f4446af-38fd-4a41-b489-ccb7a09a6055')
    `);
    
    // Show initial state
    console.log('\n📋 Initial network state:');
    const initialEdges = await pool.query(`SELECT id, source, target, name, length_km FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    console.log('Edges:', initialEdges.rows);
    
    const initialVertices = await pool.query(`SELECT id, cnt as degree FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    console.log('Vertices:', initialVertices.rows);
    
    // Test the degree-2 endpoint merge
    console.log('\n🔗 Testing degree-2 endpoint merge with real data...');
    
    const edgeService = new EdgeProcessingService({
      stagingSchema: TEST_SCHEMA,
      pgClient: pool
    });
    
    // Call the private method using reflection (for testing)
    const mergeResult = await (edgeService as any).iterativeDegree2ChainMerge();
    
    console.log(`\n✅ Merge completed: ${mergeResult} pairs merged`);
    
    // Show final state
    console.log('\n📋 Final network state:');
    const finalEdges = await pool.query(`SELECT id, source, target, name, app_uuid, length_km FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    console.log('Edges:', finalEdges.rows);
    
    const finalVertices = await pool.query(`SELECT id, cnt as degree FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    console.log('Vertices:', finalVertices.rows);
    
    // Verify the results
    console.log('\n🔍 Verification:');
    
    // Check if degree-2 connector was removed
    const degree2VertexRemoved = !finalVertices.rows.some(v => v.id === 35);
    console.log(`Degree-2 connector (node 35) removed: ${degree2VertexRemoved ? '✅ YES' : '❌ NO'}`);
    
    // Check if original edges were removed
    const originalEdgesRemoved = !finalEdges.rows.some(e => e.id === 916 || e.id === 546);
    console.log(`Original edges (916, 546) removed: ${originalEdgesRemoved ? '✅ YES' : '❌ NO'}`);
    
    // Check if a new merged edge was created
    const mergedEdgeCreated = finalEdges.rows.length === 1 && finalEdges.rows[0].id === 917;
    console.log(`Merged edge (917) created: ${mergedEdgeCreated ? '✅ YES' : '❌ NO'}`);
    
    // Check if the merged edge connects the correct endpoints
    const correctEndpoints = finalEdges.rows.length === 1 && 
      (finalEdges.rows[0].source === 17 && finalEdges.rows[0].target === 44) ||
      (finalEdges.rows[0].source === 44 && finalEdges.rows[0].target === 17);
    console.log(`Correct endpoints (17 ↔ 44): ${correctEndpoints ? '✅ YES' : '❌ NO'}`);
    
    // Check if the merged edge has the correct combined length
    const correctLength = finalEdges.rows.length === 1 && 
      Math.abs(finalEdges.rows[0].length_km - 1.8401648204631487) < 0.001;
    console.log(`Correct combined length (~1.84 km): ${correctLength ? '✅ YES' : '❌ NO'}`);
    
    console.log(`\n📊 Final network: ${finalEdges.rows.length} edges, ${finalVertices.rows.length} vertices`);
    
    // Overall success criteria
    const success = degree2VertexRemoved && originalEdgesRemoved && mergedEdgeCreated && correctEndpoints && correctLength;
    
    if (success) {
      console.log('✅ Test PASSED: Degree-2 vertex successfully merged and cleaned up');
    } else {
      console.log('❌ Test FAILED: Expected connector removal and edge merging');
    }
    
  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testRealDegree2Merge().catch(console.error);
