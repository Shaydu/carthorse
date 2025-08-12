#!/usr/bin/env ts-node

/**
 * Diagnostic test to check pgRouting installation and function availability
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_pgrouting_diagnostic_20241215';

async function testPgRoutingDiagnostic() {
  console.log('🔍 Testing pgRouting installation and function availability...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Check if pgRouting extension is installed
    console.log('\n📋 Checking pgRouting extension...');
    const extensionCheck = await pgClient.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'pgrouting'
    `);
    
    if (extensionCheck.rows.length > 0) {
      console.log(`✅ pgRouting extension found: version ${extensionCheck.rows[0].extversion}`);
    } else {
      console.log('❌ pgRouting extension not found');
      return;
    }
    
    // Check if pgr_createTopology function exists
    console.log('\n📋 Checking pgr_createTopology function...');
    const functionCheck = await pgClient.query(`
      SELECT proname, prosrc 
      FROM pg_proc 
      WHERE proname = 'pgr_createtopology'
    `);
    
    if (functionCheck.rows.length > 0) {
      console.log(`✅ pgr_createTopology function found`);
    } else {
      console.log('❌ pgr_createTopology function not found');
      return;
    }
    
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create very simple test data
    console.log('\n📋 Creating simple test data...');
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.test_edges (
        id integer PRIMARY KEY,
        the_geom geometry(LineString,4326)
      )
    `);
    
    // Insert a single simple edge
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.test_edges (id, the_geom) VALUES
      (1, ST_GeomFromText('LINESTRING(0 0, 1 1)', 4326))
    `);
    
    console.log('✅ Created simple test edge');
    
    // Test pgr_createTopology with explicit parameters
    console.log('\n📋 Testing pgr_createTopology with explicit parameters...');
    try {
      const result = await pgClient.query(`
        SELECT pgr_createTopology(
          '${TEST_SCHEMA}.test_edges', 
          0.001, 
          'the_geom', 
          'id', 
          'source', 
          'target'
        )
      `);
      console.log(`✅ pgr_createTopology result: ${result.rows[0].pgr_createtopology}`);
      
      // Check if vertices table was created
      const tableExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${TEST_SCHEMA}' 
          AND table_name = 'test_edges_vertices_pgr'
        )
      `);
      
      if (tableExists.rows[0].exists) {
        const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.test_edges_vertices_pgr`);
        console.log(`✅ Vertices table created with ${vertexCount.rows[0].count} vertices`);
        
        // Show vertex details
        const vertices = await pgClient.query(`
          SELECT 
            id,
            ST_X(the_geom) as lng,
            ST_Y(the_geom) as lat,
            cnt as degree
          FROM ${TEST_SCHEMA}.test_edges_vertices_pgr
          ORDER BY id
        `);
        
        console.log('📍 Vertices:');
        vertices.rows.forEach(v => {
          console.log(`   Vertex ${v.id}: (${v.lng}, ${v.lat}) - degree ${v.degree}`);
        });
        
      } else {
        console.log('❌ Vertices table not created');
      }
      
    } catch (error) {
      console.log(`❌ pgr_createTopology failed: ${(error as Error).message}`);
      
      // Try to get more detailed error information
      console.log('\n📋 Checking table structure...');
      const tableInfo = await pgClient.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}' 
        AND table_name = 'test_edges'
        ORDER BY ordinal_position
      `);
      
      console.log('📊 Table structure:');
      tableInfo.rows.forEach(col => {
        console.log(`   ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    }
    
    console.log('\n✅ Diagnostic test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testPgRoutingDiagnostic();
