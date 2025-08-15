#!/usr/bin/env ts-node

/**
 * Test Simplification Fix
 * 
 * This script tests if our simplification strategy fixes the liblwgeom error
 */

import { Pool } from 'pg';

async function testSimplificationFix() {
  console.log('🔍 Testing simplification fix...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'carthorse_1755212775548';

    console.log('📊 Step 1: Creating simplified trails table...');
    
    // Apply our simplification strategy
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.test_trails_simplified AS
      SELECT 
        id,
        app_uuid,
        osm_id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        source,
        source_tags,
        CASE 
          -- For very short trails (< 5m), try to simplify them
          WHEN ST_Length(geometry::geography) < 5.0 AND ST_NumPoints(geometry) = 2 THEN
            -- For 2-point trails shorter than 5m, try to extend them slightly
            ST_SimplifyPreserveTopology(geometry, 0.00001)
          -- For other trails, use normal simplification
          ELSE ST_SimplifyPreserveTopology(geometry, 0.00001)
        END as geometry
      FROM ${stagingSchema}.trails
      WHERE ST_IsValid(geometry) 
        AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_GeometryCollection')
        AND ST_NumPoints(geometry) >= 2  -- Require at least 2 points
        AND ST_Length(geometry::geography) >= 0.5  -- Minimum 0.5m length
        AND ST_StartPoint(geometry) != ST_EndPoint(geometry)  -- No self-loops
    `);

    const simplifiedCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.test_trails_simplified
    `);
    console.log(`   📊 Simplified trails: ${simplifiedCount.rows[0].count}`);

    console.log('\n📊 Step 2: Creating pgRouting table...');
    
    // Create pgRouting table
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.test_trails_for_pgrouting AS
      SELECT 
        id,
        CASE 
          WHEN ST_GeometryType(geometry) = 'ST_LineString' THEN ST_Force2D(geometry)
          WHEN ST_GeometryType(geometry) = 'ST_GeometryCollection' THEN ST_CollectionExtract(ST_Force2D(geometry), 2)
          ELSE ST_Force2D(geometry)
        END as geom
      FROM ${stagingSchema}.test_trails_simplified
      WHERE ST_IsValid(geometry) 
        AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_GeometryCollection')
        AND ST_NumPoints(geometry) >= 2  -- Require at least 2 points
        AND ST_Length(geometry::geography) >= 1.0  -- Filter by minimum length
        AND ST_StartPoint(geometry) != ST_EndPoint(geometry)  -- No self-loops
    `);

    const pgroutingCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.test_trails_for_pgrouting
    `);
    console.log(`   📊 pgRouting trails: ${pgroutingCount.rows[0].count}`);

    console.log('\n🧪 Step 3: Testing pgRouting functions...');
    
    // Test pgr_separateCrossing
    try {
      const crossingResult = await pgClient.query(`
        SELECT COUNT(*) as count FROM pgr_separateCrossing(
          'SELECT id, geom FROM ${stagingSchema}.test_trails_for_pgrouting', 
          0.000001
        )
      `);
      console.log(`   ✅ pgr_separateCrossing: ${crossingResult.rows[0]?.count} results`);
    } catch (error) {
      console.log(`   ❌ pgr_separateCrossing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test pgr_separateTouching
    try {
      const touchingResult = await pgClient.query(`
        SELECT COUNT(*) as count FROM pgr_separateTouching(
          'SELECT id, geom FROM ${stagingSchema}.test_trails_for_pgrouting', 
          0.000001
        )
      `);
      console.log(`   ✅ pgr_separateTouching: ${touchingResult.rows[0]?.count} results`);
    } catch (error) {
      console.log(`   ❌ pgr_separateTouching failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('\n🧪 Step 4: Testing ST_Node on simplified trails...');
    
    // Test ST_Node on the problematic combination
    try {
      const nodeResult = await pgClient.query(`
        SELECT 
          ST_AsText(ST_Node(ST_Collect(geometry))) as node_wkt,
          ST_NumPoints(ST_Node(ST_Collect(geometry))) as node_points,
          ST_GeometryType(ST_Node(ST_Collect(geometry))) as node_type
        FROM ${stagingSchema}.test_trails_simplified
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

    console.log('\n📊 Step 5: Analyzing what was filtered out...');
    
    // Check what was filtered out
    const filteredOut = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_IsValid(geometry) as is_valid,
        ST_StartPoint(geometry) = ST_EndPoint(geometry) as is_loop
      FROM ${stagingSchema}.trails
      WHERE app_uuid NOT IN (
        SELECT app_uuid FROM ${stagingSchema}.test_trails_simplified
      )
      ORDER BY ST_Length(geometry::geography) ASC
    `);

    console.log(`   📊 Filtered out ${filteredOut.rows.length} trails:`);
    filteredOut.rows.forEach(t => {
      console.log(`   - ${t.name} (${t.app_uuid}) - Points: ${t.num_points}, Length: ${t.length_meters?.toFixed(2)}m, Valid: ${t.is_valid}, Loop: ${t.is_loop}`);
    });

    console.log('\n✅ Summary:');
    console.log('The simplification strategy should fix the liblwgeom error by:');
    console.log('1. Filtering out very short trails (< 0.5m)');
    console.log('2. Simplifying problematic 2-point trails');
    console.log('3. Removing self-loops');
    console.log('4. Ensuring all geometries are valid');

  } catch (error) {
    console.error('❌ Error during testing:', error);
  } finally {
    // Clean up test tables
    try {
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.test_trails_simplified`);
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.test_trails_for_pgrouting`);
    } catch (cleanupError) {
      console.log('Warning: Could not clean up test tables');
    }
    await pgClient.end();
  }
}

// Run the test function
testSimplificationFix().catch(console.error);
