#!/usr/bin/env ts-node

/**
 * Comprehensive test for degree2 merge with multiple test cases
 * 
 * Test Case 1: Coal Seam Trail fragments that should merge
 * Test Case 2: Marshall Mesa + Marshall Valley Trail + bridge-extend that should merge
 */

import { Pool } from 'pg';
import { mergeDegree2Chains, deduplicateSharedVertices } from '../src/utils/services/network-creation/merge-degree2-chains';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_degree2_comprehensive_20241215';

async function createTestData(pgClient: Pool, schema: string) {
  console.log('🔧 Creating comprehensive test data...');
  
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
  
  // Insert test data: Coal Seam Trail fragments (Test Case 1)
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
    -- Edge 1: Long Coal Seam Trail fragment
    (1, 7, 30, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232399 39.950355, -105.232288 39.950351, -105.232218 39.950308, -105.232196 39.950245, -105.232235 39.950179, -105.232272 39.950158, -105.232434 39.950119, -105.232508 39.950062, -105.232551 39.94997, -105.232587 39.949902, -105.232688 39.949853, -105.232708 39.949825, -105.232703 39.949738, -105.23272 39.949658, -105.232744 39.949599, -105.23278 39.949517, -105.232794 39.949444, -105.232894 39.949388, -105.232946 39.94933, -105.232981 39.949264, -105.233102 39.949217, -105.23317 39.949177, -105.233237 39.949115, -105.233272 39.949053, -105.233284 39.949012, -105.233293 39.948971, -105.233338 39.948941, -105.233452 39.948891, -105.2335 39.948834, -105.233568 39.94877, -105.23359 39.948691, -105.233583 39.948558, -105.233615 39.948501, -105.233798 39.94836, -105.233896 39.948296, -105.233958 39.948224, -105.234082 39.948099, -105.23415 39.948039, -105.234251 39.947889, -105.234283 39.947821, -105.234329 39.947783, -105.234382 39.947734, -105.234412 39.947694, -105.234415 39.947633, -105.234483 39.947567, -105.234594 39.947428, -105.234602 39.947336, -105.234636 39.947283, -105.234608 39.947192, -105.23463 39.947158, -105.234686 39.947148, -105.234788 39.947112, -105.234891 39.946996, -105.234997 39.946882, -105.235048 39.946737, -105.235156 39.946665, -105.235384 39.946611, -105.235478 39.946573, -105.235572 39.946514, -105.235623 39.946468, -105.235707 39.946424, -105.235897 39.946366, -105.236134 39.946341, -105.236228 39.946312, -105.236297 39.946266, -105.236343 39.946148)', 4326), 0.662, 44, 44, 'Coal Seam Trail', 'coal-seam-long', NULL),
    
    -- Edge 2: Short Coal Seam Trail fragment that should connect to Edge 1
    (2, 10, 26, ST_GeomFromText('LINESTRING(-105.231126 39.951981, -105.231211 39.95195, -105.23134 39.951817, -105.231395 39.95173, -105.231506 39.951694, -105.231608 39.951603, -105.231667 39.951508, -105.231864 39.951376, -105.232204 39.95085, -105.232422 39.950673, -105.23255 39.950527, -105.232558 39.950481, -105.232534 39.950435)', 4326), 0.217, 5, 5, 'Coal Seam Trail', 'coal-seam-short', NULL)
  `);
  
  // Insert test data: Marshall Mesa chain (Test Case 2)
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
    -- Edge 12: Marshall Mesa trail
    (12, 6, 19, ST_GeomFromText('LINESTRING(-105.227844 39.948591, -105.226696 39.948936, -105.226011 39.949019, -105.225009 39.949418, -105.224303 39.949853, -105.223253 39.950599, -105.222921 39.950892, -105.222447 39.951091, -105.222174 39.951145, -105.22155 39.95142, -105.221062 39.951553, -105.220571 39.951607, -105.22012 39.952321, -105.219761 39.952545, -105.219324 39.952929, -105.218984 39.95306, -105.218617 39.95329, -105.217586 39.954108, -105.217524 39.954193, -105.217581 39.954282)', 4326), 1.128, 47, 47, 'Marshall Mesa', 'marshall-mesa', NULL),
    
    -- Edge 19: Bridge connector
    (19, 19, 20, ST_GeomFromText('LINESTRING(-105.217581 39.954282, -105.217691 39.954359)', 4326), 0.013, 0, 0, 'bridge-extend', 'bridge-extend', NULL),
    
    -- Edge 13: Marshall Valley Trail
    (13, 10, 20, ST_GeomFromText('LINESTRING(-105.231126 39.951981, -105.231092 39.95183, -105.231126 39.951692, -105.231049 39.9516, -105.23079 39.951523, -105.230695 39.95144, -105.230208 39.951409, -105.230079 39.951343, -105.229916 39.951356, -105.229718 39.951468, -105.229444 39.951547, -105.229324 39.951534, -105.229195 39.951574, -105.229109 39.951554, -105.228602 39.951666, -105.228534 39.951705, -105.228431 39.951718, -105.228345 39.951764, -105.228259 39.951764, -105.228002 39.95185, -105.227907 39.95183, -105.22759 39.951896, -105.227135 39.95206, -105.22698 39.952179, -105.226843 39.952225, -105.226731 39.952225, -105.22638 39.952343, -105.225873 39.952554, -105.225564 39.95258, -105.225375 39.952712, -105.225135 39.952797, -105.225015 39.952824, -105.224929 39.95287, -105.224457 39.952883, -105.223813 39.952863, -105.223556 39.952778, -105.223427 39.952797, -105.222981 39.952705, -105.222036 39.952574, -105.221702 39.952626, -105.221513 39.952692, -105.221152 39.952909, -105.220835 39.953212, -105.220698 39.953278, -105.220672 39.95333, -105.220182 39.953488, -105.219831 39.953672, -105.219031 39.953914, -105.218381 39.954266, -105.218103 39.954334, -105.21793 39.954333, -105.217753 39.95439, -105.217691 39.954359)', 4326), 1.307, 16, 16, 'Marshall Valley Trail', 'marshall-valley', NULL)
  `);
  
  // Create vertices for Coal Seam Trail case
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
    -- Coal Seam Trail vertices
    (7, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.232399 39.950355)', 4326)),
    (10, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.231126 39.951981)', 4326)),
    (26, 1, 0, 1, 0, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)),
    (30, 1, 0, 1, 0, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326))
  `);
  
  // Create vertices for Marshall Mesa case
  await pgClient.query(`
    INSERT INTO ${schema}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
    -- Marshall Mesa vertices
    (6, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.227844 39.948591)', 4326)),
    (19, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.217581 39.954282)', 4326)),
    (20, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.217691 39.954359)', 4326))
  `);
  
  console.log('✅ Created comprehensive test data with 2 test cases');
}

async function showBeforeState(pgClient: Pool, schema: string) {
  console.log('\n📊 BEFORE STATE:');
  
  const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded`);
  const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded_vertices_pgr`);
  
  console.log(`   Edges: ${edgeCount.rows[0].count}`);
  console.log(`   Vertices: ${vertexCount.rows[0].count}`);
  
  // Show degree-2 vertices
  const degree2Vertices = await pgClient.query(`
    SELECT id, cnt, ST_X(the_geom) as lng, ST_Y(the_geom) as lat
    FROM ${schema}.ways_noded_vertices_pgr
    WHERE cnt = 2
    ORDER BY id
  `);
  
  console.log(`   Degree-2 vertices: ${degree2Vertices.rows.length}`);
  degree2Vertices.rows.forEach(v => {
    console.log(`      Vertex ${v.id}: (${v.lng.toFixed(6)}, ${v.lat.toFixed(6)}) - degree ${v.cnt}`);
  });
  
  // Show edges
  const edges = await pgClient.query(`
    SELECT id, source, target, name, length_km
    FROM ${schema}.ways_noded
    ORDER BY id
  `);
  
  console.log('\n   Edges:');
  edges.rows.forEach(e => {
    console.log(`      Edge ${e.id}: ${e.source} → ${e.target} (${e.name}, ${e.length_km.toFixed(3)}km)`);
  });
}

async function showAfterState(pgClient: Pool, schema: string) {
  console.log('\n📊 AFTER STATE:');
  
  const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded`);
  const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${schema}.ways_noded_vertices_pgr`);
  
  console.log(`   Edges: ${edgeCount.rows[0].count}`);
  console.log(`   Vertices: ${vertexCount.rows[0].count}`);
  
  // Show degree-2 vertices
  const degree2Vertices = await pgClient.query(`
    SELECT id, cnt, ST_X(the_geom) as lng, ST_Y(the_geom) as lat
    FROM ${schema}.ways_noded_vertices_pgr
    WHERE cnt = 2
    ORDER BY id
  `);
  
  console.log(`   Degree-2 vertices: ${degree2Vertices.rows.length}`);
  degree2Vertices.rows.forEach(v => {
    console.log(`      Vertex ${v.id}: (${v.lng.toFixed(6)}, ${v.lat.toFixed(6)}) - degree ${v.cnt}`);
  });
  
  // Show edges
  const edges = await pgClient.query(`
    SELECT id, source, target, name, length_km
    FROM ${schema}.ways_noded
    ORDER BY id
  `);
  
  console.log('\n   Edges:');
  edges.rows.forEach(e => {
    console.log(`      Edge ${e.id}: ${e.source} → ${e.target} (${e.name}, ${e.length_km.toFixed(3)}km)`);
  });
}

async function runComprehensiveTest() {
  console.log('🧪 Running comprehensive degree2 merge test...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test data
    await createTestData(pgClient, TEST_SCHEMA);
    
    // Show before state
    await showBeforeState(pgClient, TEST_SCHEMA);
    
    // Run vertex deduplication
    console.log('\n🔄 Step 1: Running vertex deduplication...');
    const dedupResult = await deduplicateSharedVertices(pgClient, TEST_SCHEMA);
    console.log(`   ✅ Removed ${dedupResult.edgesRemoved} duplicate edges`);
    
    // Run degree2 merge
    console.log('\n🔄 Step 2: Running degree2 merge...');
    const mergeResult = await mergeDegree2Chains(pgClient, TEST_SCHEMA);
    console.log(`   ✅ Merged ${mergeResult.chainsMerged} degree-2 chains`);
    
    // Show after state
    await showAfterState(pgClient, TEST_SCHEMA);
    
    console.log('\n✅ Comprehensive test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

runComprehensiveTest();
