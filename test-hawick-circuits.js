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

async function testHawickCircuits() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing Hawick Circuits for Bear Canyon loop...');
    
    // Test 1: Run Hawick Circuits with different limits
    const limits = [200, 5000, 10000];
    
    for (const limit of limits) {
      console.log(`\n📊 Testing with LIMIT ${limit}...`);
      
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
             AND cost >= 0.1
           ORDER BY id'
        )
        ORDER BY path_id, path_seq
        LIMIT ${limit}
      `);
      
      console.log(`✅ Found ${hawickResult.rows.length} total edges in ${new Set(hawickResult.rows.map(r => r.path_id)).size} cycles`);
      
      // Check if any cycles contain our Bear Canyon nodes
      const cycleGroups = new Map();
      hawickResult.rows.forEach(row => {
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
      
      console.log(`   🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes`);
    }
    
    // Test 2: Check if the nodes are actually connected in cycles
    console.log('\n🔗 Checking node connectivity in cycles...');
    
    const connectivityResult = await pool.query(`
      WITH cycle_nodes AS (
        SELECT DISTINCT path_id, node
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost
           FROM ${STAGING_SCHEMA}.ways_noded
           WHERE source IS NOT NULL AND target IS NOT NULL AND cost >= 0.1
           ORDER BY id'
        )
        LIMIT 10000
      ),
      bear_canyon_cycles AS (
        SELECT path_id, COUNT(*) as bear_canyon_node_count
        FROM cycle_nodes
        WHERE node = ANY($1::integer[])
        GROUP BY path_id
        HAVING COUNT(*) >= 3
      )
      SELECT 
        bc.path_id,
        bc.bear_canyon_node_count,
        cn.node,
        v.cnt as node_degree
      FROM bear_canyon_cycles bc
      JOIN cycle_nodes cn ON bc.path_id = cn.path_id
      JOIN ${STAGING_SCHEMA}.ways_noded_vertices_pgr v ON cn.node = v.id
      WHERE cn.node = ANY($1::integer[])
      ORDER BY bc.path_id, cn.node
    `, [BEAR_CANYON_NODES]);
    
    if (connectivityResult.rows.length > 0) {
      console.log('✅ Found cycles containing Bear Canyon nodes:');
      let currentPathId = null;
      connectivityResult.rows.forEach(row => {
        if (row.path_id !== currentPathId) {
          currentPathId = row.path_id;
          console.log(`   Cycle ${row.path_id} (${row.bear_canyon_node_count}/6 Bear Canyon nodes):`);
        }
        console.log(`     Node ${row.node} (degree ${row.node_degree})`);
      });
    } else {
      console.log('❌ No cycles found containing Bear Canyon nodes');
    }
    
    // Test 3: Check the actual network structure
    console.log('\n🌐 Checking network structure...');
    
    const networkStats = await pool.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN cnt >= 3 THEN 1 END) as intersection_nodes,
        COUNT(CASE WHEN cnt = 2 THEN 1 END) as connector_nodes,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as endpoint_nodes
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
    `);
    
    const edgeStats = await pool.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN cost >= 0.1 THEN 1 END) as valid_edges,
        AVG(cost) as avg_cost,
        MIN(cost) as min_cost,
        MAX(cost) as max_cost
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);
    
    console.log('📊 Network Statistics:');
    console.log(`   Nodes: ${networkStats.rows[0].total_nodes} total (${networkStats.rows[0].intersection_nodes} intersections, ${networkStats.rows[0].connector_nodes} connectors, ${networkStats.rows[0].endpoint_nodes} endpoints)`);
    console.log(`   Edges: ${edgeStats.rows[0].total_edges} total, ${edgeStats.rows[0].valid_edges} valid (cost >= 0.1)`);
    console.log(`   Cost range: ${edgeStats.rows[0].min_cost.toFixed(3)} - ${edgeStats.rows[0].max_cost.toFixed(3)} km (avg: ${edgeStats.rows[0].avg_cost.toFixed(3)} km)`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testHawickCircuits();
