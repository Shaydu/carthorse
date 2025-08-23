#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
});

async function testLoopGeneration() {
  const stagingSchema = 'carthorse_1755961883651';
  
  try {
    console.log('🔍 Testing loop generation components...\n');
    
    // 1. Test pattern loading
    console.log('1. Testing pattern loading...');
    const patterns = await pool.query(`
      SELECT pattern_name, target_distance_km, target_elevation_gain, tolerance_percent
      FROM public.route_patterns 
      WHERE route_shape = 'loop' 
      ORDER BY target_distance_km
    `);
    console.log(`✅ Loaded ${patterns.rows.length} patterns:`);
    patterns.rows.forEach(p => console.log(`   - ${p.pattern_name}: ${p.target_distance_km}km ± ${p.tolerance_percent}%`));
    
    // 2. Test pgr_hawickcircuits
    console.log('\n2. Testing pgr_hawickcircuits...');
    const cycles = await pool.query(`
      SELECT path_id, MAX(agg_cost) as total_distance_km, COUNT(*) as edge_count 
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, cost, reverse_cost 
         FROM ${stagingSchema}.ways_noded 
         WHERE source IS NOT NULL AND target IS NOT NULL AND cost >= 0.1 
         ORDER BY id'
      )
      GROUP BY path_id 
      ORDER BY total_distance_km
    `);
    console.log(`✅ Found ${cycles.rows.length} total cycles`);
    
    // 3. Test pattern matching
    console.log('\n3. Testing pattern matching...');
    for (const pattern of patterns.rows) {
      const minDistance = pattern.target_distance_km * (1 - pattern.tolerance_percent / 100);
      const maxDistance = pattern.target_distance_km * (1 + pattern.tolerance_percent / 100);
      
      const matchingCycles = cycles.rows.filter(cycle => 
        cycle.total_distance_km >= minDistance && cycle.total_distance_km <= maxDistance
      );
      
      console.log(`   ${pattern.pattern_name} (${minDistance.toFixed(1)}-${maxDistance.toFixed(1)}km): ${matchingCycles.length} matching cycles`);
      
      if (matchingCycles.length > 0) {
        console.log(`     Examples: ${matchingCycles.slice(0, 3).map(c => `${c.total_distance_km.toFixed(2)}km`).join(', ')}`);
      }
    }
    
    // 4. Test a specific cycle to see if it can be converted to a route
    console.log('\n4. Testing cycle to route conversion...');
    const testCycle = cycles.rows.find(c => c.total_distance_km >= 1.0 && c.total_distance_km <= 3.0);
    if (testCycle) {
      console.log(`   Testing cycle ${testCycle.path_id} (${testCycle.total_distance_km.toFixed(2)}km)...`);
      
      const cycleEdges = await pool.query(`
        SELECT path_id, seq, path_seq, node, edge, cost, agg_cost
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost 
           FROM ${stagingSchema}.ways_noded 
           WHERE source IS NOT NULL AND target IS NOT NULL AND cost >= 0.1 
           ORDER BY id'
        )
        WHERE path_id = $1
        ORDER BY path_seq
      `, [testCycle.path_id]);
      
      console.log(`   ✅ Cycle has ${cycleEdges.rows.length} edges`);
      
      // Test if we can get trail details for this cycle
      const edgeIds = cycleEdges.rows.map(e => e.edge).filter(id => id !== -1);
      if (edgeIds.length > 0) {
        const trailDetails = await pool.query(`
          SELECT DISTINCT wn.id, wn.trail_name, w.length_km, w.elevation_gain
          FROM ${stagingSchema}.ways_noded wn
          JOIN ${stagingSchema}.ways w ON wn.id = w.id
          WHERE wn.id = ANY($1)
        `, [edgeIds]);
        
        console.log(`   ✅ Found ${trailDetails.rows.length} unique trails in cycle`);
        trailDetails.rows.forEach(t => console.log(`     - ${t.trail_name}: ${t.length_km.toFixed(2)}km, ${t.elevation_gain || 0}m`));
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testLoopGeneration();
