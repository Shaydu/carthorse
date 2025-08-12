#!/usr/bin/env ts-node

/**
 * Test using actual production data to understand topology creation
 */

import { Pool } from 'pg';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_production_topology_20241215';

async function testProductionDataTopology() {
  console.log('🧪 Testing topology creation with production data...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    // Create test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Copy a few trails from production to test with
    console.log('\n📋 Copying production trails to test...');
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.test_trails AS
      SELECT 
        id,
        app_uuid,
        name,
        ST_Force2D(geometry) as the_geom
      FROM public.trails 
      WHERE region = 'boulder' 
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      LIMIT 5
    `);
    
    const trailCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.test_trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} trails from production`);
    
    // Show the trails we're working with
    const trails = await pgClient.query(`
      SELECT id, name, ST_Length(the_geom::geography) as length_meters
      FROM ${TEST_SCHEMA}.test_trails
      ORDER BY id
    `);
    
    console.log('\n📊 Test trails:');
    trails.rows.forEach(t => {
      console.log(`   ${t.id}: ${t.name} (${t.length_meters.toFixed(1)}m)`);
    });
    
    // Try to create topology
    console.log('\n📋 Creating topology...');
    try {
      const result = await pgClient.query(`
        SELECT pgr_createTopology(
          '${TEST_SCHEMA}.test_trails', 
          0.00005, 
          'the_geom', 
          'id'
        )
      `);
      console.log(`✅ pgr_createTopology result: ${result.rows[0].pgr_createtopology}`);
      
      // Check if vertices table was created
      const tableExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${TEST_SCHEMA}' 
          AND table_name = 'test_trails_vertices_pgr'
        )
      `);
      
      if (tableExists.rows[0].exists) {
        const vertexCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.test_trails_vertices_pgr`);
        const edgeCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${TEST_SCHEMA}.test_trails`);
        
        console.log(`✅ Topology created: ${vertexCount.rows[0].count} vertices, ${edgeCount.rows[0].count} edges`);
        
        // Show vertex connectivity
        const connectivity = await pgClient.query(`
          SELECT 
            cnt as degree,
            COUNT(*) as count
          FROM ${TEST_SCHEMA}.test_trails_vertices_pgr
          GROUP BY cnt
          ORDER BY cnt
        `);
        
        console.log('\n📊 Vertex connectivity:');
        connectivity.rows.forEach(c => {
          console.log(`   Degree ${c.degree}: ${c.count} vertices`);
        });
        
        // Show some vertex details
        const vertices = await pgClient.query(`
          SELECT 
            id,
            ST_X(the_geom) as lng,
            ST_Y(the_geom) as lat,
            cnt as degree
          FROM ${TEST_SCHEMA}.test_trails_vertices_pgr
          ORDER BY cnt DESC, id
          LIMIT 10
        `);
        
        console.log('\n📍 Sample vertices:');
        vertices.rows.forEach(v => {
          console.log(`   Vertex ${v.id}: (${v.lng.toFixed(6)}, ${v.lat.toFixed(6)}) - degree ${v.degree}`);
        });
        
      } else {
        console.log('❌ Vertices table not created');
      }
      
    } catch (error) {
      console.log(`❌ pgr_createTopology failed: ${(error as Error).message}`);
      
      // Check for specific error details
      if ((error as any).detail) {
        console.log(`   Detail: ${(error as any).detail}`);
      }
      if ((error as any).hint) {
        console.log(`   Hint: ${(error as any).hint}`);
      }
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testProductionDataTopology();
