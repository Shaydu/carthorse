#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function main() {
  console.log('🔍 Checking Bear Peak Trail connectivity...');
  
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    // Check the specific edge that both Bear Peak and Bear Peak West Ridge share
    console.log('\n🔍 Edge 839 (shared by both Bear Peak and Bear Peak West Ridge):');
    const edge839Result = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE id = 839
    `);
    
    edge839Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check what connects to node 341 (Bear Peak end)
    console.log('\n🔗 Node 341 connections:');
    const node341Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 341 OR e.target = 341
      ORDER BY e.id
    `);
    
    node341Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check what connects to node 335 (Bear Peak West Ridge end)
    console.log('\n🔗 Node 335 connections:');
    const node335Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 335 OR e.target = 335
      ORDER BY e.id
    `);
    
    node335Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check if there's a separate Bear Peak West Ridge trail that should exist
    console.log('\n🔍 Looking for separate Bear Peak West Ridge trail:');
    const allBearPeakResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Peak%'
      ORDER BY id
    `);
    
    allBearPeakResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check if there should be a connection between Bear Peak and Bear Peak West Ridge
    console.log('\n🔍 Checking if there should be a separate connection:');
    const missingConnectionResult = await pool.query(`
      SELECT 
        n1.id as node1_id, n1.x as node1_lng, n1.y as node1_lat,
        n2.id as node2_id, n2.x as node2_lng, n2.y as node2_lat,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(n1.x, n1.y), 4326),
          ST_SetSRID(ST_MakePoint(n2.x, n2.y), 4326)
        ) * 111.32 as distance_km
      FROM ${stagingSchema}.ways_noded_vertices_pgr n1
      CROSS JOIN ${stagingSchema}.ways_noded_vertices_pgr n2
      WHERE n1.id = 341 AND n2.id = 335
    `);
    
    if (missingConnectionResult.rows.length > 0) {
      const row = missingConnectionResult.rows[0];
      console.log(`   Distance between Bear Peak (${row.node1_id}) and Bear Peak West Ridge (${row.node2_id}): ${row.distance_km.toFixed(3)}km`);
      console.log(`   Bear Peak: (${row.node1_lat}, ${row.node1_lng})`);
      console.log(`   Bear Peak West Ridge: (${row.node2_lat}, ${row.node2_lng})`);
    }
    
    // Check what the user's desired loop should look like
    console.log('\n🎯 User\'s desired Bear Canyon loop components:');
    console.log('   1. 2 Fern Canyon segments ✓ (found: edges 781, 862)');
    console.log('   2. 1 Bear Peak segment ✓ (found: edge 839)');
    console.log('   3. 1 Bear Peak West Ridge segment ❌ (missing - should be separate from Bear Peak)');
    console.log('   4. 1 Bear Canyon segment ✓ (found: edge 944)');
    console.log('   5. 1 Mesa segment ✓ (found: multiple Mesa Trail segments)');
    
    console.log('\n❌ PROBLEM: Bear Peak Trail and Bear Peak West Ridge Trail are the SAME edge (839)!');
    console.log('   This prevents forming a true loop because you can\'t traverse the same edge twice.');
    console.log('   The Bear Peak West Ridge should be a separate trail segment that connects to Bear Peak.');
    
  } catch (error) {
    console.error('❌ Error checking connectivity:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
