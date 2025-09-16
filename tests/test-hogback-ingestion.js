#!/usr/bin/env node

const { Client } = require('pg');

async function testHogbackIngestion() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing Hogback Ridge ingestion...');

    // Check if Hogback Ridge exists in public with the current filter
    const publicResult = await client.query(`
      SELECT app_uuid, name, length_km, region, source,
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_IsSimple(geometry) as is_simple
      FROM public.trails
      WHERE name ILIKE '%hogback%'
      ORDER BY name
    `);

    console.log(`\n📋 Hogback Ridge in public:`);
    console.log(`   - Total trails: ${publicResult.rows.length}`);
    
    publicResult.rows.forEach((trail, index) => {
      console.log(`   Trail ${index + 1}:`);
      console.log(`     UUID: ${trail.app_uuid}`);
      console.log(`     Name: ${trail.name}`);
      console.log(`     Length: ${trail.length_km}km`);
      console.log(`     Region: ${trail.region}`);
      console.log(`     Source: ${trail.source}`);
      console.log(`     Is Simple: ${trail.is_simple}`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
      console.log('');
    });

    // Check if it would be included with the current filter
    const filterResult = await client.query(`
      SELECT COUNT(*) as count
      FROM public.trails
      WHERE geometry IS NOT NULL
        AND region = 'boulder'
        AND source = 'cotrex'
        AND name ILIKE '%hogback%'
    `);

    console.log(`📋 Would be included with current filter: ${filterResult.rows[0].count > 0 ? 'YES' : 'NO'}`);

    // Check if it's in staging
    const stagingResult = await client.query(`
      SELECT app_uuid, name, length_km,
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_IsSimple(geometry) as is_simple
      FROM staging.trails
      WHERE name ILIKE '%hogback%'
      ORDER BY name
    `);

    console.log(`\n📋 Hogback Ridge in staging:`);
    console.log(`   - Total trails: ${stagingResult.rows.length}`);
    
    if (stagingResult.rows.length > 0) {
      stagingResult.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}:`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Name: ${trail.name}`);
        console.log(`     Length: ${trail.length_km}km`);
        console.log(`     Is Simple: ${trail.is_simple}`);
        console.log(`     Start: ${trail.start_point}`);
        console.log(`     End: ${trail.end_point}`);
        console.log('');
      });
    } else {
      console.log('   ❌ No Hogback Ridge trails found in staging!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testHogbackIngestion();
