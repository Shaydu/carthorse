#!/usr/bin/env node

const { Client } = require('pg');

async function testNetworkCycles() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing network cycles...');

    // Get the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);

    // Check if ways_noded table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'ways_noded'
      )
    `, [stagingSchema]);

    if (!tableExists.rows[0].exists) {
      console.log('❌ ways_noded table does not exist');
      return;
    }

    // Check network stats
    const networkStats = await client.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(DISTINCT source) as unique_sources,
        COUNT(DISTINCT target) as unique_targets
      FROM ${stagingSchema}.ways_noded
    `);
    
    console.log(`📊 Network stats:`);
    console.log(`   Total edges: ${networkStats.rows[0].total_edges}`);
    console.log(`   Unique sources: ${networkStats.rows[0].unique_sources}`);
    console.log(`   Unique targets: ${networkStats.rows[0].unique_targets}`);

    // Test pgr_hawickcircuits
    console.log('\n🔍 Testing pgr_hawickcircuits...');
    try {
      const cyclesResult = await client.query(`
        SELECT 
          path_id as cycle_id,
          edge as edge_id,
          cost,
          agg_cost,
          path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.ways_noded'
        )
        ORDER BY path_id, path_seq
        LIMIT 100
      `);
      
      console.log(`✅ Found ${cyclesResult.rows.length} cycle edges`);
      
      if (cyclesResult.rows.length > 0) {
        // Group by cycle_id
        const cycles = {};
        cyclesResult.rows.forEach(row => {
          if (!cycles[row.cycle_id]) {
            cycles[row.cycle_id] = [];
          }
          cycles[row.cycle_id].push(row);
        });
        
        console.log(`🎯 Found ${Object.keys(cycles).length} unique cycles`);
        
        // Show first few cycles
        Object.keys(cycles).slice(0, 3).forEach(cycleId => {
          const cycle = cycles[cycleId];
          const totalCost = cycle[cycle.length - 1]?.agg_cost || 0;
          console.log(`   Cycle ${cycleId}: ${cycle.length} edges, ${totalCost.toFixed(2)}km total`);
        });
      } else {
        console.log('❌ No cycles found in the network');
      }
    } catch (error) {
      console.error('❌ Error running pgr_hawickcircuits:', error.message);
    }

    // Check if there are any simple cycles (A->B->A)
    console.log('\n🔍 Checking for simple cycles...');
    const simpleCycles = await client.query(`
      SELECT 
        e1.source,
        e1.target,
        e2.source as return_source,
        e2.target as return_target,
        e1.length_km + e2.length_km as total_length
      FROM ${stagingSchema}.ways_noded e1
      JOIN ${stagingSchema}.ways_noded e2 ON e1.target = e2.source
      WHERE e1.source = e2.target
        AND e1.id != e2.id
      LIMIT 10
    `);
    
    console.log(`🔍 Found ${simpleCycles.rows.length} simple cycles (A->B->A)`);
    if (simpleCycles.rows.length > 0) {
      simpleCycles.rows.forEach((cycle, i) => {
        console.log(`   ${i + 1}. ${cycle.source} -> ${cycle.target} -> ${cycle.return_source} (${cycle.total_length.toFixed(2)}km)`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testNetworkCycles();
