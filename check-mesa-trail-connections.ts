#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function main() {
  console.log('🔍 Checking Mesa Trail connections...');
  
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    // Check Mesa Trail segments
    console.log('\n🌿 Mesa Trail segments:');
    const mesaTrailResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Mesa Trail%'
      ORDER BY id
    `);
    
    mesaTrailResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check what connects to node 358 (Mesa Trail)
    console.log('\n🔗 Node 358 connections (Mesa Trail):');
    const node358Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 358 OR e.target = 358
      ORDER BY e.id
    `);
    
    node358Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check what connects to node 334 (Fern Canyon)
    console.log('\n🔗 Node 334 connections (Fern Canyon):');
    const node334Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 334 OR e.target = 334
      ORDER BY e.id
    `);
    
    node334Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check what connects to node 341 (Bear Canyon)
    console.log('\n🔗 Node 341 connections (Bear Canyon):');
    const node341Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 341 OR e.target = 341
      ORDER BY e.id
    `);
    
    node341Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Test the specific connections we need
    console.log('\n🔍 Testing specific connections:');
    
    // Test 334 → 358 (Fern Canyon to Mesa Trail)
    const fernToMesaResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE (source = 334 AND target = 358) OR (source = 358 AND target = 334)
    `);
    
    if (fernToMesaResult.rows.length > 0) {
      const edge = fernToMesaResult.rows[0];
      console.log(`   ✅ 334 → 358: Edge ${edge.id} (${edge.trail_name})`);
    } else {
      console.log(`   ❌ 334 → 358: No direct connection`);
    }
    
    // Test 358 → 341 (Mesa Trail to Bear Canyon)
    const mesaToBearResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE (source = 358 AND target = 341) OR (source = 341 AND target = 358)
    `);
    
    if (mesaToBearResult.rows.length > 0) {
      const edge = mesaToBearResult.rows[0];
      console.log(`   ✅ 358 → 341: Edge ${edge.id} (${edge.trail_name})`);
    } else {
      console.log(`   ❌ 358 → 341: No direct connection`);
    }
    
  } catch (error) {
    console.error('❌ Error checking Mesa Trail connections:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
