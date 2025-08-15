#!/usr/bin/env ts-node

/**
 * Debug GeometryCollection Error
 * 
 * This script identifies specific geometries causing the liblwgeom error:
 * "liblwgeom/lwgeom_api.c [138] called with n=0 and npoints=0"
 */

import { Pool } from 'pg';

async function debugGeometryCollectionError() {
  console.log('🔍 Debugging GeometryCollection error...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    // Use the most recent schema
    const stagingSchema = 'carthorse_1755212775548';

    console.log('📊 Step 1: Analyzing trail geometries...');
    
    // Find trails with potential issues
    const problematicTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_GeometryType(geometry) as geom_type,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_IsValid(geometry) as is_valid,
        ST_IsSimple(geometry) as is_simple,
        ST_StartPoint(geometry) = ST_EndPoint(geometry) as is_loop
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY ST_NumPoints(geometry) ASC, ST_Length(geometry::geography) ASC
    `);

    console.log(`📈 Found ${problematicTrails.rows.length} trails to analyze`);

    // Categorize problematic trails
    const zeroPointTrails = problematicTrails.rows.filter(t => t.num_points === 0);
    const singlePointTrails = problematicTrails.rows.filter(t => t.num_points === 1);
    const twoPointTrails = problematicTrails.rows.filter(t => t.num_points === 2);
    const shortTrails = problematicTrails.rows.filter(t => t.length_meters < 5);
    const invalidTrails = problematicTrails.rows.filter(t => !t.is_valid);
    const loops = problematicTrails.rows.filter(t => t.is_loop);

    console.log('\n📊 Geometry Analysis:');
    console.log(`   Zero point trails: ${zeroPointTrails.length}`);
    console.log(`   Single point trails: ${singlePointTrails.length}`);
    console.log(`   Two point trails: ${twoPointTrails.length}`);
    console.log(`   Short trails (<5m): ${shortTrails.length}`);
    console.log(`   Invalid trails: ${invalidTrails.length}`);
    console.log(`   Self-loops: ${loops.length}`);

    // Show examples of problematic trails
    if (zeroPointTrails.length > 0) {
      console.log('\n❌ Zero point trails:');
      zeroPointTrails.slice(0, 5).forEach(t => {
        console.log(`   - ${t.name} (${t.app_uuid}) - Type: ${t.geom_type}`);
      });
    }

    if (twoPointTrails.length > 0) {
      console.log('\n⚠️ Two point trails:');
      twoPointTrails.slice(0, 5).forEach(t => {
        console.log(`   - ${t.name} (${t.app_uuid}) - Length: ${t.length_meters?.toFixed(2)}m`);
      });
    }

    if (shortTrails.length > 0) {
      console.log('\n⚠️ Short trails:');
      shortTrails.slice(0, 5).forEach(t => {
        console.log(`   - ${t.name} (${t.app_uuid}) - Length: ${t.length_meters?.toFixed(2)}m, Points: ${t.num_points}`);
      });
    }

    console.log('\n🔍 Step 2: Testing pgRouting functions on individual problematic trails...');

    // Test pgRouting functions on the most problematic trails
    const testTrails = [...shortTrails, ...twoPointTrails].slice(0, 10);
    
    for (const trail of testTrails) {
      console.log(`\n🧪 Testing trail: ${trail.name} (${trail.app_uuid})`);
      console.log(`   Points: ${trail.num_points}, Length: ${trail.length_meters?.toFixed(2)}m, Valid: ${trail.is_valid}`);
      
      try {
        // Create test table with single trail
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.test_single_trail`);
        await pgClient.query(`
          CREATE TABLE ${stagingSchema}.test_single_trail AS
          SELECT 
            1 as id,
            ST_Force2D(geometry) as geom
          FROM ${stagingSchema}.trails
          WHERE app_uuid = $1
        `, [trail.app_uuid]);

        // Test pgr_separateCrossing
        try {
          await pgClient.query(`
            SELECT pgr_separateCrossing(
              'SELECT id, geom FROM ${stagingSchema}.test_single_trail', 
              0.000001
            )
          `);
          console.log('   ✅ pgr_separateCrossing: SUCCESS');
        } catch (error) {
          console.log(`   ❌ pgr_separateCrossing: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Test pgr_separateTouching
        try {
          await pgClient.query(`
            SELECT pgr_separateTouching(
              'SELECT id, geom FROM ${stagingSchema}.test_single_trail', 
              0.000001
            )
          `);
          console.log('   ✅ pgr_separateTouching: SUCCESS');
        } catch (error) {
          console.log(`   ❌ pgr_separateTouching: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

      } catch (error) {
        console.log(`   ❌ Test setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n🔍 Step 3: Testing ST_Node on problematic trails...');

    // Test ST_Node on individual trails
    for (const trail of testTrails.slice(0, 5)) {
      console.log(`\n🧪 Testing ST_Node on: ${trail.name}`);
      
      try {
        const nodeResult = await pgClient.query(`
          SELECT ST_NumPoints(ST_Node(geometry)) as node_points
          FROM ${stagingSchema}.trails
          WHERE app_uuid = $1
        `, [trail.app_uuid]);
        
        console.log(`   ✅ ST_Node result: ${nodeResult.rows[0]?.node_points} points`);
      } catch (error) {
        console.log(`   ❌ ST_Node failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n🔍 Step 4: Testing ST_Node on combinations of problematic trails...');

    // Test ST_Node on combinations of problematic trails
    const problematicCombinations = [
      shortTrails.slice(0, 2),
      twoPointTrails.slice(0, 2),
      [...shortTrails.slice(0, 1), ...twoPointTrails.slice(0, 1)]
    ];

    for (let i = 0; i < problematicCombinations.length; i++) {
      const combination = problematicCombinations[i];
      if (combination.length === 0) continue;
      
      console.log(`\n🧪 Testing ST_Node on combination ${i + 1}:`);
      combination.forEach(t => console.log(`   - ${t.name} (${t.num_points} points, ${t.length_meters?.toFixed(2)}m)`));
      
      try {
        const uuids = combination.map(t => `'${t.app_uuid}'`).join(',');
        const nodeResult = await pgClient.query(`
          SELECT ST_NumPoints(ST_Node(ST_Collect(geometry))) as node_points
          FROM ${stagingSchema}.trails
          WHERE app_uuid IN (${uuids})
        `);
        
        console.log(`   ✅ ST_Node result: ${nodeResult.rows[0]?.node_points} points`);
      } catch (error) {
        console.log(`   ❌ ST_Node failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        // If this combination fails, export it for inspection
        try {
          const uuids = combination.map(t => `'${t.app_uuid}'`).join(',');
          const exportResult = await pgClient.query(`
            SELECT json_build_object(
              'type', 'FeatureCollection',
              'features', json_agg(
                json_build_object(
                  'type', 'Feature',
                  'geometry', ST_AsGeoJSON(geometry)::json,
                  'properties', json_build_object(
                    'id', app_uuid,
                    'name', name,
                    'num_points', ST_NumPoints(geometry),
                    'length_meters', ST_Length(geometry::geography),
                    'is_valid', ST_IsValid(geometry),
                    'geom_type', ST_GeometryType(geometry)
                  )
                )
              )
            ) as geojson
            FROM ${stagingSchema}.trails
            WHERE app_uuid IN (${uuids})
          `);
          
          const filename = `geometrycollection-error-combination-${i + 1}.geojson`;
          require('fs').writeFileSync(filename, JSON.stringify(exportResult.rows[0].geojson, null, 2));
          console.log(`   📁 Exported problematic combination to ${filename}`);
        } catch (exportError) {
          console.log(`   ❌ Failed to export: ${exportError instanceof Error ? exportError.message : 'Unknown error'}`);
        }
      }
    }

    console.log('\n📋 Summary:');
    console.log('The liblwgeom error with n=0 and npoints=0 is likely caused by:');
    console.log('1. Very short trails (< 5 meters)');
    console.log('2. Trails with only 2 points');
    console.log('3. Self-loops where start and end points are identical');
    console.log('4. Invalid geometries');
    console.log('\nThe fix should filter out these problematic geometries before processing.');

  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the debug function
debugGeometryCollectionError().catch(console.error);
