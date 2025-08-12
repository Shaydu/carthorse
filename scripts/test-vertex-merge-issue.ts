#!/usr/bin/env ts-node

/**
 * Test script to demonstrate and fix the vertex merge issue
 * 
 * The problem: pgRouting creates separate vertices for coordinates that are very close
 * but not identical, preventing degree2 chains from being merged.
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_vertex_merge_issue_20241215';

async function testVertexMergeIssue() {
  console.log('🧪 Testing vertex merge issue...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create test data with very close coordinates
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.test_edges (
        id integer PRIMARY KEY,
        source integer,
        target integer,
        the_geom geometry(LineString,4326),
        name text
      )
    `);
    
    // Insert test edges with very close coordinates
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.test_edges (id, the_geom, name) VALUES
      -- Edge 1: ends at (-105.232534, 39.950435)
      (1, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232399 39.950355, -105.232288 39.950351, -105.232218 39.950308, -105.232196 39.950245, -105.232235 39.950179, -105.232272 39.950158, -105.232434 39.950119, -105.232508 39.950062, -105.232551 39.94997, -105.232587 39.949902, -105.232688 39.949853, -105.232708 39.949825, -105.232703 39.949738, -105.23272 39.949658, -105.232744 39.949599, -105.23278 39.949517, -105.232794 39.949444, -105.232894 39.949388, -105.232946 39.94933, -105.232981 39.949264, -105.233102 39.949217, -105.23317 39.949177, -105.233237 39.949115, -105.233272 39.949053, -105.233284 39.949012, -105.233293 39.948971, -105.233338 39.948941, -105.233452 39.948891, -105.2335 39.948834, -105.233568 39.94877, -105.23359 39.948691, -105.233583 39.948558, -105.233615 39.948501, -105.233798 39.94836, -105.233896 39.948296, -105.233958 39.948224, -105.234082 39.948099, -105.23415 39.948039, -105.234251 39.947889, -105.234283 39.947821, -105.234329 39.947783, -105.234382 39.947734, -105.234412 39.947694, -105.234415 39.947633, -105.234483 39.947567, -105.234594 39.947428, -105.234602 39.947336, -105.234636 39.947283, -105.234608 39.947192, -105.23463 39.947158, -105.234686 39.947148, -105.234788 39.947112, -105.234891 39.946996, -105.234997 39.946882, -105.235048 39.946737, -105.235156 39.946665, -105.235384 39.946611, -105.235478 39.946573, -105.235572 39.946514, -105.235623 39.946468, -105.235707 39.946424, -105.235897 39.946366, -105.236134 39.946341, -105.236228 39.946312, -105.236297 39.946266, -105.236343 39.946148)', 4326), 'Coal Seam Trail Long'),
      
      -- Edge 2: starts at (-105.232534, 39.950435) - should connect to Edge 1
      (2, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232422 39.950673, -105.232204 39.95085, -105.231864 39.951376, -105.231667 39.951508, -105.231608 39.951603, -105.231506 39.951694, -105.231395 39.95173, -105.23134 39.951817, -105.231211 39.95195, -105.231126 39.951981)', 4326), 'Coal Seam Trail Short')
    `);
    
    console.log('✅ Created test edges with very close coordinates');
    
    // Test 1: Use very small tolerance (current issue)
    console.log('\n🔍 Test 1: Using very small tolerance (current issue)...');
    await pgClient.query(`SELECT pgr_createTopology('${TEST_SCHEMA}.test_edges', 0.000001, 'the_geom', 'id')`);
    
    // Check if vertices table was created
    const tableExists = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${TEST_SCHEMA}' 
        AND table_name = 'test_edges_vertices_pgr'
      )
    `);
    
    if (tableExists.rows[0].exists) {
      const smallTolResult = await pgClient.query(`
        SELECT 
          COUNT(*) as vertex_count,
          COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoints,
          COUNT(CASE WHEN cnt = 2 THEN 1 END) as degree2_vertices,
          COUNT(CASE WHEN cnt >= 3 THEN 1 END) as intersections
        FROM ${TEST_SCHEMA}.test_edges_vertices_pgr
      `);
      
      console.log('📊 Small tolerance results:');
      console.log(`   Vertices: ${smallTolResult.rows[0].vertex_count}`);
      console.log(`   Endpoints: ${smallTolResult.rows[0].endpoints}`);
      console.log(`   Degree-2: ${smallTolResult.rows[0].degree2_vertices}`);
      console.log(`   Intersections: ${smallTolResult.rows[0].intersections}`);
      
      // Show the specific vertices around the connection point
      const smallTolVertices = await pgClient.query(`
        SELECT 
          id,
          ST_X(the_geom) as lng,
          ST_Y(the_geom) as lat,
          cnt as degree,
          ST_Distance(the_geom, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)) as distance_to_connection_point
        FROM ${TEST_SCHEMA}.test_edges_vertices_pgr
        WHERE ST_DWithin(the_geom, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326), 0.001)
        ORDER BY distance_to_connection_point
      `);
      
      console.log('📍 Vertices near connection point (small tolerance):');
      smallTolVertices.rows.forEach((v, i) => {
        console.log(`   ${i + 1}. Vertex ${v.id}: (${v.lng}, ${v.lat}) - degree ${v.degree} - distance ${v.distance_to_connection_point.toFixed(6)}`);
      });
    } else {
      console.log('❌ Vertices table not created with small tolerance');
    }
    
    // Clean up for next test
    await pgClient.query(`DROP TABLE IF EXISTS ${TEST_SCHEMA}.test_edges_vertices_pgr`);
    await pgClient.query(`ALTER TABLE ${TEST_SCHEMA}.test_edges DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS target`);
    
    // Test 2: Use larger tolerance (fix)
    console.log('\n🔍 Test 2: Using larger tolerance (fix)...');
    await pgClient.query(`SELECT pgr_createTopology('${TEST_SCHEMA}.test_edges', 0.00005, 'the_geom', 'id')`);
    
    // Check if vertices table was created
    const tableExists2 = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${TEST_SCHEMA}' 
        AND table_name = 'test_edges_vertices_pgr'
      )
    `);
    
    if (tableExists2.rows[0].exists) {
      const largeTolResult = await pgClient.query(`
        SELECT 
          COUNT(*) as vertex_count,
          COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoints,
          COUNT(CASE WHEN cnt = 2 THEN 1 END) as degree2_vertices,
          COUNT(CASE WHEN cnt >= 3 THEN 1 END) as intersections
        FROM ${TEST_SCHEMA}.test_edges_vertices_pgr
      `);
      
      console.log('📊 Large tolerance results:');
      console.log(`   Vertices: ${largeTolResult.rows[0].vertex_count}`);
      console.log(`   Endpoints: ${largeTolResult.rows[0].endpoints}`);
      console.log(`   Degree-2: ${largeTolResult.rows[0].degree2_vertices}`);
      console.log(`   Intersections: ${largeTolResult.rows[0].intersections}`);
      
      // Show the specific vertices around the connection point
      const largeTolVertices = await pgClient.query(`
        SELECT 
          id,
          ST_X(the_geom) as lng,
          ST_Y(the_geom) as lat,
          cnt as degree,
          ST_Distance(the_geom, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326)) as distance_to_connection_point
        FROM ${TEST_SCHEMA}.test_edges_vertices_pgr
        WHERE ST_DWithin(the_geom, ST_GeomFromText('POINT(-105.232534 39.950435)', 4326), 0.001)
        ORDER BY distance_to_connection_point
      `);
      
      console.log('📍 Vertices near connection point (large tolerance):');
      largeTolVertices.rows.forEach((v, i) => {
        console.log(`   ${i + 1}. Vertex ${v.id}: (${v.lng}, ${v.lat}) - degree ${v.degree} - distance ${v.distance_to_connection_point.toFixed(6)}`);
      });
    } else {
      console.log('❌ Vertices table not created with large tolerance');
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testVertexMergeIssue();
