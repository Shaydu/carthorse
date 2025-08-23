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

async function compareNetworkStructure() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Comparing network structure to understand differences...');
    
    // 1. Check if the issue is with the cost threshold in Hawick Circuits
    console.log('\n1️⃣ Testing different cost thresholds for Hawick Circuits...');
    
    const costThresholds = [0.01, 0.05, 0.1, 0.5, 1.0];
    
    for (const threshold of costThresholds) {
      const hawickResult = await pool.query(`
        SELECT COUNT(DISTINCT path_id) as cycle_count
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost
           FROM ${STAGING_SCHEMA}.ways_noded
           WHERE source IS NOT NULL 
             AND target IS NOT NULL 
             AND cost >= ${threshold}
           ORDER BY id'
        )
        LIMIT 1
      `);
      
      console.log(`   Cost threshold ${threshold}: ${hawickResult.rows[0].cycle_count} cycles`);
    }
    
    // 2. Check if the Bear Canyon nodes have different connectivity now
    console.log('\n2️⃣ Checking Bear Canyon node connectivity details...');
    
    const nodeDetails = await pool.query(`
      SELECT 
        id,
        cnt as degree,
        ST_AsText(the_geom) as coordinates
      FROM ${STAGING_SCHEMA}.ways_noded_vertices_pgr
      WHERE id = ANY($1::integer[])
      ORDER BY id
    `, [BEAR_CANYON_NODES]);
    
    console.log('Bear Canyon node details:');
    nodeDetails.rows.forEach(row => {
      console.log(`   Node ${row.id}: degree ${row.degree}, coords ${row.coordinates}`);
    });
    
    // 3. Check if there are any edges with very small costs that might be filtered out
    console.log('\n3️⃣ Checking edge cost distribution...');
    
    const edgeCosts = await pool.query(`
      SELECT 
        MIN(cost) as min_cost,
        MAX(cost) as max_cost,
        AVG(cost) as avg_cost,
        COUNT(*) as total_edges,
        COUNT(CASE WHEN cost < 0.1 THEN 1 END) as small_edges,
        COUNT(CASE WHEN cost < 0.01 THEN 1 END) as tiny_edges
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);
    
    const costs = edgeCosts.rows[0];
    console.log(`Edge cost distribution:`);
    console.log(`   Min: ${costs.min_cost.toFixed(6)}km`);
    console.log(`   Max: ${costs.max_cost.toFixed(2)}km`);
    console.log(`   Avg: ${costs.avg_cost.toFixed(3)}km`);
    console.log(`   Total edges: ${costs.total_edges}`);
    console.log(`   Edges < 0.1km: ${costs.small_edges}`);
    console.log(`   Edges < 0.01km: ${costs.tiny_edges}`);
    
    // 4. Check if the Bear Canyon nodes are connected by very small edges
    console.log('\n4️⃣ Checking Bear Canyon edge costs...');
    
    const bearCanyonEdges = await pool.query(`
      SELECT 
        id,
        source,
        target,
        cost,
        trail_name
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE (source = ANY($1::integer[]) AND target = ANY($1::integer[]))
         OR (source = ANY($1::integer[]) OR target = ANY($1::integer[]))
      ORDER BY cost
    `, [BEAR_CANYON_NODES]);
    
    console.log('Bear Canyon edge costs:');
    bearCanyonEdges.rows.forEach(row => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.cost.toFixed(6)}km, ${row.trail_name})`);
    });
    
    // 5. Test Hawick Circuits with the exact same parameters as the working commit
    console.log('\n5️⃣ Testing Hawick Circuits with working commit parameters...');
    
    const workingCommitTest = await pool.query(`
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
      LIMIT 5000
    `);
    
    const cycleGroups = new Map();
    workingCommitTest.rows.forEach(row => {
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
    
    console.log(`   🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes with working commit parameters`);
    
    // 6. Check if the network has any cycles at all
    console.log('\n6️⃣ Checking if network has cycles with different thresholds...');
    
    for (const threshold of [0.001, 0.01, 0.1, 0.5]) {
      const cycleTest = await pool.query(`
        SELECT COUNT(DISTINCT path_id) as cycle_count
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost
           FROM ${STAGING_SCHEMA}.ways_noded
           WHERE source IS NOT NULL 
             AND target IS NOT NULL 
             AND cost >= ${threshold}
           ORDER BY id'
        )
        LIMIT 1
      `);
      
      console.log(`   Threshold ${threshold}: ${cycleTest.rows[0].cycle_count} cycles`);
    }
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await pool.end();
  }
}

compareNetworkStructure();
