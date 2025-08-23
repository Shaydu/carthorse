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

async function testCustomLoopDetection() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing custom loop detection for Bear Canyon...');
    
    // Strategy 1: Find paths between Bear Canyon nodes and look for cycles
    console.log('\n1️⃣ Strategy 1: Path-based cycle detection...');
    
    const pathBasedCycles = await pool.query(`
      WITH bear_canyon_paths AS (
        -- Find all paths between Bear Canyon nodes
        SELECT 
          start_vid,
          end_vid,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
          (SELECT array_agg(id) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE id = ANY($1::integer[])),
          (SELECT array_agg(id) FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr WHERE id = ANY($1::integer[])),
          false
        )
        WHERE start_vid = ANY($1::integer[]) AND end_vid = ANY($1::integer[])
      ),
      cycle_candidates AS (
        -- Look for paths that could form cycles
        SELECT DISTINCT
          p1.start_vid as node1,
          p1.end_vid as node2,
          p2.start_vid as node3,
          p2.end_vid as node4,
          p1.agg_cost as cost1,
          p2.agg_cost as cost2,
          (p1.agg_cost + p2.agg_cost) as total_cost
        FROM bear_canyon_paths p1
        JOIN bear_canyon_paths p2 ON p1.end_vid = p2.start_vid
        WHERE p1.start_vid != p1.end_vid
          AND p2.start_vid != p2.end_vid
          AND p1.start_vid != p2.end_vid
      )
      SELECT 
        node1,
        node2,
        node3,
        node4,
        cost1,
        cost2,
        total_cost
      FROM cycle_candidates
      WHERE total_cost BETWEEN 5.0 AND 25.0  -- Reasonable loop distance
      ORDER BY total_cost
      LIMIT 10
    `, [BEAR_CANYON_NODES]);
    
    console.log(`🔍 Found ${pathBasedCycles.rows.length} potential cycle candidates:`);
    pathBasedCycles.rows.forEach(row => {
      console.log(`   ${row.node1} → ${row.node2} → ${row.node3} → ${row.node4} (${row.total_cost.toFixed(2)}km)`);
    });
    
    // Strategy 2: Use KSP to find multiple paths and look for cycles
    console.log('\n2️⃣ Strategy 2: KSP-based cycle detection...');
    
    for (let i = 0; i < BEAR_CANYON_NODES.length - 1; i++) {
      const startNode = BEAR_CANYON_NODES[i];
      const endNode = BEAR_CANYON_NODES[i + 1];
      
      const kspResult = await pool.query(`
        SELECT 
          path_id,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_ksp(
          'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
          $1::integer, $2::integer, 3, false
        )
        WHERE edge != -1
        ORDER BY path_id, path_seq
      `, [startNode, endNode]);
      
      if (kspResult.rows.length > 0) {
        const pathGroups = new Map();
        kspResult.rows.forEach(row => {
          if (!pathGroups.has(row.path_id)) {
            pathGroups.set(row.path_id, []);
          }
          pathGroups.get(row.path_id).push(row);
        });
        
        console.log(`   KSP paths from ${startNode} to ${endNode}:`);
        for (const [pathId, pathEdges] of pathGroups) {
          const totalCost = pathEdges[pathEdges.length - 1].agg_cost;
          const nodes = pathEdges.map(edge => edge.node);
          const bearCanyonNodes = nodes.filter(node => BEAR_CANYON_NODES.includes(node));
          console.log(`     Path ${pathId}: ${nodes.join(' → ')} (${totalCost.toFixed(2)}km, ${bearCanyonNodes.length} Bear Canyon nodes)`);
        }
      }
    }
    
    // Strategy 3: Manual cycle construction
    console.log('\n3️⃣ Strategy 3: Manual cycle construction...');
    
    // Try to construct a cycle manually using the known connections
    const manualCycle = await pool.query(`
      WITH cycle_path AS (
        -- 356 → 357 → 332 → 336 → 333 → 339 → 356
        SELECT 
          '356-357' as segment, 356 as start_node, 357 as end_node
        UNION ALL SELECT '357-332', 357, 332
        UNION ALL SELECT '332-336', 332, 336
        UNION ALL SELECT '336-333', 336, 333
        UNION ALL SELECT '333-339', 333, 339
        UNION ALL SELECT '339-356', 339, 356
      ),
        path_details AS (
        SELECT 
          cp.segment,
          cp.start_node,
          cp.end_node,
          p.path_seq,
          p.node,
          p.edge,
          p.cost,
          p.agg_cost
        FROM cycle_path cp
        CROSS JOIN LATERAL (
          SELECT 
            path_seq,
            node,
            edge,
            cost,
            agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            cp.start_node::integer, cp.end_node::integer, false
          )
          WHERE edge != -1
          ORDER BY path_seq
        ) p
      )
      SELECT 
        segment,
        start_node,
        end_node,
        COUNT(*) as edge_count,
        MAX(agg_cost) as segment_cost
      FROM path_details
      GROUP BY segment, start_node, end_node
      ORDER BY segment
    `);
    
    console.log(`🔍 Manual cycle construction results:`);
    let totalCycleCost = 0;
    manualCycle.rows.forEach(row => {
      console.log(`   ${row.segment}: ${row.start_node} → ${row.end_node} (${row.segment_cost.toFixed(2)}km, ${row.edge_count} edges)`);
      totalCycleCost += row.segment_cost;
    });
    console.log(`   Total cycle cost: ${totalCycleCost.toFixed(2)}km`);
    
    // Strategy 4: Check if we can modify the loop detection to include these nodes
    console.log('\n4️⃣ Strategy 4: Modified Hawick Circuits approach...');
    
    // Try Hawick Circuits with a smaller cost threshold to include more edges
    const modifiedHawick = await pool.query(`
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
           AND cost >= 0.01  -- Lower threshold to include more edges
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT 5000
    `);
    
    const cycleGroups = new Map();
    modifiedHawick.rows.forEach(row => {
      if (!cycleGroups.has(row.path_id)) {
        cycleGroups.set(row.path_id, []);
      }
      cycleGroups.get(row.path_id).push(row);
    });
    
    let bearCanyonCycles = 0;
    for (const [pathId, cycleEdges] of cycleGroups) {
      const cycleNodes = new Set(cycleEdges.map(edge => edge.node));
      const bearCanyonNodeCount = BEAR_CANYON_NODES.filter(node => cycleNodes.has(node)).length;
      
      if (bearCanyonNodeCount >= 3) {
        bearCanyonCycles++;
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        console.log(`   🐻 Bear Canyon cycle ${pathId}: ${bearCanyonNodeCount}/6 nodes, ${totalDistance.toFixed(2)}km`);
      }
    }
    
    console.log(`   🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes with modified threshold`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testCustomLoopDetection();
