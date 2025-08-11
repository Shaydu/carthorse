#!/usr/bin/env node

/**
 * Test pgRouting nodeNetwork Implementation
 * 
 * This script tests the updated pgRouting helpers with nodeNetwork
 * for maximum routing flexibility
 */

const { Pool } = require('pg');
const { createPgRoutingHelpers } = require('../src/utils/pgrouting-helpers.ts');

async function testPgRoutingNodeNetwork() {
  console.log('🧪 Testing pgRouting nodeNetwork implementation...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';
    const helpers = createPgRoutingHelpers(stagingSchema, pgClient);

    console.log('🔄 Step 1: Creating pgRouting nodeNetwork...');
    
    // Create the nodeNetwork
    const success = await helpers.createPgRoutingViews();
    if (!success) {
      throw new Error('Failed to create pgRouting nodeNetwork');
    }

    console.log('📊 Step 2: Analyzing nodeNetwork statistics...');
    
    // Get statistics about the noded network
    const stats = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways) as original_trails,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as noded_edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_vertices_pgr) as vertices,
        (SELECT COUNT(DISTINCT trail_uuid) FROM ${stagingSchema}.ways_noded WHERE trail_uuid IS NOT NULL) as unique_trails
    `);
    
    console.log('📈 nodeNetwork Statistics:');
    console.log(JSON.stringify(stats.rows[0], null, 2));

    console.log('🔍 Step 3: Analyzing connectivity...');
    
    // Analyze connectivity of the noded network
    const connectivity = await pgClient.query(`
      SELECT 
        cnt as connection_count,
        COUNT(*) as node_count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM ${stagingSchema}.ways_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);
    
    console.log('📊 Node Connectivity Distribution:');
    console.table(connectivity.rows);

    console.log('🔍 Step 4: Testing route finding...');
    
    // Test route finding with the noded network
    const analysis = await helpers.analyzeGraph();
    console.log('📊 Graph Analysis:');
    console.log(JSON.stringify(analysis, null, 2));

    console.log('✅ nodeNetwork implementation test complete!');
    console.log('\n📋 Summary:');
    console.log('- nodeNetwork created successfully');
    console.log('- Trails split at intersections for maximum routing flexibility');
    console.log('- Connectivity analysis performed');
    console.log('- Route finding ready for testing');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the test
testPgRoutingNodeNetwork()
  .then(() => {
    console.log('🎉 nodeNetwork test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 nodeNetwork test failed:', error);
    process.exit(1);
  }); 