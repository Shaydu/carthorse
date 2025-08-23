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

async function testNetworkGeneration() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing network generation with pgr_createTopology approach...');
    
    // Import the PostgisNodeStrategy
    const { PostgisNodeStrategy } = require('./src/utils/services/network-creation/strategies/postgis-node-strategy.ts');
    
    const strategy = new PostgisNodeStrategy();
    const config = {
      stagingSchema: STAGING_SCHEMA,
      tolerances: {
        intersectionDetectionTolerance: 0.00001,
        edgeToVertexTolerance: 0.001,
        graphAnalysisTolerance: 0.00001,
        trueLoopTolerance: 0.00001,
        minTrailLengthMeters: 50,
        maxTrailLengthMeters: 100000
      }
    };
    
    console.log('🔄 Creating network with pgr_createTopology...');
    const result = await strategy.createNetwork(pool, config);
    
    if (result.success) {
      console.log('✅ Network creation successful!');
      console.log(`📊 Network stats: ${result.stats.nodesCreated} nodes, ${result.stats.edgesCreated} edges`);
      
      // Now test if we can find Bear Canyon cycles
      console.log('\n🔍 Testing Bear Canyon loop detection...');
      
      const BEAR_CANYON_NODES = [356, 357, 332, 336, 333, 339];
      
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
             AND cost <= 5.0
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
        }
      }
      
      console.log(`🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes!`);
      
      if (bearCanyonCycles > 0) {
        console.log('✅ SUCCESS: Bear Canyon loop detection is working with pgr_createTopology!');
      } else {
        console.log('❌ Still no Bear Canyon cycles found');
      }
      
    } else {
      console.error('❌ Network creation failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testNetworkGeneration();

const { Pool } = require('pg');

// Database configuration
const dbConfig = {
  database: 'trail_master_db',
  user: 'shaydu',
  host: 'localhost',
  port: 5432,
};

const STAGING_SCHEMA = 'carthorse_1755964844744';

async function testNetworkGeneration() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔍 Testing network generation with pgr_createTopology approach...');
    
    // Import the PostgisNodeStrategy
    const { PostgisNodeStrategy } = require('./src/utils/services/network-creation/strategies/postgis-node-strategy.ts');
    
    const strategy = new PostgisNodeStrategy();
    const config = {
      stagingSchema: STAGING_SCHEMA,
      tolerances: {
        intersectionDetectionTolerance: 0.00001,
        edgeToVertexTolerance: 0.001,
        graphAnalysisTolerance: 0.00001,
        trueLoopTolerance: 0.00001,
        minTrailLengthMeters: 50,
        maxTrailLengthMeters: 100000
      }
    };
    
    console.log('🔄 Creating network with pgr_createTopology...');
    const result = await strategy.createNetwork(pool, config);
    
    if (result.success) {
      console.log('✅ Network creation successful!');
      console.log(`📊 Network stats: ${result.stats.nodesCreated} nodes, ${result.stats.edgesCreated} edges`);
      
      // Now test if we can find Bear Canyon cycles
      console.log('\n🔍 Testing Bear Canyon loop detection...');
      
      const BEAR_CANYON_NODES = [356, 357, 332, 336, 333, 339];
      
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
             AND cost <= 5.0
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
        }
      }
      
      console.log(`🎯 Found ${bearCanyonCycles} cycles containing Bear Canyon nodes!`);
      
      if (bearCanyonCycles > 0) {
        console.log('✅ SUCCESS: Bear Canyon loop detection is working with pgr_createTopology!');
      } else {
        console.log('❌ Still no Bear Canyon cycles found');
      }
      
    } else {
      console.error('❌ Network creation failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testNetworkGeneration();
