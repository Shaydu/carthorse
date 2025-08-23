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

async function manualTraverseBearCanyon() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Manually traversing Bear Canyon nodes to find cycles...');
    
    // First, let's check if we can find paths between all pairs of Bear Canyon nodes
    console.log('\n1️⃣ Testing connectivity between Bear Canyon nodes...');
    
    for (let i = 0; i < BEAR_CANYON_NODES.length; i++) {
      for (let j = i + 1; j < BEAR_CANYON_NODES.length; j++) {
        const source = BEAR_CANYON_NODES[i];
        const target = BEAR_CANYON_NODES[j];
        
        try {
          const pathResult = await pool.query(`
            SELECT 
              seq,
              node,
              edge,
              cost,
              agg_cost
            FROM pgr_dijkstra(
              'SELECT id, source, target, cost, reverse_cost
               FROM ${STAGING_SCHEMA}.ways_noded
               WHERE source IS NOT NULL AND target IS NOT NULL',
              $1, $2, false
            )
            ORDER BY seq
          `, [source, target]);
          
          if (pathResult.rows.length > 0) {
            const totalCost = pathResult.rows[pathResult.rows.length - 1].agg_cost;
            const pathNodes = pathResult.rows.map(row => row.node);
            console.log(`   ✅ ${source} → ${target}: ${totalCost.toFixed(2)}km, ${pathNodes.length} nodes`);
            console.log(`      Path: ${pathNodes.join(' → ')}`);
          } else {
            console.log(`   ❌ ${source} → ${target}: No path found`);
          }
        } catch (error) {
          console.log(`   ❌ ${source} → ${target}: Error - ${error.message}`);
        }
      }
    }
    
    // 2. Try to find a cycle by connecting nodes in sequence
    console.log('\n2️⃣ Attempting to find a cycle by connecting nodes in sequence...');
    
    // Try different sequences of the Bear Canyon nodes
    const sequences = [
      [356, 357, 332, 336, 333, 339, 356], // Original sequence
      [356, 357, 332, 333, 336, 339, 356], // Alternative sequence
      [332, 333, 336, 339, 356, 357, 332], // Another alternative
    ];
    
    for (let seqIndex = 0; seqIndex < sequences.length; seqIndex++) {
      const sequence = sequences[seqIndex];
      console.log(`\n   Testing sequence ${seqIndex + 1}: ${sequence.join(' → ')}`);
      
      let totalDistance = 0;
      let allNodes = [];
      let success = true;
      
      for (let i = 0; i < sequence.length - 1; i++) {
        const source = sequence[i];
        const target = sequence[i + 1];
        
        try {
          const pathResult = await pool.query(`
            SELECT 
              seq,
              node,
              edge,
              cost,
              agg_cost
            FROM pgr_dijkstra(
              'SELECT id, source, target, cost, reverse_cost
               FROM ${STAGING_SCHEMA}.ways_noded
               WHERE source IS NOT NULL AND target IS NOT NULL',
              $1, $2, false
            )
            ORDER BY seq
          `, [source, target]);
          
          if (pathResult.rows.length > 0) {
            const segmentCost = pathResult.rows[pathResult.rows.length - 1].agg_cost;
            totalDistance += segmentCost;
            const segmentNodes = pathResult.rows.map(row => row.node);
            
            // Add nodes (avoiding duplicates at connection points)
            if (i === 0) {
              allNodes.push(...segmentNodes);
            } else {
              allNodes.push(...segmentNodes.slice(1)); // Skip first node to avoid duplication
            }
            
            console.log(`      ${source} → ${target}: ${segmentCost.toFixed(2)}km`);
          } else {
            console.log(`      ❌ ${source} → ${target}: No path found`);
            success = false;
            break;
          }
        } catch (error) {
          console.log(`      ❌ ${source} → ${target}: Error - ${error.message}`);
          success = false;
          break;
        }
      }
      
      if (success) {
        console.log(`   ✅ SUCCESS! Found cycle with ${totalDistance.toFixed(2)}km total distance`);
        console.log(`      Full cycle: ${allNodes.join(' → ')}`);
        console.log(`      Unique nodes: ${new Set(allNodes).size}`);
        return; // Found a cycle!
      }
    }
    
    // 3. Check if there are any intermediate nodes that connect Bear Canyon nodes
    console.log('\n3️⃣ Checking intermediate nodes that connect Bear Canyon nodes...');
    
    const intermediateResult = await pool.query(`
      SELECT DISTINCT
        e1.source as bc_node,
        e1.target as intermediate_node,
        e2.target as other_bc_node,
        e1.cost + e2.cost as total_cost,
        e1.trail_name as trail1,
        e2.trail_name as trail2
      FROM ${STAGING_SCHEMA}.ways_noded e1
      JOIN ${STAGING_SCHEMA}.ways_noded e2 ON e1.target = e2.source
      WHERE e1.source = ANY($1::integer[])
        AND e2.target = ANY($1::integer[])
        AND e1.source != e2.target
        AND e1.target NOT IN (SELECT unnest($1::integer[]))
      ORDER BY total_cost
      LIMIT 10
    `, [BEAR_CANYON_NODES]);
    
    console.log('Intermediate connections:');
    intermediateResult.rows.forEach(row => {
      console.log(`   ${row.bc_node} → ${row.intermediate_node} → ${row.other_bc_node}: ${row.total_cost.toFixed(2)}km`);
      console.log(`      Via: ${row.trail1} → ${row.trail2}`);
    });
    
    // 4. Try to find the shortest cycle using all Bear Canyon nodes
    console.log('\n4️⃣ Finding shortest cycle using all Bear Canyon nodes...');
    
    // Use a recursive approach to find the shortest cycle
    const shortestCycleResult = await pool.query(`
      WITH RECURSIVE cycle_search AS (
        SELECT 
          ARRAY[356] as path,
          356 as current_node,
          0.0 as total_cost,
          1 as depth
        UNION ALL
        SELECT 
          cs.path || e.target,
          e.target,
          cs.total_cost + e.cost,
          cs.depth + 1
        FROM cycle_search cs
        JOIN ${STAGING_SCHEMA}.ways_noded e ON cs.current_node = e.source
        WHERE e.target = ANY($1::integer[])
          AND e.target != ALL(cs.path[1:array_length(cs.path, 1)-1])
          AND cs.depth < 7
          AND cs.total_cost < 50.0
      )
      SELECT 
        path,
        total_cost,
        depth
      FROM cycle_search
      WHERE depth >= 4
        AND path[1] = path[array_length(path, 1)]
      ORDER BY total_cost
      LIMIT 5
    `, [BEAR_CANYON_NODES]);
    
    console.log('Shortest cycles found:');
    shortestCycleResult.rows.forEach(row => {
      console.log(`   Cycle: ${row.path.join(' → ')} (${row.total_cost.toFixed(2)}km, ${row.depth} nodes)`);
    });
    
  } catch (error) {
    console.error('❌ Manual traversal failed:', error);
  } finally {
    await pool.end();
  }
}

manualTraverseBearCanyon();
