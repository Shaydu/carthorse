#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function main() {
  console.log('🔍 Finding all Bear Peak related trails...');
  
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    // Get ALL trails that mention Bear Peak
    console.log('\n📋 All Bear Peak related trails:');
    const allBearPeakResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Peak%'
      ORDER BY trail_name, id
    `);
    
    allBearPeakResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check if there are separate Bear Peak and Bear Peak West Ridge trails
    console.log('\n🔍 Bear Peak Trail (excluding West Ridge):');
    const bearPeakOnlyResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Peak%' 
        AND trail_name NOT LIKE '%West Ridge%'
      ORDER BY id
    `);
    
    bearPeakOnlyResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    console.log('\n🔍 Bear Peak West Ridge Trail:');
    const bearPeakWestRidgeResult = await pool.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${stagingSchema}.ways_noded
      WHERE trail_name LIKE '%Bear Peak West Ridge%'
      ORDER BY id
    `);
    
    bearPeakWestRidgeResult.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check what connects to the Bear Peak area nodes
    console.log('\n🔗 Node 340 connections (Bear Peak area):');
    const node340Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 340 OR e.target = 340
      ORDER BY e.id
    `);
    
    node340Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    console.log('\n🔗 Node 341 connections (Bear Peak area):');
    const node341Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 341 OR e.target = 341
      ORDER BY e.id
    `);
    
    node341Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    console.log('\n🔗 Node 335 connections (Bear Peak West Ridge area):');
    const node335Result = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE e.source = 335 OR e.target = 335
      ORDER BY e.id
    `);
    
    node335Result.rows.forEach((row: any) => {
      console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
    });
    
    // Check if there's a connection between Bear Peak and Bear Peak West Ridge
    console.log('\n🔗 Checking for Bear Peak to Bear Peak West Ridge connection:');
    const connectionResult = await pool.query(`
      SELECT e.id, e.source, e.target, e.trail_name, e.length_km
      FROM ${stagingSchema}.ways_noded e
      WHERE (e.source = 340 AND e.target = 335) 
         OR (e.source = 335 AND e.target = 340)
         OR (e.source = 341 AND e.target = 335)
         OR (e.source = 335 AND e.target = 341)
      ORDER BY e.id
    `);
    
    if (connectionResult.rows.length > 0) {
      connectionResult.rows.forEach((row: any) => {
        console.log(`   Edge ${row.id}: ${row.source} → ${row.target} (${row.trail_name}) - ${row.length_km.toFixed(3)}km`);
      });
    } else {
      console.log('   ❌ No direct connection found between Bear Peak and Bear Peak West Ridge');
    }
    
    // Let me also check what the user's desired loop should look like
    console.log('\n🎯 Analyzing the desired Bear Canyon loop:');
    console.log('   The loop should be: Fern Canyon → Bear Canyon → Bear Peak → Bear Peak West Ridge → Fern Canyon');
    console.log('   This requires:');
    console.log('   1. Fern Canyon segments ✓');
    console.log('   2. Bear Canyon segment ✓');
    console.log('   3. Bear Peak Trail (separate from West Ridge) ❓');
    console.log('   4. Bear Peak West Ridge Trail ✓');
    console.log('   5. Connection between Bear Peak and Bear Peak West Ridge ❓');
    
  } catch (error) {
    console.error('❌ Error finding Bear Peak trails:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
