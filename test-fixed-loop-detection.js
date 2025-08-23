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

async function testFixedLoopDetection() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing fixed loop detection for Bear Canyon...');
    
    // Test with the fixed cost threshold (0.01 instead of 0.1)
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
           AND cost >= 0.01  -- Fixed: Minimum 10m segments (was 100m)
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT 10000
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
      }
    }
    
    console.log(`🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes with fixed threshold!`);
    
    if (bearCanyonCycles > 0) {
      console.log('✅ SUCCESS: Bear Canyon loop detection is now working!');
    } else {
      console.log('❌ Still no Bear Canyon cycles found');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testFixedLoopDetection();
