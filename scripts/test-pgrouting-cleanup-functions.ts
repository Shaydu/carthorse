#!/usr/bin/env ts-node

import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

const STAGING_SCHEMA = 'staging_boulder_test_improved_loops';

async function testPgRoutingCleanupFunctions() {
  try {
    await client.connect();
    console.log('🔧 Testing pgRouting cleanup functions for bypass edge removal...');

    // Step 1: Test pgr_extractVertices
    console.log('\n📊 Step 1: Testing pgr_extractVertices...');
    
    try {
      const extractResult = await client.query(`
        SELECT COUNT(*) as vertex_count FROM pgr_extractVertices('${STAGING_SCHEMA}.ways_noded')
      `);
      
      console.log(`✅ pgr_extractVertices found ${extractResult.rows[0].vertex_count} vertices`);
      
      // Get sample vertices
      const sampleVertices = await client.query(`
        SELECT * FROM pgr_extractVertices('${STAGING_SCHEMA}.ways_noded') LIMIT 5
      `);
      
      console.log('📋 Sample extracted vertices:');
      sampleVertices.rows.forEach((vertex, index) => {
        console.log(`  Vertex ${index + 1}: id=${vertex.id}, edge_id=${vertex.edge_id}, fraction=${vertex.fraction}`);
      });
      
    } catch (error) {
      console.log(`❌ pgr_extractVertices failed: ${error}`);
    }

    // Step 2: Test pgr_createVerticesTable
    console.log('\n📊 Step 2: Testing pgr_createVerticesTable...');
    
    try {
      await client.query(`
        DROP TABLE IF EXISTS ${STAGING_SCHEMA}.ways_vertices_clean;
        SELECT pgr_createVerticesTable('${STAGING_SCHEMA}.ways_noded', 'ways_vertices_clean', 'the_geom', 'id', 'source', 'target')
      `);
      
      const cleanVerticesCount = await client.query(`
        SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.ways_vertices_clean
      `);
      
      console.log(`✅ pgr_createVerticesTable created ${cleanVerticesCount.rows[0].count} clean vertices`);
      
    } catch (error) {
      console.log(`❌ pgr_createVerticesTable failed: ${error}`);
    }

    // Step 3: Test pgr_contraction (dead end contraction)
    console.log('\n📊 Step 3: Testing pgr_contraction (dead end)...');
    
    try {
      const contractResult = await client.query(`
        SELECT * FROM pgr_contraction('${STAGING_SCHEMA}.ways_noded', ARRAY[1], 1, ARRAY[1], false)
      `);
      
      console.log(`✅ pgr_contraction (dead end) found ${contractResult.rows.length} contractions`);
      
      if (contractResult.rows.length > 0) {
        console.log('📋 Sample contractions:');
        contractResult.rows.slice(0, 3).forEach((contraction, index) => {
          console.log(`  Contraction ${index + 1}: type=${contraction.type}, id=${contraction.id}, contracted_vertices=${contraction.contracted_vertices}`);
        });
      }
      
    } catch (error) {
      console.log(`❌ pgr_contraction (dead end) failed: ${error}`);
    }

    // Step 4: Test pgr_contraction (linear)
    console.log('\n📊 Step 4: Testing pgr_contraction (linear)...');
    
    try {
      const linearContractResult = await client.query(`
        SELECT * FROM pgr_contraction('${STAGING_SCHEMA}.ways_noded', ARRAY[2], 1, ARRAY[1], false)
      `);
      
      console.log(`✅ pgr_contraction (linear) found ${linearContractResult.rows.length} contractions`);
      
      if (linearContractResult.rows.length > 0) {
        console.log('📋 Sample linear contractions:');
        linearContractResult.rows.slice(0, 3).forEach((contraction, index) => {
          console.log(`  Linear ${index + 1}: type=${contraction.type}, id=${contraction.id}, contracted_vertices=${contraction.contracted_vertices}`);
        });
      }
      
    } catch (error) {
      console.log(`❌ pgr_contraction (linear) failed: ${error}`);
    }

    // Step 5: Test pgr_contractionDeadEnd
    console.log('\n📊 Step 5: Testing pgr_contractionDeadEnd...');
    
    try {
      const deadEndResult = await client.query(`
        SELECT * FROM pgr_contractionDeadEnd('${STAGING_SCHEMA}.ways_noded', ARRAY[1], 1, ARRAY[1], false)
      `);
      
      console.log(`✅ pgr_contractionDeadEnd found ${deadEndResult.rows.length} dead end contractions`);
      
    } catch (error) {
      console.log(`❌ pgr_contractionDeadEnd failed: ${error}`);
    }

    // Step 6: Test pgr_contractionLinear
    console.log('\n📊 Step 6: Testing pgr_contractionLinear...');
    
    try {
      const linearResult = await client.query(`
        SELECT * FROM pgr_contractionLinear('${STAGING_SCHEMA}.ways_noded', ARRAY[1], 1, ARRAY[1], false)
      `);
      
      console.log(`✅ pgr_contractionLinear found ${linearResult.rows.length} linear contractions`);
      
    } catch (error) {
      console.log(`❌ pgr_contractionLinear failed: ${error}`);
    }

    // Step 7: Analyze if contractions help with bypass edges
    console.log('\n📊 Step 7: Analyzing if contractions help with bypass edges...');
    
    try {
      // Check if we have a clean vertices table to work with
      const cleanVerticesExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = '${STAGING_SCHEMA}' 
          AND table_name = 'ways_vertices_clean'
        )
      `);
      
      if (cleanVerticesExists.rows[0].exists) {
        console.log('✅ Clean vertices table exists - can use for further analysis');
        
        // Compare clean vs original vertices
        const comparison = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as original_vertices,
            (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_clean) as clean_vertices
        `);
        
        const comp = comparison.rows[0];
        console.log(`📊 Vertex comparison: ${comp.original_vertices} original vs ${comp.clean_vertices} clean`);
        
        if (comp.clean_vertices < comp.original_vertices) {
          console.log('✅ Clean vertices table has fewer duplicates!');
        }
      }
      
    } catch (error) {
      console.log(`❌ Analysis failed: ${error}`);
    }

    console.log('\n✅ pgRouting cleanup function testing completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testPgRoutingCleanupFunctions(); 