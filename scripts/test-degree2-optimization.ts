#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

const TEST_SCHEMA = 'test_degree2_optimization';

async function testDegree2Optimization() {
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('🧪 Testing degree 2 optimization in export pipeline...');
    console.log(`📊 Using database: ${dbConfig.database}`);
    
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
    
    // Insert test data: Create a simple degree-2 chain
    console.log('📊 Creating test network with degree-2 connector...');
    
    // Create vertices
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, the_geom, cnt) VALUES
      (1, ST_GeomFromText('POINT(-105.267434 39.976661)', 4326), 1),  -- Start endpoint
      (2, ST_GeomFromText('POINT(-105.276630268 39.97489484)', 4326), 2),  -- Degree-2 connector
      (3, ST_GeomFromText('POINT(-105.283775 39.973602)', 4326), 1)   -- End endpoint
    `);
    
    // Create edges
    await pool.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid) VALUES
      (1, 1, 2, ST_GeomFromText('LINESTRING(-105.267434 39.976661, -105.276630268 39.97489484)', 4326), 1.0, 100, 50, 'Test Trail 1', 'test-trail-1'),
      (2, 2, 3, ST_GeomFromText('LINESTRING(-105.276630268 39.97489484, -105.283775 39.973602)', 4326), 0.8, 80, 40, 'Test Trail 2', 'test-trail-2')
    `);
    
    // Show initial state
    console.log('\n📋 Initial network state:');
    const initialEdges = await pool.query(`SELECT id, source, target, name, length_km FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    console.log('Edges:', initialEdges.rows);
    
    const initialVertices = await pool.query(`SELECT id, cnt as degree FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    console.log('Vertices:', initialVertices.rows);
    
    // Test the degree-2 optimization
    console.log('\n🔗 Testing degree-2 optimization...');
    
    const { EdgeProcessingService } = await import('../src/services/layer2/EdgeProcessingService');
    
    const edgeService = new EdgeProcessingService({
      stagingSchema: TEST_SCHEMA,
      pgClient: pool
    });
    
    const chainsMerged = await edgeService.iterativeDegree2ChainMerge();
    
    console.log(`\n✅ Optimization completed: ${chainsMerged} chains merged`);
    
    // Show final state
    console.log('\n📋 Final network state:');
    const finalEdges = await pool.query(`SELECT id, source, target, name, app_uuid, length_km FROM ${TEST_SCHEMA}.ways_noded ORDER BY id`);
    console.log('Edges:', finalEdges.rows);
    
    const finalVertices = await pool.query(`SELECT id, cnt as degree FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr ORDER BY id`);
    console.log('Vertices:', finalVertices.rows);
    
    // Verify the results
    console.log('\n🔍 Verification:');
    
    // Check if degree-2 connector was removed
    const degree2VertexRemoved = !finalVertices.rows.some(v => v.id === 2);
    console.log(`Degree-2 connector (node 2) removed: ${degree2VertexRemoved ? '✅ YES' : '❌ NO'}`);
    
    // Check if original edges were removed
    const originalEdgesRemoved = !finalEdges.rows.some(e => e.id === 1 || e.id === 2);
    console.log(`Original edges (1, 2) removed: ${originalEdgesRemoved ? '✅ YES' : '❌ NO'}`);
    
    // Check if a new merged edge was created
    const mergedEdgeCreated = finalEdges.rows.length === 1;
    console.log(`Merged edge created: ${mergedEdgeCreated ? '✅ YES' : '❌ NO'}`);
    
    // Check if the merged edge connects the correct endpoints
    const correctEndpoints = finalEdges.rows.length === 1 && 
      (finalEdges.rows[0].source === 1 && finalEdges.rows[0].target === 3) ||
      (finalEdges.rows[0].source === 3 && finalEdges.rows[0].target === 1);
    console.log(`Correct endpoints (1 ↔ 3): ${correctEndpoints ? '✅ YES' : '❌ NO'}`);
    
    // Check if the merged edge has the correct combined length
    const correctLength = finalEdges.rows.length === 1 && 
      Math.abs(finalEdges.rows[0].length_km - 1.8) < 0.1;
    console.log(`Correct combined length (~1.8 km): ${correctLength ? '✅ YES' : '❌ NO'}`);
    
    console.log(`\n📊 Final network: ${finalEdges.rows.length} edges, ${finalVertices.rows.length} vertices`);
    
    // Overall success criteria
    const success = degree2VertexRemoved && originalEdgesRemoved && mergedEdgeCreated && correctEndpoints && correctLength;
    
    if (success) {
      console.log('✅ Test PASSED: Degree-2 optimization working correctly');
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
testDegree2Optimization().catch(console.error);
