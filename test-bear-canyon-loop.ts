#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { RoutePatternSqlHelpers } from './src/utils/sql/route-pattern-sql-helpers';

async function testBearCanyonLoop() {
  console.log('🧪 Testing Bear Canyon loop detection...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    const stagingSchema = 'staging_boulder_1755370137573';
    const routeHelpers = new RoutePatternSqlHelpers(pgClient);

    console.log('🔍 Step 1: Checking routing network statistics...');
    
    // Check routing network stats
    const stats = await pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes) as nodes_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges) as edges_count,
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges WHERE trail_name LIKE '%Bear Canyon%') as bear_canyon_edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges WHERE trail_name LIKE '%Bear Peak West Ridge%') as bear_peak_west_ridge_edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges WHERE trail_name LIKE '%Fern Canyon%') as fern_canyon_edges
    `);
    
    console.log('📊 Routing Network Statistics:');
    console.log(JSON.stringify(stats.rows[0], null, 2));

    console.log('🔍 Step 2: Testing loop detection...');
    
    // Try to find loops using the route helpers
    const loops = await routeHelpers.generateLoopRoutes(stagingSchema, 10.0, 500, 1000);
    
    console.log(`✅ Found ${loops.length} potential loops`);
    
    // Check if any of the loops contain Bear Canyon trails
    for (const loop of loops) {
      console.log(`🔍 Loop ${loop.cycle_id || 'unknown'}: ${(loop.total_distance || 0).toFixed(2)}km, ${(loop.total_elevation_gain || 0).toFixed(0)}m elevation`);
      
      // Get the trail names in this loop
      const trailNames = await pgClient.query(`
        SELECT DISTINCT trail_name 
        FROM ${stagingSchema}.routing_edges 
        WHERE id = ANY($1::integer[])
        ORDER BY trail_name
      `, [loop.edges.map((e: any) => e.edge_id)]);
      
      const names = trailNames.rows.map((r: any) => r.trail_name);
      console.log(`   Trails: ${names.join(', ')}`);
      
      // Check if this is the Bear Canyon loop
      const hasBearCanyon = names.some((name: string) => name.includes('Bear Canyon'));
      const hasBearPeakWestRidge = names.some((name: string) => name.includes('Bear Peak West Ridge'));
      const hasFernCanyon = names.some((name: string) => name.includes('Fern Canyon'));
      
      if (hasBearCanyon && hasBearPeakWestRidge && hasFernCanyon) {
        console.log(`🎯 FOUND THE BEAR CANYON LOOP!`);
        console.log(`   Distance: ${loop.total_distance.toFixed(2)}km`);
        console.log(`   Elevation: ${loop.total_elevation_gain.toFixed(0)}m`);
        console.log(`   Trail count: ${loop.trail_count || 'unknown'}`);
      }
    }

  } catch (error) {
    console.error('❌ Error testing Bear Canyon loop:', error);
  } finally {
    await pgClient.end();
  }
}

testBearCanyonLoop();
