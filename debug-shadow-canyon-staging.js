#!/usr/bin/env node

const { Pool } = require('pg');

async function debugShadowCanyonInStaging() {
  console.log('🔍 Debugging Shadow Canyon Trail in staging schema...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT nspname as schema_name 
      FROM pg_namespace 
      WHERE nspname LIKE 'staging_%' 
      ORDER BY nspname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check 1: Look for Shadow Canyon Trail by name
    console.log('\n🔍 Check 1: Looking for Shadow Canyon Trail by name...');
    const byNameResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        original_trail_uuid,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        length_km
      FROM ${stagingSchema}.trails
      WHERE LOWER(name) LIKE '%shadow canyon%'
      ORDER BY name
    `);
    
    console.log(`Found ${byNameResult.rows.length} trails with "Shadow Canyon" in name:`);
    byNameResult.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. UUID: ${trail.app_uuid}`);
      console.log(`     Name: ${trail.name}`);
      console.log(`     Original UUID: ${trail.original_trail_uuid || 'NULL'}`);
      console.log(`     Points: ${trail.num_points}`);
      console.log(`     Length: ${trail.length_meters}m (${trail.length_km}km)`);
      console.log('');
    });
    
    // Check 2: Look for the specific original UUID
    console.log('🔍 Check 2: Looking for original UUID e393e414-b14f-46a1-9734-e6e582c602ac...');
    const byOriginalUuidResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        original_trail_uuid,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        length_km
      FROM ${stagingSchema}.trails
      WHERE original_trail_uuid = 'e393e414-b14f-46a1-9734-e6e582c602ac'
      ORDER BY name
    `);
    
    console.log(`Found ${byOriginalUuidResult.rows.length} trails with original_trail_uuid = 'e393e414-b14f-46a1-9734-e6e582c602ac':`);
    byOriginalUuidResult.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. UUID: ${trail.app_uuid}`);
      console.log(`     Name: ${trail.name}`);
      console.log(`     Original UUID: ${trail.original_trail_uuid}`);
      console.log(`     Points: ${trail.num_points}`);
      console.log(`     Length: ${trail.length_meters}m (${trail.length_km}km)`);
      console.log('');
    });
    
    // Check 3: Look for the specific app_uuid that the export is checking
    console.log('🔍 Check 3: Looking for app_uuid a75a0adb-aeba-40dd-968f-18b592cd1a7c...');
    const byAppUuidResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        original_trail_uuid,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        length_km
      FROM ${stagingSchema}.trails
      WHERE app_uuid = 'a75a0adb-aeba-40dd-968f-18b592cd1a7c'
    `);
    
    console.log(`Found ${byAppUuidResult.rows.length} trails with app_uuid = 'a75a0adb-aeba-40dd-968f-18b592cd1a7c':`);
    byAppUuidResult.rows.forEach((trail, index) => {
      console.log(`  ${index + 1}. UUID: ${trail.app_uuid}`);
      console.log(`     Name: ${trail.name}`);
      console.log(`     Original UUID: ${trail.original_trail_uuid || 'NULL'}`);
      console.log(`     Points: ${trail.num_points}`);
      console.log(`     Length: ${trail.length_meters}m (${trail.length_km}km)`);
      console.log('');
    });
    
    // Check 4: Get total trail count
    console.log('🔍 Check 4: Total trail count in staging...');
    const totalCountResult = await pgClient.query(`
      SELECT COUNT(*) as total_trails
      FROM ${stagingSchema}.trails
    `);
    console.log(`Total trails in staging: ${totalCountResult.rows[0].total_trails}`);
    
    // Check 5: Check for any trails with original_trail_uuid set (indicating they were split)
    console.log('\n🔍 Check 5: Trails that were split (have original_trail_uuid)...');
    const splitTrailsResult = await pgClient.query(`
      SELECT 
        COUNT(*) as split_trail_count,
        COUNT(DISTINCT original_trail_uuid) as unique_original_trails
      FROM ${stagingSchema}.trails
      WHERE original_trail_uuid IS NOT NULL
    `);
    console.log(`Split trails: ${splitTrailsResult.rows[0].split_trail_count}`);
    console.log(`Unique original trails that were split: ${splitTrailsResult.rows[0].unique_original_trails}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugShadowCanyonInStaging();
