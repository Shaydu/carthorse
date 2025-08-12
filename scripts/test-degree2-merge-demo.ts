#!/usr/bin/env ts-node
/**
 * Degree2 Merge Demo Test
 * 
 * This script demonstrates the degree2 merge functionality by:
 * 1. Creating fragmented edges that should be merged
 * 2. Running the degree2 merge process
 * 3. Showing before/after results
 */

import { Pool } from 'pg';
import { mergeDegree2Chains } from '../src/utils/services/network-creation/merge-degree2-chains';

// Test configuration
const TEST_SCHEMA = 'test_degree2_demo';
const SOURCE_SCHEMA = 'public'; // Read from public schema
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || ''
};

async function createTestData(pgClient: Pool, schema: string) {
  console.log('🔧 Creating test data with Mesa Trail fragments...');
  
  // Create test schema
  await pgClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pgClient.query(`CREATE SCHEMA ${schema}`);
  
  // Create ways_noded table with Mesa Trail fragments
  await pgClient.query(`
    CREATE TABLE ${schema}.ways_noded (
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
  
  // Insert Mesa Trail fragments with overlapping and fragmented data
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
    -- Fragment 1: Start of Mesa Trail
    (1, 1, 2, ST_GeomFromText('LINESTRING(-105.284218 39.977986, -105.284376 39.97767, -105.284406 39.977491, -105.284296 39.977289, -105.284289 39.977004, -105.284192 39.976672, -105.284242 39.976537, -105.284179 39.976425, -105.284006 39.976317, -105.28378 39.976262, -105.283417 39.976038, -105.283181 39.975808, -105.283041 39.975578, -105.282955 39.975389, -105.282956 39.975195, -105.283084 39.975019, -105.283143 39.97475, -105.28324 39.974541, -105.283333 39.974266, -105.283647 39.974089, -105.283653 39.974049, -105.283577 39.973964, -105.283603 39.973877, -105.283716 39.973755, -105.283771 39.973639, -105.283763 39.973578)', 4326), 0.668, 0, 0, 'Mesa Trail', 'mesa-fragment-1', NULL),
    
    -- Fragment 2: Middle section (overlaps with fragment 1)
    (2, 2, 3, ST_GeomFromText('LINESTRING(-105.283763 39.973578, -105.283877 39.973494, -105.284034 39.973363, -105.284095 39.973268, -105.28415 39.973176, -105.284175 39.97308, -105.284225 39.972982, -105.284266 39.972894, -105.284257 39.972808, -105.284052 39.972754, -105.283697 39.972843, -105.283598 39.972849, -105.283527 39.972835, -105.283359 39.972733, -105.283148 39.972465, -105.283037 39.972292, -105.282912 39.972148, -105.282811 39.97209, -105.282739 39.971792, -105.282558 39.971708, -105.28248 39.971644, -105.282412 39.97154, -105.282411 39.971438, -105.282509 39.970798, -105.28254 39.97066, -105.282614 39.970601, -105.282744 39.970606, -105.282965 39.970726, -105.283231 39.970914, -105.283362 39.971056, -105.28344 39.971107)', 4326), 0.544, 0, 0, 'Mesa Trail', 'mesa-fragment-2', NULL),
    
    -- Fragment 3: End section (connects to fragment 2)
    (3, 3, 4, ST_GeomFromText('LINESTRING(-105.28344 39.971107, -105.283599 39.971168, -105.283662 39.971153, -105.283702 39.971054, -105.283689 39.970967, -105.283595 39.970745, -105.283457 39.970493, -105.283426 39.970243, -105.283474 39.970168, -105.283524 39.970022, -105.28352 39.969916, -105.283491 39.969818, -105.283366 39.969589, -105.283261 39.969494, -105.283124 39.96945, -105.282966 39.969438, -105.282629 39.969393, -105.282307 39.969401, -105.282014 39.96942)', 4326), 0.511, 0, 0, 'Mesa Trail', 'mesa-fragment-3', NULL),
    
    -- Fragment 4: Alternative route (creates degree-2 chain)
    (4, 5, 6, ST_GeomFromText('LINESTRING(-105.285329 39.982294, -105.285245 39.982189, -105.285123 39.981942, -105.284894 39.981651, -105.284581 39.981161, -105.28429 39.980818, -105.284184 39.980739, -105.284061 39.9806, -105.283965 39.980473, -105.283869 39.980286, -105.28391 39.980106, -105.284145 39.979777, -105.284509 39.979646, -105.284692 39.979528, -105.28474 39.979429, -105.284844 39.979335, -105.284871 39.979212, -105.284687 39.979291, -105.284619 39.979305, -105.284482 39.979246, -105.28433 39.979212, -105.284082 39.979213, -105.28394 39.979184, -105.283815 39.979103)', 4326), 0.511, 0, 0, 'Mesa Trail', 'mesa-fragment-4', NULL),
    
    -- Fragment 5: Connector to create degree-2 chain
    (5, 6, 1, ST_GeomFromText('LINESTRING(-105.283815 39.979103, -105.283815 39.979103, -105.284218 39.977986)', 4326), 0.001, 0, 0, 'Mesa Trail', 'mesa-connector', NULL)
  `);
  
  // Create vertices table
  await pgClient.query(`
    CREATE TABLE ${schema}.ways_noded_vertices_pgr (
      id bigint PRIMARY KEY,
      cnt integer,
      chk integer,
      ein integer,
      eout integer,
      the_geom geometry(Point,4326)
    )
  `);
  
  // Insert vertices for all the edges
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
    (1, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.284218 39.977986)', 4326)),
    (2, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.283763 39.973578)', 4326)),
    (3, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.28344 39.971107)', 4326)),
    (4, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.282014 39.96942)', 4326)),
    (5, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.285329 39.982294)', 4326)),
    (6, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.283815 39.979103)', 4326))
  `);
  
  // Recompute vertex degrees
  await pgClient.query(`
    UPDATE ${schema}.ways_noded_vertices_pgr v
    SET cnt = (
      SELECT COUNT(*) FROM ${schema}.ways_noded e
      WHERE e.source = v.id OR e.target = v.id
    )
  `);
  
  console.log('✅ Mesa Trail test data created successfully');
  console.log('📋 Test scenario:');
  console.log('   - Fragment 1: Start of Mesa Trail (endpoint at vertex 1)');
  console.log('   - Fragment 2: Middle section (connects to fragment 1, overlaps)');
  console.log('   - Fragment 3: End section (connects to fragment 2, endpoint at vertex 4)');
  console.log('   - Fragment 4: Alternative route (creates degree-2 chain)');
  console.log('   - Fragment 5: Connector (creates degree-2 chain)');
  console.log('   Expected result: Single continuous edge from vertex 1 to vertex 4');
}

async function showBeforeState(pgClient: Pool, schema: string) {
  console.log('\n📊 BEFORE Degree2 Merge:');
  console.log('========================');
  
  // Show vertices
  const vertices = await pgClient.query(`
    SELECT id, cnt as degree, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded_vertices_pgr
    ORDER BY id
  `);
  
  console.log('\nVertices:');
  vertices.rows.forEach((v: any) => {
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
  edges.rows.forEach((e: any) => {
    console.log(`  ${e.id}: ${e.source} -> ${e.target} (${e.name}, ${e.length_km}km) - ${e.geom}`);
  });
  
  // Show degree-2 chains (simplified)
  console.log('\nDetected Degree-2 Chains:');
  console.log('  Checking for degree-2 vertices...');
  
  const degree2Vertices = await pgClient.query(`
    SELECT id, cnt as degree, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded_vertices_pgr
    WHERE cnt = 2
    ORDER BY id
  `);
  
  if (degree2Vertices.rows.length === 0) {
    console.log('  No degree-2 vertices detected');
  } else {
    console.log(`  Found ${degree2Vertices.rows.length} degree-2 vertices:`);
    degree2Vertices.rows.forEach((v: any) => {
      console.log(`    Vertex ${v.id} at ${v.geom}`);
    });
  }
}

async function showAfterState(pgClient: Pool, schema: string) {
  console.log('\n📊 AFTER Degree2 Merge:');
  console.log('=======================');
  
  // Show vertices
  const vertices = await pgClient.query(`
    SELECT id, cnt as degree, ST_AsText(the_geom) as geom
    FROM ${schema}.ways_noded_vertices_pgr
    ORDER BY id
  `);
  
  console.log('\nVertices:');
  vertices.rows.forEach((v: any) => {
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
  edges.rows.forEach((e: any) => {
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

export { runDemo };
