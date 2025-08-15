#!/usr/bin/env ts-node

/**
 * Test Merge and Homogenize Approach
 * 
 * This script tests if merging short connector trails and using pgr_homogenizeGeometry
 * resolves the liblwgeom error with the problematic trails we identified.
 */

import { Pool } from 'pg';

async function testMergeAndHomogenize() {
  console.log('🔍 Testing merge and homogenize approach...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'carthorse_1755212775548';

    console.log('📊 Step 1: Creating test table with problematic trails...');
    
    // Create a test table with the specific problematic trails
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.test_problematic_trails AS
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
        ST_Force2D(geometry) as geom
      FROM ${stagingSchema}.trails
      WHERE app_uuid IN (
        'bce73495-2429-4cb1-ac1a-d99321afd5d2',
        'c204b85f-1169-49ad-94c2-a11b8bb0b633',
        '5ae0cd6c-17a5-4cd3-bdcc-ec254e90d833'
      )
    `);

    const problematicCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.test_problematic_trails
    `);
    console.log(`   📊 Problematic trails: ${problematicCount.rows[0].count}`);

    console.log('\n📊 Step 2: Testing merge of short connector trails...');
    
    // Test the merging logic
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.test_merged_trails AS
      WITH short_trails AS (
        -- Identify short trails (< 5m) that are likely connectors
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
          geom,
          ST_Length(geom::geography) as length_meters,
          ST_StartPoint(geom) as start_point,
          ST_EndPoint(geom) as end_point
        FROM ${stagingSchema}.test_problematic_trails
        WHERE ST_Length(geom::geography) < 5.0
          AND ST_NumPoints(geom) = 2
      ),
      merged_connectors AS (
        -- Merge short trails that share endpoints or are very close
        SELECT DISTINCT
          MIN(st1.id) as id,  -- Keep as integer to match UNION
          'merged_connector' as app_uuid,
          'merged' as osm_id,
          'Merged Connector Trail' as name,
          st1.region,
          'connector' as trail_type,
          st1.surface,
          st1.difficulty,
          AVG(st1.length_km) as length_km,
          SUM(st1.elevation_gain) as elevation_gain,
          SUM(st1.elevation_loss) as elevation_loss,
          MAX(st1.max_elevation) as max_elevation,
          MIN(st1.min_elevation) as min_elevation,
          AVG(st1.avg_elevation) as avg_elevation,
          MIN(st1.bbox_min_lng) as bbox_min_lng,
          MAX(st1.bbox_max_lng) as bbox_max_lng,
          MIN(st1.bbox_min_lat) as bbox_min_lat,
          MAX(st1.bbox_max_lat) as bbox_max_lat,
          'merged' as source,
          st1.source_tags,
          ST_LineMerge(ST_Collect(st1.geom)) as geom
        FROM short_trails st1
        JOIN short_trails st2 ON (
          st1.id != st2.id AND (
            ST_DWithin(st1.start_point, st2.start_point, 0.001) OR
            ST_DWithin(st1.start_point, st2.end_point, 0.001) OR
            ST_DWithin(st1.end_point, st2.start_point, 0.001) OR
            ST_DWithin(st1.end_point, st2.end_point, 0.001)
          )
        )
        GROUP BY st1.region, st1.surface, st1.difficulty, st1.source_tags
      ),
      remaining_trails AS (
        -- Keep trails that weren't merged (longer trails and isolated short trails)
        SELECT 
          t.id,
          t.app_uuid,
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.bbox_min_lng,
          t.bbox_max_lng,
          t.bbox_min_lat,
          t.bbox_max_lat,
          t.source,
          t.source_tags,
          t.geom
        FROM ${stagingSchema}.test_problematic_trails t
        WHERE NOT EXISTS (
          SELECT 1 FROM short_trails st
          WHERE st.id = t.id
        )
      )
      SELECT * FROM merged_connectors
      UNION ALL
      SELECT * FROM remaining_trails
    `);

    const mergedCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.test_merged_trails
    `);
    console.log(`   📊 After merging: ${mergedCount.rows[0].count} trails`);

    console.log('\n📊 Step 3: Testing geometry homogenization...');
    
    // Test geometry homogenization on the merged trails
    try {
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.test_homogenized_trails AS
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
          -- Convert to simple LINESTRING using ST_CollectionHomogenize
          ST_CollectionHomogenize(geom) as geom
        FROM ${stagingSchema}.test_merged_trails
      `);

      const homogenizedCount = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.test_homogenized_trails
      `);
      console.log(`   ✅ Geometry homogenization: ${homogenizedCount.rows[0].count} trails processed`);

      // Check geometry types after homogenization
      const geomTypes = await pgClient.query(`
        SELECT 
          ST_GeometryType(geom) as geom_type,
          COUNT(*) as count
        FROM ${stagingSchema}.test_homogenized_trails
        GROUP BY ST_GeometryType(geom)
      `);
      console.log('   📊 Geometry types after homogenization:');
      geomTypes.rows.forEach(row => {
        console.log(`      - ${row.geom_type}: ${row.count} trails`);
      });

    } catch (error) {
      console.log(`   ❌ Geometry homogenization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('\n📊 Step 4: Testing pgRouting functions on homogenized trails...');
    
    // Test pgRouting functions on the homogenized trails
    try {
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.test_pgrouting_trails AS
        SELECT 
          id,
          geom
        FROM ${stagingSchema}.test_homogenized_trails
        WHERE ST_IsValid(geom) 
          AND ST_GeometryType(geom) = 'ST_LineString'
          AND ST_NumPoints(geom) >= 2
      `);

      // Test pgr_separateCrossing
      try {
        const crossingResult = await pgClient.query(`
          SELECT COUNT(*) as count FROM pgr_separateCrossing(
            'SELECT id, geom FROM ${stagingSchema}.test_pgrouting_trails', 
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
            'SELECT id, geom FROM ${stagingSchema}.test_pgrouting_trails', 
            0.000001
          )
        `);
        console.log(`   ✅ pgr_separateTouching: ${touchingResult.rows[0]?.count} results`);
      } catch (error) {
        console.log(`   ❌ pgr_separateTouching failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

    } catch (error) {
      console.log(`   ❌ pgRouting setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('\n📊 Step 5: Testing ST_Node on homogenized trails...');
    
    // Test ST_Node on the homogenized trails
    try {
      const nodeResult = await pgClient.query(`
        SELECT 
          ST_AsText(ST_Node(ST_Collect(geom))) as node_wkt,
          ST_NumPoints(ST_Node(ST_Collect(geom))) as node_points,
          ST_GeometryType(ST_Node(ST_Collect(geom))) as node_type
        FROM ${stagingSchema}.test_homogenized_trails
      `);
      
      console.log('✅ ST_Node result:');
      console.log(`   Type: ${nodeResult.rows[0]?.node_type}`);
      console.log(`   Points: ${nodeResult.rows[0]?.node_points}`);
      console.log(`   WKT: ${nodeResult.rows[0]?.node_wkt}`);
    } catch (error) {
      console.log(`❌ ST_Node failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('\n📊 Step 6: Analyzing what was merged...');
    
    // Show what trails were merged
    const mergedTrails = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_NumPoints(geom) as num_points,
        ST_Length(geom::geography) as length_meters,
        ST_GeometryType(geom) as geom_type
      FROM ${stagingSchema}.test_merged_trails
      WHERE source = 'merged'
    `);

    console.log(`   📊 Merged trails: ${mergedTrails.rows.length}`);
    mergedTrails.rows.forEach(t => {
      console.log(`   - ${t.name} (${t.id}) - Points: ${t.num_points}, Length: ${t.length_meters?.toFixed(2)}m, Type: ${t.geom_type}`);
    });

    console.log('\n✅ Summary:');
    console.log('The merge-and-homogenize approach should:');
    console.log('1. Merge short connector trails that are close to each other');
    console.log('2. Use pgr_homogenizeGeometry to convert to simple LINESTRINGs');
    console.log('3. Eliminate the liblwgeom error with n=0 and npoints=0');
    console.log('4. Preserve network connectivity through merged connector trails');

  } catch (error) {
    console.error('❌ Error during testing:', error);
  } finally {
    // Clean up test tables
    try {
      await pgClient.query(`DROP TABLE IF EXISTS carthorse_1755212775548.test_problematic_trails`);
      await pgClient.query(`DROP TABLE IF EXISTS carthorse_1755212775548.test_merged_trails`);
      await pgClient.query(`DROP TABLE IF EXISTS carthorse_1755212775548.test_homogenized_trails`);
      await pgClient.query(`DROP TABLE IF EXISTS carthorse_1755212775548.test_pgrouting_trails`);
    } catch (cleanupError) {
      console.log('Warning: Could not clean up test tables');
    }
    await pgClient.end();
  }
}

// Run the test function
testMergeAndHomogenize().catch(console.error);
