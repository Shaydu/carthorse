#!/usr/bin/env ts-node

/**
 * Simple test to understand pgRouting topology creation
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_simple_topology_20241215';

async function testSimpleTopology() {
  console.log('🧪 Testing simple pgRouting topology creation...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create simple test data
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.simple_edges (
        id integer PRIMARY KEY,
        the_geom geometry(LineString,4326)
      )
    `);
    
    // Insert two simple edges that should connect
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.simple_edges (id, the_geom) VALUES
      (1, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232399 39.950355)', 4326)),
      (2, ST_GeomFromText('LINESTRING(-105.232534 39.950435, -105.232422 39.950673)', 4326))
    `);
    
    console.log('✅ Created simple test edges');
    
    // Test different tolerances
    const tolerances = [0.000001, 0.00001, 0.0001, 0.001];
    
    for (const tolerance of tolerances) {
      console.log(`\n🔍 Testing tolerance: ${tolerance}`);
      
      try {
        // Clean up previous attempt
        await pgClient.query(`DROP TABLE IF EXISTS ${TEST_SCHEMA}.simple_edges_vertices_pgr`);
        await pgClient.query(`ALTER TABLE ${TEST_SCHEMA}.simple_edges DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS target`);
        
        // Create topology
        const result = await pgClient.query(`SELECT pgr_createTopology('${TEST_SCHEMA}.simple_edges', ${tolerance}, 'the_geom', 'id')`);
        console.log(`   Topology result: ${result.rows[0].pgr_createtopology}`);
        
        // Check if vertices table was created
        const tableExists = await pgClient.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = '${TEST_SCHEMA}' 
            AND table_name = 'simple_edges_vertices_pgr'
          )
        `);
        
        if (tableExists.rows[0].exists) {
          const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.simple_edges_vertices_pgr`);
          const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.simple_edges`);
          
          console.log(`   ✅ Vertices: ${vertexCount.rows[0].count}, Edges: ${edgeCount.rows[0].count}`);
          
          // Show vertex details
          const vertices = await pgClient.query(`
            SELECT 
              id,
              ST_X(the_geom) as lng,
              ST_Y(the_geom) as lat,
              cnt as degree
            FROM ${TEST_SCHEMA}.simple_edges_vertices_pgr
            ORDER BY id
          `);
          
          console.log('   📍 Vertices:');
          vertices.rows.forEach(v => {
            console.log(`      Vertex ${v.id}: (${v.lng}, ${v.lat}) - degree ${v.degree}`);
          });
          
        } else {
          console.log(`   ❌ Vertices table not created`);
        }
        
      } catch (error) {
        console.log(`   ❌ Error with tolerance ${tolerance}: ${(error as Error).message}`);
      }
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testSimpleTopology();
