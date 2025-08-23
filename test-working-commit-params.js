#!/usr/bin/env node

const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  database: 'trail_master_db',
  user: 'shaydu',
  host: 'localhost',
  port: 5432,
};

const STAGING_SCHEMA = 'carthorse_1755964844744';
const BEAR_CANYON_NODES = [356, 357, 332, 336, 333, 339];

async function testWorkingCommitParams() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing with working commit parameters (cost <= 5.0)...');
    
    // Test with the exact same parameters as the working commit
    const hawickResult = await pool.query(`
      SELECT 
        path_id,
        seq,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT 
          id, 
          source, 
          target, 
          cost,
          reverse_cost
         FROM ${STAGING_SCHEMA}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND cost <= 5.0  -- Working commit parameter: Allow longer edges for loop completion
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT 5000
    `);
    
    console.log(`✅ Found ${hawickResult.rows.length} total edges in Hawick Circuits`);
    
    // Group by cycle
    const cycleGroups = new Map();
    hawickResult.rows.forEach(row => {
      if (!cycleGroups.has(row.path_id)) {
        cycleGroups.set(row.path_id, []);
      }
      cycleGroups.get(row.path_id).push(row);
    });
    
    console.log(`✅ Found ${cycleGroups.size} total cycles`);
    
    // Check for Bear Canyon cycles
    let bearCanyonCycles = 0;
    for (const [pathId, cycleEdges] of cycleGroups) {
      const cycleNodes = new Set(cycleEdges.map(edge => edge.node));
      const bearCanyonNodeCount = BEAR_CANYON_NODES.filter(node => cycleNodes.has(node)).length;
      
      if (bearCanyonNodeCount >= 3) {
        bearCanyonCycles++;
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        console.log(`   🐻 Bear Canyon cycle ${pathId}: ${bearCanyonNodeCount}/6 nodes, ${totalDistance.toFixed(2)}km`);
        
        // Show the cycle details
        const bearCanyonNodesInCycle = cycleEdges
          .map(edge => edge.node)
          .filter(node => BEAR_CANYON_NODES.includes(node));
        console.log(`     Bear Canyon nodes in cycle: ${bearCanyonNodesInCycle.join(', ')}`);
        
        // Show the full cycle
        const fullCycle = cycleEdges.map(edge => edge.node);
        console.log(`     Full cycle: ${fullCycle.join(' → ')}`);
      }
    }
    
    console.log(`🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes with working commit parameters!`);
    
    if (bearCanyonCycles > 0) {
      console.log('✅ SUCCESS: Bear Canyon loop detection is now working with working commit parameters!');
    } else {
      console.log('❌ Still no Bear Canyon cycles found');
      
      // Let's also check what cycles are being found
      console.log('\n📊 Sample of cycles found:');
      let cycleCount = 0;
      for (const [pathId, cycleEdges] of cycleGroups) {
        if (cycleCount >= 5) break;
        
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        const nodeCount = new Set(cycleEdges.map(edge => edge.node)).size;
        const edgeCount = cycleEdges.length;
        
        console.log(`   Cycle ${pathId}: ${nodeCount} nodes, ${edgeCount} edges, ${totalDistance.toFixed(2)}km`);
        
        // Show first few nodes in the cycle
        const nodes = cycleEdges.map(edge => edge.node).slice(0, 5);
        console.log(`     Nodes: ${nodes.join(' → ')}...`);
        
        cycleCount++;
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testWorkingCommitParams();
