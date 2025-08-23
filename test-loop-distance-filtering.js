#!/usr/bin/env node

const { Client } = require('pg');

async function testLoopDistanceFiltering() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing loop distance filtering...');

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

    // Get loop patterns
    const patternsResult = await client.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'loop' 
      ORDER BY target_distance_km
    `);
    
    console.log(`📋 Loop patterns:`);
    patternsResult.rows.forEach(pattern => {
      console.log(`   - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m (${pattern.tolerance_percent}% tolerance)`);
    });

    // Get all cycles with their distances
    console.log('\n🔍 Getting all cycles with distances...');
    const cyclesResult = await client.query(`
      SELECT 
        path_id,
        edge,
        cost,
        agg_cost,
        path_seq
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.ways_noded'
      )
      ORDER BY path_id, path_seq
    `);
    
    // Group by path_id and calculate total distances
    const cycles = {};
    cyclesResult.rows.forEach(row => {
      if (!cycles[row.path_id]) {
        cycles[row.path_id] = [];
      }
      cycles[row.path_id].push(row);
    });
    
    console.log(`🎯 Found ${Object.keys(cycles).length} unique cycles:`);
    
    // Check each cycle against each pattern
    Object.keys(cycles).forEach(cycleId => {
      const cycle = cycles[cycleId];
      const totalDistance = Math.max(...cycle.map(edge => edge.agg_cost));
      
      console.log(`\n🔍 Cycle ${cycleId}: ${cycle.length} edges, ${totalDistance.toFixed(2)}km total`);
      
      patternsResult.rows.forEach(pattern => {
        const minDistance = pattern.target_distance_km * (1 - pattern.tolerance_percent / 100);
        const maxDistance = pattern.target_distance_km * (1 + pattern.tolerance_percent / 100);
        
        const isInRange = totalDistance >= minDistance && totalDistance <= maxDistance;
        const status = isInRange ? '✅ MATCHES' : '❌ OUT OF RANGE';
        
        console.log(`   ${status} ${pattern.pattern_name}: ${minDistance.toFixed(2)}-${maxDistance.toFixed(2)}km range`);
      });
    });

    // Check if any cycles match any patterns
    let totalMatches = 0;
    Object.keys(cycles).forEach(cycleId => {
      const cycle = cycles[cycleId];
      const totalDistance = Math.max(...cycle.map(edge => edge.agg_cost));
      
      patternsResult.rows.forEach(pattern => {
        const minDistance = pattern.target_distance_km * (1 - pattern.tolerance_percent / 100);
        const maxDistance = pattern.target_distance_km * (1 + pattern.tolerance_percent / 100);
        
        if (totalDistance >= minDistance && totalDistance <= maxDistance) {
          totalMatches++;
        }
      });
    });
    
    console.log(`\n📊 Summary: ${totalMatches} cycle-pattern matches found`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testLoopDistanceFiltering();
