#!/usr/bin/env ts-node

/**
 * Test Problematic Combination
 * 
 * This script tests the exact combination that causes the liblwgeom error
 */

import { Pool } from 'pg';

async function testProblematicCombination() {
  console.log('🔍 Testing problematic combination...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'carthorse_1755212775548';

    // Get the specific problematic trails
    const problematicTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(geometry) as geom_wkt,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point
      FROM ${stagingSchema}.trails
      WHERE app_uuid IN (
        'bce73495-2429-4cb1-ac1a-d99321afd5d2',
        'c204b85f-1169-49ad-94c2-a11b8bb0b633'
      )
      ORDER BY app_uuid
    `);

    console.log('📊 Problematic trails:');
    problematicTrails.rows.forEach(t => {
      console.log(`   - ${t.name} (${t.app_uuid})`);
      console.log(`     Points: ${t.num_points}, Length: ${t.length_meters?.toFixed(2)}m`);
      console.log(`     Start: ${t.start_point}, End: ${t.end_point}`);
      console.log(`     WKT: ${t.geom_wkt}`);
    });

    // Test ST_Node on the combination
    console.log('\n🧪 Testing ST_Node on combination...');
    
    try {
      const nodeResult = await pgClient.query(`
        SELECT 
          ST_AsText(ST_Node(ST_Collect(geometry))) as node_wkt,
          ST_NumPoints(ST_Node(ST_Collect(geometry))) as node_points,
          ST_GeometryType(ST_Node(ST_Collect(geometry))) as node_type
        FROM ${stagingSchema}.trails
        WHERE app_uuid IN (
          'bce73495-2429-4cb1-ac1a-d99321afd5d2',
          'c204b85f-1169-49ad-94c2-a11b8bb0b633'
        )
      `);
      
      console.log('✅ ST_Node result:');
      console.log(`   Type: ${nodeResult.rows[0]?.node_type}`);
      console.log(`   Points: ${nodeResult.rows[0]?.node_points}`);
      console.log(`   WKT: ${nodeResult.rows[0]?.node_wkt}`);
    } catch (error) {
      console.log(`❌ ST_Node failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test pgRouting functions on the combination
    console.log('\n🧪 Testing pgRouting on combination...');
    
    try {
      // Create test table with the problematic combination
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.test_problematic_combo`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.test_problematic_combo AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
          ST_Force2D(geometry) as geom
        FROM ${stagingSchema}.trails
        WHERE app_uuid IN (
          'bce73495-2429-4cb1-ac1a-d99321afd5d2',
          'c204b85f-1169-49ad-94c2-a11b8bb0b633'
        )
      `);

      // Test pgr_separateCrossing
      try {
        const crossingResult = await pgClient.query(`
          SELECT COUNT(*) as count FROM pgr_separateCrossing(
            'SELECT id, geom FROM ${stagingSchema}.test_problematic_combo', 
            0.000001
          )
        `);
        console.log(`✅ pgr_separateCrossing: ${crossingResult.rows[0]?.count} results`);
      } catch (error) {
        console.log(`❌ pgr_separateCrossing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Test pgr_separateTouching
      try {
        const touchingResult = await pgClient.query(`
          SELECT COUNT(*) as count FROM pgr_separateTouching(
            'SELECT id, geom FROM ${stagingSchema}.test_problematic_combo', 
            0.000001
          )
        `);
        console.log(`✅ pgr_separateTouching: ${touchingResult.rows[0]?.count} results`);
      } catch (error) {
        console.log(`❌ pgr_separateTouching failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

    } catch (error) {
      console.log(`❌ Test setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test with different tolerances
    console.log('\n🧪 Testing with different tolerances...');
    
    const tolerances = [0.000001, 0.00001, 0.0001, 0.001];
    
    for (const tolerance of tolerances) {
      try {
        const nodeResult = await pgClient.query(`
          SELECT ST_NumPoints(ST_Node(ST_Collect(geometry))) as node_points
          FROM ${stagingSchema}.trails
          WHERE app_uuid IN (
            'bce73495-2429-4cb1-ac1a-d99321afd5d2',
            'c204b85f-1169-49ad-94c2-a11b8bb0b633'
          )
        `);
        
        console.log(`   Tolerance ${tolerance}: ${nodeResult.rows[0]?.node_points} points`);
      } catch (error) {
        console.log(`   Tolerance ${tolerance}: FAILED - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Export the problematic combination for inspection
    console.log('\n📁 Exporting problematic combination...');
    
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
              'start_point', ST_AsText(ST_StartPoint(geometry)),
              'end_point', ST_AsText(ST_EndPoint(geometry))
            )
          )
        )
      ) as geojson
      FROM ${stagingSchema}.trails
      WHERE app_uuid IN (
        'bce73495-2429-4cb1-ac1a-d99321afd5d2',
        'c204b85f-1169-49ad-94c2-a11b8bb0b633'
      )
    `);
    
    const filename = 'problematic-combination.geojson';
    require('fs').writeFileSync(filename, JSON.stringify(exportResult.rows[0].geojson, null, 2));
    console.log(`   📁 Exported to ${filename}`);

  } catch (error) {
    console.error('❌ Error during testing:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test function
testProblematicCombination().catch(console.error);
