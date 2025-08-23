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
    
    // Check if all nodes exist in the network
    const nodeCheck = await pool.query(`
      SELECT COUNT(*) as node_count
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      WHERE id = ANY($1::integer[])
    `, [BEAR_CANYON_NODES]);
    
    console.log(`✅ Found ${nodeCheck.rows[0].node_count}/${BEAR_CANYON_NODES.length} Bear Canyon nodes in network`);
    
    if (nodeCheck.rows[0].node_count !== BEAR_CANYON_NODES.length) {
      console.log('❌ Not all Bear Canyon nodes exist in network');
      return;
    }
    
    // Try to construct a cycle through these nodes
    const cycleResult = await pool.query(`
      WITH cycle_segments AS (
        -- Create segments between consecutive nodes in the cycle
        SELECT 
          node_group.nodes[i] as start_node,
          node_group.nodes[i + 1] as end_node,
          i as segment_order
        FROM (
          SELECT unnest($1::integer[]) as nodes
        ) node_group,
        generate_series(0, array_length($1::integer[], 1) - 2) as i
        
        UNION ALL
        
        -- Add the final segment back to the first node
        SELECT 
          node_group.nodes[array_length($1::integer[], 1) - 1] as start_node,
          node_group.nodes[0] as end_node,
          array_length($1::integer[], 1) - 1 as segment_order
        FROM (
          SELECT unnest($1::integer[]) as nodes
        ) node_group
      ),
      segment_paths AS (
        SELECT 
          cs.segment_order,
          cs.start_node,
          cs.end_node,
          p.path_seq,
          p.node,
          p.edge,
          p.cost,
          p.agg_cost
        FROM cycle_segments cs
        CROSS JOIN LATERAL (
          SELECT 
            path_seq,
            node,
            edge,
            cost,
            agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            cs.start_node::integer, cs.end_node::integer, false
          )
          WHERE edge != -1
          ORDER BY path_seq
        ) p
      )
      SELECT 
        segment_order,
        start_node,
        end_node,
        COUNT(*) as edge_count,
        MAX(agg_cost) as segment_cost,
        array_agg(DISTINCT node ORDER BY node) as path_nodes
      FROM segment_paths
      GROUP BY segment_order, start_node, end_node
      ORDER BY segment_order
    `, [BEAR_CANYON_NODES]);
    
    if (cycleResult.rows.length === 0) {
      console.log('❌ Could not construct cycle for Bear Canyon nodes');
      return;
    }
    
    console.log(`✅ Successfully constructed cycle with ${cycleResult.rows.length} segments:`);
    
    // Calculate total cycle cost
    const totalCost = cycleResult.rows.reduce((sum, row) => sum + row.segment_cost, 0);
    const targetDistance = 15.0; // Approximate Bear Canyon loop distance
    const tolerance = 0.3; // 30% tolerance
    const minDistance = targetDistance * (1 - tolerance);
    const maxDistance = targetDistance * (1 + tolerance);
    
    console.log(`📏 Bear Canyon cycle cost: ${totalCost.toFixed(2)}km (target: ${targetDistance}km ±${tolerance * 100}%)`);
    
    cycleResult.rows.forEach(row => {
      console.log(`   Segment ${row.segment_order}: ${row.start_node} → ${row.end_node} (${row.segment_cost.toFixed(2)}km, ${row.edge_count} edges)`);
    });
    
    if (totalCost >= minDistance && totalCost <= maxDistance) {
      console.log(`✅ Bear Canyon cycle is within target distance range [${minDistance.toFixed(2)}-${maxDistance.toFixed(2)}km]`);
      
      // Collect all edges from the cycle
      const allEdges = [];
      for (const segment of cycleResult.rows) {
        const segmentEdges = await pool.query(`
          SELECT 
            p.path_seq,
            p.node,
            p.edge,
            p.cost,
            p.agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            $1::integer, $2::integer, false
          ) p
          WHERE p.edge != -1
          ORDER BY p.path_seq
        `, [segment.start_node, segment.end_node]);
        
        allEdges.push(...segmentEdges.rows);
      }
      
      console.log(`✅ Collected ${allEdges.length} total edges for Bear Canyon cycle`);
      console.log(`🎯 This cycle should be detected by the custom loop detection algorithm!`);
      
    } else {
      console.log(`⚠️ Bear Canyon cycle distance ${totalCost.toFixed(2)}km outside target range [${minDistance.toFixed(2)}-${maxDistance.toFixed(2)}km]`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testCustomLoopDetection();
