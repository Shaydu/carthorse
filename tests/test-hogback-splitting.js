#!/usr/bin/env node

const { Client } = require('pg');

async function testHogbackSplitting() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Testing Hogback Ridge splitting in current version...');

    // Check if Hogback Ridge exists in staging
    const stagingResult = await client.query(`
      SELECT COUNT(*) as count, 
             COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count
      FROM staging.trails 
      WHERE name ILIKE '%hogback%'
    `);

    console.log(`\n📋 Hogback Ridge in staging:`);
    console.log(`   - Total trails: ${stagingResult.rows[0].count}`);
    console.log(`   - Non-simple geometries: ${stagingResult.rows[0].non_simple_count}`);

    if (stagingResult.rows[0].count > 0) {
      // Show details of Hogback trails in staging
      const hogbackTrails = await client.query(`
        SELECT id, app_uuid, name, 
               ST_Length(geometry::geography) as length_meters,
               ST_NumPoints(geometry) as num_points,
               ST_IsSimple(geometry) as is_simple,
               ST_GeometryType(geometry) as geom_type
        FROM staging.trails 
        WHERE name ILIKE '%hogback%'
        ORDER BY id
      `);

      console.log(`\n📋 Hogback Ridge trail details:`);
      hogbackTrails.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}:`);
        console.log(`     ID: ${trail.id}`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Name: ${trail.name}`);
        console.log(`     Length: ${trail.length_meters?.toFixed(2)} meters`);
        console.log(`     Points: ${trail.num_points}`);
        console.log(`     Is Simple: ${trail.is_simple}`);
        console.log(`     Geometry Type: ${trail.geom_type}`);
        console.log('');
      });
    }

    // Check if there are any split segments
    const splitSegments = await client.query(`
      SELECT COUNT(*) as count
      FROM staging.trails 
      WHERE name ILIKE '%hogback%' AND name ILIKE '%segment%'
    `);

    console.log(`📋 Split segments: ${splitSegments.rows[0].count}`);

    // Check public.trails for comparison
    const publicResult = await client.query(`
      SELECT COUNT(*) as count, 
             COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_count
      FROM public.trails 
      WHERE name ILIKE '%hogback%'
    `);

    console.log(`\n📋 Hogback Ridge in public:`);
    console.log(`   - Total trails: ${publicResult.rows[0].count}`);
    console.log(`   - Non-simple geometries: ${publicResult.rows[0].non_simple_count}`);

    if (publicResult.rows[0].non_simple_count > 0) {
      const publicHogback = await client.query(`
        SELECT id, app_uuid, name, 
               ST_Length(geometry::geography) as length_meters,
               ST_NumPoints(geometry) as num_points,
               ST_IsSimple(geometry) as is_simple
        FROM public.trails 
        WHERE name ILIKE '%hogback%' AND NOT ST_IsSimple(geometry)
        ORDER BY id
      `);

      console.log(`\n📋 Non-simple Hogback Ridge in public:`);
      publicHogback.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}:`);
        console.log(`     ID: ${trail.id}`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Name: ${trail.name}`);
        console.log(`     Length: ${trail.length_meters?.toFixed(2)} meters`);
        console.log(`     Points: ${trail.num_points}`);
        console.log(`     Is Simple: ${trail.is_simple}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testHogbackSplitting();
