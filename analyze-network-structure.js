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

async function analyzeNetworkStructure() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Analyzing network structure around Bear Canyon nodes...');
    
    // 1. Check if these nodes form any cycles at all
    console.log('\n1️⃣ Checking for any cycles involving these nodes...');
    
    const cycleCheck = await pool.query(`
      WITH RECURSIVE cycle_search AS (
        -- Start with one of our target nodes
        SELECT 
          356::bigint as start_node,
          356::bigint as current_node,
          ARRAY[356::bigint] as path,
          0 as depth
        WHERE EXISTS (SELECT 1 FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE id = 356)
        
        UNION ALL
        
        SELECT 
          cs.start_node,
          e.target::bigint as current_node,
          cs.path || e.target::bigint as path,
          cs.depth + 1
        FROM cycle_search cs
        JOIN ${STAGING_SCHEMA}.ways_noded e ON cs.current_node = e.source
        WHERE e.target = ANY($1::integer[])
          AND cs.depth < 10
          AND e.target != ALL(cs.path[1:array_length(cs.path, 1)-1])
      )
      SELECT 
        start_node,
        current_node,
        path,
        depth,
        CASE WHEN current_node = start_node AND depth > 2 THEN 'CYCLE' ELSE 'PATH' END as type
      FROM cycle_search
      WHERE current_node = start_node AND depth > 2
      ORDER BY depth, start_node
      LIMIT 20
    `, [BEAR_CANYON_NODES]);
    
    console.log(`🔍 Found ${cycleCheck.rows.length} potential cycles:`);
    cycleCheck.rows.forEach(row => {
      console.log(`   Cycle: ${row.path.join(' → ')} (depth: ${row.depth})`);
    });
    
    // 2. Check the actual connectivity between these nodes
    console.log('\n2️⃣ Checking direct connectivity between Bear Canyon nodes...');
    
    const connectivityMatrix = [];
    for (let i = 0; i < BEAR_CANYON_NODES.length; i++) {
      for (let j = i + 1; j < BEAR_CANYON_NODES.length; j++) {
        const node1 = BEAR_CANYON_NODES[i];
        const node2 = BEAR_CANYON_NODES[j];
        
        const pathResult = await pool.query(`
          SELECT COUNT(*) as path_count
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            $1::integer, $2::integer, false
          )
          WHERE edge != -1
        `, [node1, node2]);
        
        const hasPath = pathResult.rows[0].path_count > 0;
        connectivityMatrix.push({ node1, node2, hasPath });
        
        if (hasPath) {
          console.log(`   ✅ ${node1} ↔ ${node2}: Connected`);
        } else {
          console.log(`   ❌ ${node1} ↔ ${node2}: No path`);
        }
      }
    }
    
    // 3. Check what intermediate nodes are being used
    console.log('\n3️⃣ Checking intermediate nodes in paths...');
    
    for (let i = 0; i < BEAR_CANYON_NODES.length - 1; i++) {
      const node1 = BEAR_CANYON_NODES[i];
      const node2 = BEAR_CANYON_NODES[i + 1];
      
      const pathResult = await pool.query(`
        SELECT 
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
          $1::integer, $2::integer, false
        )
        WHERE edge != -1
        ORDER BY seq
      `, [node1, node2]);
      
      if (pathResult.rows.length > 0) {
        console.log(`   Path ${node1} → ${node2}:`);
        const intermediateNodes = pathResult.rows.map(row => row.node).filter(node => !BEAR_CANYON_NODES.includes(node));
        if (intermediateNodes.length > 0) {
          console.log(`     Intermediate nodes: ${intermediateNodes.join(', ')}`);
        } else {
          console.log(`     Direct connection`);
        }
        console.log(`     Total cost: ${pathResult.rows[pathResult.rows.length - 1].agg_cost.toFixed(2)}km`);
      }
    }
    
    // 4. Check if there are any simple cycles in the network
    console.log('\n4️⃣ Checking for simple cycles in the network...');
    
    const simpleCycles = await pool.query(`
      SELECT 'No recursive cycles found' as result
    `);
    
    console.log(`🔍 Found ${simpleCycles.rows.length} simple cycles in network:`);
    simpleCycles.rows.forEach(row => {
      console.log(`   Cycle: ${row.path.join(' → ')} (depth: ${row.depth})`);
    });
    
    // 5. Check if the network has any cycles at all
    console.log('\n5️⃣ Checking if network has cycles using Hawick Circuits...');
    
    const hawickTest = await pool.query(`
      SELECT COUNT(DISTINCT path_id) as cycle_count
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, cost, reverse_cost
         FROM ${STAGING_SCHEMA}.ways_noded
         WHERE source IS NOT NULL AND target IS NOT NULL AND cost >= 0.1
         ORDER BY id'
      )
      LIMIT 1
    `);
    
    console.log(`🔍 Hawick Circuits found ${hawickTest.rows[0].cycle_count} cycles in the network`);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await pool.end();
  }
}

analyzeNetworkStructure();
