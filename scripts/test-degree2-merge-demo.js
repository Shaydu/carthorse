#!/usr/bin/env node
/**
 * Degree2 Merge Demo Test
 * 
 * This script demonstrates the degree2 merge functionality by:
 * 1. Creating fragmented edges that should be merged
 * 2. Running the degree2 merge process
 * 3. Showing before/after results
 */

const { Pool } = require('pg');
const { mergeDegree2Chains } = require('../dist/utils/services/network-creation/merge-degree2-chains');

// Test configuration
const TEST_SCHEMA = 'test_degree2_demo';
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
};

async function createTestData(pgClient, schema) {
  console.log('🔧 Creating test data...');
  
  // Create test schema
  await pgClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pgClient.query(`CREATE SCHEMA ${schema}`);
  
  // Create ways_noded table (simplified version)
  await pgClient.query(`
    CREATE TABLE ${schema}.ways_noded (
      id BIGINT PRIMARY KEY,
      source INTEGER,
      target INTEGER,
      the_geom GEOMETRY(LINESTRING, 4326),
      length_km REAL,
      elevation_gain REAL,
      elevation_loss REAL,
      name TEXT,
      app_uuid TEXT,
      old_id BIGINT
    )
  `);
  
  // Create ways_noded_vertices_pgr table
  await pgClient.query(`
    CREATE TABLE ${schema}.ways_noded_vertices_pgr (
      id INTEGER PRIMARY KEY,
      cnt INTEGER,
      chk INTEGER,
      ein INTEGER,
      eout INTEGER,
      the_geom GEOMETRY(POINT, 4326)
    )
  `);
  
  // Insert test vertices (endpoints and intersections)
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded_vertices_pgr (id, cnt, the_geom) VALUES
    (1, 1, ST_SetSRID(ST_MakePoint(-105.28, 39.97), 4326)),   -- Endpoint A
    (2, 2, ST_SetSRID(ST_MakePoint(-105.275, 39.97), 4326)),  -- Degree-2 vertex (should be merged)
    (3, 2, ST_SetSRID(ST_MakePoint(-105.27, 39.97), 4326)),   -- Degree-2 vertex (should be merged)
    (4, 2, ST_SetSRID(ST_MakePoint(-105.265, 39.97), 4326)),  -- Degree-2 vertex (should be merged)
    (5, 3, ST_SetSRID(ST_MakePoint(-105.26, 39.97), 4326)),   -- Intersection B
    (6, 1, ST_SetSRID(ST_MakePoint(-105.28, 39.975), 4326)),  -- Endpoint C
    (7, 2, ST_SetSRID(ST_MakePoint(-105.275, 39.975), 4326)), -- Degree-2 vertex (should be merged)
    (8, 3, ST_SetSRID(ST_MakePoint(-105.27, 39.975), 4326))   -- Intersection D
  `);
  
  // Insert fragmented edges that should be merged
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid) VALUES
    -- Chain 1: Endpoint A -> Intersection B (3 fragmented edges)
    (1, 1, 2, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.28, 39.97), ST_MakePoint(-105.275, 39.97)), 4326), 0.5, 10, 5, 'Trail Segment 1', 'trail-1'),
    (2, 2, 3, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.275, 39.97), ST_MakePoint(-105.27, 39.97)), 4326), 0.4, 8, 4, 'Trail Segment 2', 'trail-2'),
    (3, 3, 4, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.27, 39.97), ST_MakePoint(-105.265, 39.97)), 4326), 0.4, 7, 3, 'Trail Segment 3', 'trail-3'),
    (4, 4, 5, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.265, 39.97), ST_MakePoint(-105.26, 39.97)), 4326), 0.3, 5, 2, 'Trail Segment 4', 'trail-4'),
    
    -- Chain 2: Endpoint C -> Intersection D (2 fragmented edges)
    (5, 6, 7, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.28, 39.975), ST_MakePoint(-105.275, 39.975)), 4326), 0.4, 6, 3, 'Trail Segment 5', 'trail-5'),
    (6, 7, 8, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.275, 39.975), ST_MakePoint(-105.27, 39.975)), 4326), 0.4, 5, 2, 'Trail Segment 6', 'trail-6'),
    
    -- Overlapping edge (should be detected and removed)
    (7, 1, 5, ST_SetSRID(ST_MakeLine(ST_MakePoint(-105.28, 39.97), ST_MakePoint(-105.26, 39.97)), 4326), 1.6, 30, 14, 'Overlapping Trail', 'overlap-1')
  `);
  
  console.log('✅ Test data created successfully');
}

async function showBeforeState(pgClient, schema) {
  console.log('\n📊 BEFORE Degree2 Merge:');
  console.log('========================');
  
  // Show vertices
  const vertices = await pgClient.query(`
    SELECT id, cnt as degree, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded_vertices_pgr
    ORDER BY id
  `);
  
  console.log('\nVertices:');
  vertices.rows.forEach(v => {
    const type = v.degree === 1 ? 'ENDPOINT' : v.degree === 2 ? 'DEGREE-2' : 'INTERSECTION';
    console.log(`  ${v.id}: ${type} (degree ${v.degree}) at ${v.geom}`);
  });
  
  // Show edges
  const edges = await pgClient.query(`
    SELECT id, source, target, name, length_km, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded
    ORDER BY id
  `);
  
  console.log('\nEdges:');
  edges.rows.forEach(e => {
    console.log(`  ${e.id}: ${e.source} -> ${e.target} (${e.name}, ${e.length_km}km) - ${e.geom}`);
  });
  
  // Show degree-2 chains
  const chains = await pgClient.query(`
    WITH RECURSIVE 
    trail_chains AS (
      SELECT 
        e.id as edge_id,
        e.source as start_vertex,
        e.target as current_vertex,
        ARRAY[e.id] as chain_edges,
        ARRAY[e.source, e.target] as chain_vertices,
        e.the_geom as chain_geom,
        e.length_km as total_length,
        e.name
      FROM ${schema}.ways_noded e
      WHERE e.source != e.target
      
      UNION ALL
      
      SELECT 
        next_e.id as edge_id,
        tc.start_vertex,
        CASE 
          WHEN next_e.source = tc.current_vertex THEN next_e.target
          ELSE next_e.source
        END as current_vertex,
        tc.chain_edges || next_e.id as chain_edges,
        tc.chain_vertices || CASE 
          WHEN next_e.source = tc.current_vertex THEN next_e.target
          ELSE next_e.source
        END as chain_vertices,
        ST_LineMerge(ST_Union(tc.chain_geom, next_e.the_geom)) as chain_geom,
        tc.total_length + next_e.length_km as total_length,
        tc.name
      FROM trail_chains tc
      JOIN ${schema}.ways_noded next_e ON 
        (next_e.source = tc.current_vertex OR next_e.target = tc.current_vertex)
      WHERE 
        next_e.id != ALL(tc.chain_edges)
        AND next_e.source != next_e.target
        AND ST_DWithin(ST_EndPoint(tc.chain_geom), ST_StartPoint(next_e.the_geom), 0.00005)
        AND array_length(tc.chain_edges, 1) < 10
    )
    SELECT 
      start_vertex,
      current_vertex as end_vertex,
      array_length(chain_edges, 1) as chain_length,
      chain_edges,
      total_length,
      name
    FROM trail_chains
    WHERE array_length(chain_edges, 1) >= 2
    ORDER BY array_length(chain_edges, 1) DESC
  `);
  
  console.log('\nDetected Degree-2 Chains:');
  if (chains.rows.length === 0) {
    console.log('  No degree-2 chains detected');
  } else {
    chains.rows.forEach((chain, index) => {
      console.log(`  Chain ${index + 1}: ${chain.start_vertex} -> ${chain.end_vertex} (${chain.chain_length} edges, ${chain.total_length}km)`);
      console.log(`    Edges: [${chain.chain_edges.join(', ')}]`);
    });
  }
}

async function showAfterState(pgClient, schema) {
  console.log('\n📊 AFTER Degree2 Merge:');
  console.log('=======================');
  
  // Show vertices
  const vertices = await pgClient.query(`
    SELECT id, cnt as degree, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded_vertices_pgr
    ORDER BY id
  `);
  
  console.log('\nVertices:');
  vertices.rows.forEach(v => {
    const type = v.degree === 1 ? 'ENDPOINT' : v.degree === 2 ? 'DEGREE-2' : 'INTERSECTION';
    console.log(`  ${v.id}: ${type} (degree ${v.degree}) at ${v.geom}`);
  });
  
  // Show edges
  const edges = await pgClient.query(`
    SELECT id, source, target, name, length_km, app_uuid, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded
    ORDER BY id
  `);
  
  console.log('\nEdges:');
  edges.rows.forEach(e => {
    const isMerged = e.app_uuid && e.app_uuid.startsWith('merged-degree2-chain');
    const marker = isMerged ? '🔗' : '  ';
    console.log(`${marker} ${e.id}: ${e.source} -> ${e.target} (${e.name}, ${e.length_km}km) - ${e.geom}`);
    if (isMerged) {
      console.log(`     MERGED: ${e.app_uuid}`);
    }
  });
  
  // Count merged chains
  const mergedCount = await pgClient.query(`
    SELECT COUNT(*) as count
    FROM ${schema}.ways_noded
    WHERE app_uuid LIKE 'merged-degree2-chain-%'
  `);
  
  console.log(`\n🔗 Merged ${mergedCount.rows[0].count} degree-2 chains`);
}

async function runDemo() {
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    console.log('🚀 Degree2 Merge Demo Test');
    console.log('==========================');
    
    // Connect to database
    await pgClient.connect();
    console.log('✅ Connected to database');
    
    // Create test data
    await createTestData(pgClient, TEST_SCHEMA);
    
    // Show before state
    await showBeforeState(pgClient, TEST_SCHEMA);
    
    // Run degree2 merge
    console.log('\n🔄 Running degree2 merge...');
    const result = await mergeDegree2Chains(pgClient, TEST_SCHEMA);
    console.log(`✅ Merge completed: ${result.chainsMerged} chains merged, ${result.edgesRemoved} edges removed`);
    
    // Show after state
    await showAfterState(pgClient, TEST_SCHEMA);
    
    console.log('\n🎉 Demo completed successfully!');
    
  } catch (error) {
    console.error('❌ Error in demo:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the demo if this script is executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo };
