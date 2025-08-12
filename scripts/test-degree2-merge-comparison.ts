#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { mergeDegree2Chains, deduplicateSharedVertices } from '../src/utils/services/network-creation/merge-degree2-chains';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const SCHEMA_1 = 'test_degree2_dataset_1';
const SCHEMA_2 = 'test_degree2_dataset_2';

async function createDataset1(pgClient: Pool, schema: string) {
  console.log('🔧 Creating Dataset 1: Simple overlapping edges that should be deduplicated...');
  
  await pgClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pgClient.query(`CREATE SCHEMA ${schema}`);
  
  // Create ways_noded table
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
  
  // Insert test data: Two edges that share a vertex and have overlapping geometry
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
    -- Edge 1: Longer edge that should be kept
    (1, 1, 2, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232399 39.950355, -105.232288 39.950351, -105.232218 39.950308, -105.232196 39.950245, -105.232235 39.950179, -105.232272 39.950158, -105.232434 39.950119, -105.232508 39.950062, -105.232551 39.94997, -105.232587 39.949902, -105.232688 39.949853, -105.232708 39.949825, -105.232703 39.949738, -105.23272 39.949658, -105.232744 39.949599, -105.23278 39.949517, -105.232794 39.949444, -105.232894 39.949388, -105.232946 39.94933, -105.232981 39.949264, -105.233102 39.949217, -105.23317 39.949177, -105.233237 39.949115, -105.233272 39.949053, -105.233284 39.949012, -105.233293 39.948971, -105.233338 39.948941, -105.233452 39.948891, -105.2335 39.948834, -105.233568 39.94877, -105.23359 39.948691, -105.233583 39.948558, -105.233615 39.948501, -105.233798 39.94836, -105.233896 39.948296, -105.233958 39.948224, -105.234082 39.948099, -105.23415 39.948039, -105.234251 39.947889, -105.234283 39.947821, -105.234329 39.947783, -105.234382 39.947734, -105.234412 39.947694, -105.234415 39.947633, -105.234483 39.947567, -105.234594 39.947428, -105.234602 39.947336, -105.234636 39.947283, -105.234608 39.947192, -105.23463 39.947158, -105.234686 39.947148, -105.234788 39.947112, -105.234891 39.946996, -105.234997 39.946882, -105.235048 39.946737, -105.235156 39.946665, -105.235384 39.946611, -105.235478 39.946573, -105.235572 39.946514, -105.235623 39.946468, -105.235707 39.946424, -105.235897 39.946366, -105.236134 39.946341, -105.236228 39.946312, -105.236297 39.946266, -105.236343 39.946148)', 4326), 0.662, 44, 44, 'Coal Seam Trail', 'coal-seam-long', NULL),
    
    -- Edge 2: Shorter edge that overlaps with edge 1 and shares vertex 2
    (2, 2, 3, ST_GeomFromText('LINESTRING(-105.236343 39.946148, -105.236134 39.946341, -105.235897 39.946366, -105.235707 39.946424, -105.235623 39.946468, -105.235572 39.946514, -105.235478 39.946573, -105.235384 39.946611, -105.235156 39.946665, -105.235048 39.946737, -105.234997 39.946882, -105.234891 39.946996, -105.234788 39.947112, -105.234686 39.947148, -105.23463 39.947158, -105.234608 39.947192, -105.234636 39.947283, -105.234602 39.947336, -105.234594 39.947428, -105.234483 39.947567, -105.234415 39.947633, -105.234412 39.947694, -105.234382 39.947734, -105.234329 39.947783, -105.234283 39.947821, -105.234251 39.947889, -105.23415 39.948039, -105.234082 39.948099, -105.233958 39.948224, -105.233896 39.948296, -105.233798 39.94836, -105.233615 39.948501, -105.233583 39.948558, -105.23359 39.948691, -105.233568 39.94877, -105.2335 39.948834, -105.233452 39.948891, -105.233338 39.948941, -105.233293 39.948971, -105.233284 39.949012, -105.233272 39.949053, -105.233237 39.949115, -105.23317 39.949177, -105.233102 39.949217, -105.232981 39.949264, -105.232946 39.94933, -105.232894 39.949388, -105.232794 39.949444, -105.23278 39.949517, -105.232744 39.949599, -105.23272 39.949658, -105.232703 39.949738, -105.232708 39.949825, -105.232688 39.949853, -105.232587 39.949902, -105.232551 39.94997, -105.232508 39.950062, -105.232434 39.950119, -105.232272 39.950158, -105.232235 39.950179, -105.232196 39.950245, -105.232218 39.950308, -105.232288 39.950351, -105.232399 39.950355, -105.232534 39.950435)', 4326), 0.662, 44, 44, 'Coal Seam Trail', 'coal-seam-short', NULL),
    
    -- Edge 3: Another edge that should form a degree2 chain with edge 1
    (3, 3, 4, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232422 39.950673, -105.232204 39.95085, -105.231864 39.951376, -105.231667 39.951508, -105.231608 39.951603, -105.231506 39.951694, -105.231395 39.95173, -105.23134 39.951817, -105.231211 39.95195, -105.231126 39.951981)', 4326), 0.217, 5, 5, 'Coal Seam Trail', 'coal-seam-extension', NULL)
  `);
  
  // Insert vertices
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
    (1, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)),
    (2, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326)),
    (3, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)),
    (4, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.231126 39.951981)', 4326))
  `);
  
  console.log('✅ Dataset 1 created: Two overlapping edges + one degree2 chain');
  console.log('   Expected: Edge 2 should be removed (duplicate), then edges 1+3 should merge');
}

async function createDataset2(pgClient: Pool, schema: string) {
  console.log('🔧 Creating Dataset 2: Complex degree2 chain with multiple fragments...');
  
  await pgClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pgClient.query(`CREATE SCHEMA ${schema}`);
  
  // Create ways_noded table
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
  
  // Insert test data: Multiple degree2 fragments that should form one continuous chain
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
    -- Fragment 1: Start of trail
    (1, 1, 2, ST_GeomFromText('LINESTRING(-105.284218 39.977986, -105.284376 39.97767, -105.284406 39.977491, -105.284296 39.977289, -105.284289 39.977004, -105.284192 39.976672, -105.284242 39.976537, -105.284179 39.976425, -105.284006 39.976317, -105.28378 39.976262, -105.283417 39.976038, -105.283181 39.975808, -105.283041 39.975578, -105.282955 39.975389, -105.282956 39.975195, -105.283084 39.975019, -105.283143 39.97475, -105.28324 39.974541, -105.283333 39.974266, -105.283647 39.974089, -105.283653 39.974049, -105.283577 39.973964, -105.283603 39.973877, -105.283716 39.973755, -105.283771 39.973639, -105.283763 39.973578)', 4326), 0.668, 0, 0, 'Mesa Trail', 'mesa-fragment-1', NULL),
    
    -- Fragment 2: Middle section (connects to fragment 1)
    (2, 2, 3, ST_GeomFromText('LINESTRING(-105.283763 39.973578, -105.283877 39.973494, -105.284034 39.973363, -105.284095 39.973268, -105.28415 39.973176, -105.284175 39.97308, -105.284225 39.972982, -105.284266 39.972894, -105.284257 39.972808, -105.284052 39.972754, -105.283697 39.972843, -105.283598 39.972849, -105.283527 39.972835, -105.283359 39.972733, -105.283148 39.972465, -105.283037 39.972292, -105.282912 39.972148, -105.282811 39.97209, -105.282739 39.971792, -105.282558 39.971708, -105.28248 39.971644, -105.282412 39.97154, -105.282411 39.971438, -105.282509 39.970798, -105.28254 39.97066, -105.282614 39.970601, -105.282744 39.970606, -105.282965 39.970726, -105.283231 39.970914, -105.283362 39.971056, -105.28344 39.971107)', 4326), 0.544, 0, 0, 'Mesa Trail', 'mesa-fragment-2', NULL),
    
    -- Fragment 3: End section (connects to fragment 2)
    (3, 3, 4, ST_GeomFromText('LINESTRING(-105.28344 39.971107, -105.283599 39.971168, -105.283662 39.971153, -105.283702 39.971054, -105.283689 39.970967, -105.283595 39.970745, -105.283457 39.970493, -105.283426 39.970243, -105.283474 39.970168, -105.283524 39.970022, -105.28352 39.969916, -105.283491 39.969818, -105.283366 39.969589, -105.283261 39.969494, -105.283124 39.96945, -105.282966 39.969438, -105.282629 39.969393, -105.282307 39.969401, -105.282014 39.96942)', 4326), 0.511, 0, 0, 'Mesa Trail', 'mesa-fragment-3', NULL),
    
    -- Fragment 4: Alternative route (should not merge - different trail)
    (4, 5, 6, ST_GeomFromText('LINESTRING(-105.285329 39.982294, -105.285245 39.982189, -105.285123 39.981942, -105.284894 39.981651, -105.284581 39.981161, -105.28429 39.980818, -105.284184 39.980739, -105.284061 39.9806, -105.283965 39.980473, -105.283869 39.980286, -105.28391 39.980106, -105.284145 39.979777, -105.284509 39.979646, -105.284692 39.979528, -105.28474 39.979429, -105.284844 39.979335, -105.284871 39.979212, -105.284687 39.979291, -105.284619 39.979305, -105.284482 39.979246, -105.28433 39.979212, -105.284082 39.979213, -105.28394 39.979184, -105.283815 39.979103)', 4326), 0.511, 0, 0, 'Different Trail', 'different-trail', NULL)
  `);
  
  // Insert vertices
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
    (1, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.284218 39.977986)', 4326)),
    (2, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.283763 39.973578)', 4326)),
    (3, 2, 0, 0, 0, ST_GeomFromText('POINT(-105.28344 39.971107)', 4326)),
    (4, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.282014 39.96942)', 4326)),
    (5, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.285329 39.982294)', 4326)),
    (6, 1, 0, 0, 0, ST_GeomFromText('POINT(-105.283815 39.979103)', 4326))
  `);
  
  console.log('✅ Dataset 2 created: Three degree2 fragments + one separate trail');
  console.log('   Expected: Fragments 1, 2, 3 should merge into one continuous edge');
}

async function showBeforeState(pgClient: Pool, schema: string, datasetName: string) {
  console.log(`\n📊 BEFORE STATE - ${datasetName}:`);
  
  const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded`);
  const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded_vertices_pgr`);
  
  console.log(`   Edges: ${edgeCount.rows[0].count}`);
  console.log(`   Vertices: ${vertexCount.rows[0].count}`);
  
  const edges = await pgClient.query(`
    SELECT id, source, target, name, length_km, app_uuid
    FROM ${schema}.ways_noded
    ORDER BY id
  `);
  
  console.log('   Edge details:');
  edges.rows.forEach(edge => {
    console.log(`     Edge ${edge.id}: ${edge.source}→${edge.target} (${edge.name}, ${edge.length_km.toFixed(3)}km, ${edge.app_uuid})`);
  });
}

async function showAfterState(pgClient: Pool, schema: string, datasetName: string) {
  console.log(`\n📊 AFTER STATE - ${datasetName}:`);
  
  const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded`);
  const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded_vertices_pgr`);
  
  console.log(`   Edges: ${edgeCount.rows[0].count}`);
  console.log(`   Vertices: ${vertexCount.rows[0].count}`);
  
  const edges = await pgClient.query(`
    SELECT id, source, target, name, length_km, app_uuid
    FROM ${schema}.ways_noded
    ORDER BY id
  `);
  
  console.log('   Edge details:');
  edges.rows.forEach(edge => {
    console.log(`     Edge ${edge.id}: ${edge.source}→${edge.target} (${edge.name}, ${edge.length_km.toFixed(3)}km, ${edge.app_uuid})`);
  });
  
  // Check for merged degree2 chains
  const mergedChains = await pgClient.query(`
    SELECT COUNT(*) as count 
    FROM ${schema}.ways_noded 
    WHERE app_uuid LIKE 'merged-degree2-chain-%'
  `);
  
  console.log(`   Merged degree2 chains: ${mergedChains.rows[0].count}`);
}

async function runTest() {
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    await pgClient.connect();
    console.log('✅ Connected to database');
    
    // Test Dataset 1
    console.log('\n🧪 TESTING DATASET 1: Simple overlapping edges');
    console.log('=' .repeat(60));
    
    await createDataset1(pgClient, SCHEMA_1);
    await showBeforeState(pgClient, SCHEMA_1, 'Dataset 1');
    
    // Run vertex deduplication
    console.log('\n🔄 Running vertex deduplication...');
    const dedupResult = await deduplicateSharedVertices(pgClient, SCHEMA_1);
    console.log(`   Removed ${dedupResult.edgesRemoved} duplicate edges`);
    
    // Run degree2 merge
    console.log('\n🔄 Running degree2 merge...');
    const mergeResult = await mergeDegree2Chains(pgClient, SCHEMA_1, 0.00005); // 5m tolerance
    console.log(`   Merged ${mergeResult.chainsMerged} degree2 chains`);
    
    await showAfterState(pgClient, SCHEMA_1, 'Dataset 1');
    
    // Test Dataset 2
    console.log('\n🧪 TESTING DATASET 2: Complex degree2 chain');
    console.log('=' .repeat(60));
    
    await createDataset2(pgClient, SCHEMA_2);
    await showBeforeState(pgClient, SCHEMA_2, 'Dataset 2');
    
    // Run vertex deduplication
    console.log('\n🔄 Running vertex deduplication...');
    const dedupResult2 = await deduplicateSharedVertices(pgClient, SCHEMA_2);
    console.log(`   Removed ${dedupResult2.edgesRemoved} duplicate edges`);
    
    // Run degree2 merge
    console.log('\n🔄 Running degree2 merge...');
    const mergeResult2 = await mergeDegree2Chains(pgClient, SCHEMA_2, 0.00005); // 5m tolerance
    console.log(`   Merged ${mergeResult2.chainsMerged} degree2 chains`);
    
    await showAfterState(pgClient, SCHEMA_2, 'Dataset 2');
    
    // Summary
    console.log('\n📋 TEST SUMMARY:');
    console.log('=' .repeat(60));
    console.log('Dataset 1 Results:');
    console.log(`   Vertex deduplication: ${dedupResult.edgesRemoved} edges removed`);
    console.log(`   Degree2 merge: ${mergeResult.chainsMerged} chains merged`);
    console.log('');
    console.log('Dataset 2 Results:');
    console.log(`   Vertex deduplication: ${dedupResult2.edgesRemoved} edges removed`);
    console.log(`   Degree2 merge: ${mergeResult2.chainsMerged} chains merged`);
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
runTest().catch(console.error);
