#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

async function analyzeGeometryIssues() {
  try {
    await client.connect();
    console.log('🔍 Analyzing specific geometry issues with pgr_nodeNetwork...');

    // Find all non-simple geometries
    console.log('\n📊 Non-simple geometries (loops/self-intersections):');
    const nonSimpleQuery = `
      SELECT 
        app_uuid,
        name,
        ST_GeometryType(geometry) as geom_type,
        ST_NumPoints(geometry) as num_points,
        ST_IsValid(geometry) as is_valid,
        ST_IsSimple(geometry) as is_simple,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        CASE 
          WHEN ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry)) THEN 'LOOP'
          WHEN NOT ST_IsSimple(geometry) THEN 'SELF_INTERSECTING'
          ELSE 'OTHER'
        END as issue_type
      FROM staging_boulder_1754318437837.trails 
      WHERE geometry IS NOT NULL 
        AND NOT ST_IsSimple(geometry)
      ORDER BY name
    `;
    
    const nonSimpleResult = await client.query(nonSimpleQuery);
    console.log(`Found ${nonSimpleResult.rows.length} non-simple geometries:`);
    
    nonSimpleResult.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.issue_type} (${row.geom_type}, ${row.num_points} points)`);
    });

    // Test what happens when we try to split a loop
    console.log('\n🧪 Testing loop splitting behavior...');
    await testLoopSplitting();

    // Test preprocessing options
    console.log('\n🔧 Testing preprocessing solutions...');
    await testPreprocessingSolutions();

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function testLoopSplitting() {
  try {
    // Get the Ute Trail (known loop)
    const uteTrailQuery = `
      SELECT app_uuid, name, geometry
      FROM staging_boulder_1754318437837.trails 
      WHERE name LIKE '%Ute%' AND NOT ST_IsSimple(geometry)
      LIMIT 1
    `;
    
    const uteTrail = await client.query(uteTrailQuery);
    
    if (uteTrail.rows.length > 0) {
      const trail = uteTrail.rows[0];
      console.log(`  Testing with ${trail.name}...`);
      
      // Create a test table with just this trail
      await client.query('DROP TABLE IF EXISTS test_loop_trail');
      await client.query(`
        CREATE TABLE test_loop_trail AS
        SELECT 
          1 as id,
          '${trail.app_uuid}' as trail_uuid,
          '${trail.name}' as name,
          ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001)) as the_geom
        FROM staging_boulder_1754318437837.trails 
        WHERE app_uuid = '${trail.app_uuid}'
      `);
      
      // Try to run pgr_nodeNetwork on just this trail
      try {
        await client.query(`SELECT pgr_nodeNetwork('test_loop_trail', 0.000001, 'id', 'the_geom')`);
        console.log('    ✅ pgr_nodeNetwork succeeded on single loop trail');
      } catch (error) {
        console.log(`    ❌ pgr_nodeNetwork failed: ${(error as Error).message}`);
      }
      
      // Test what happens when we try to split the loop manually
      await testManualLoopSplitting(trail);
    }
    
  } catch (error) {
    console.log(`  ❌ Error testing loop splitting: ${(error as Error).message}`);
  }
}

async function testManualLoopSplitting(trail: any) {
  console.log('    Testing manual loop splitting...');
  
  try {
    // Try to split the loop at its self-intersection points
    const splitQuery = `
      SELECT 
        ST_AsText(ST_PointN(geometry, 1)) as first_point,
        ST_AsText(ST_PointN(geometry, ST_NumPoints(geometry))) as last_point,
        ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry)) as is_loop,
        ST_NumPoints(geometry) as num_points
      FROM staging_boulder_1754318437837.trails 
      WHERE app_uuid = '${trail.app_uuid}'
    `;
    
    const splitResult = await client.query(splitQuery);
    const info = splitResult.rows[0];
    
    console.log(`      First point: ${info.first_point}`);
    console.log(`      Last point: ${info.last_point}`);
    console.log(`      Is loop: ${info.is_loop}`);
    console.log(`      Points: ${info.num_points}`);
    
    // Try to find intersection points
    const intersectionQuery = `
      SELECT 
        ST_AsText(ST_Intersection(geometry, geometry)) as self_intersection
      FROM staging_boulder_1754318437837.trails 
      WHERE app_uuid = '${trail.app_uuid}'
    `;
    
    const intersectionResult = await client.query(intersectionQuery);
    console.log(`      Self-intersection: ${intersectionResult.rows[0].self_intersection}`);
    
  } catch (error) {
    console.log(`      ❌ Error in manual splitting: ${(error as Error).message}`);
  }
}

async function testPreprocessingSolutions() {
  console.log('  Testing preprocessing solutions...');
  
  try {
    // Solution 1: Remove loops entirely
    console.log('    Solution 1: Remove loops entirely');
    const noLoopsQuery = `
      SELECT COUNT(*) as count
      FROM staging_boulder_1754318437837.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_IsSimple(geometry)
    `;
    
    const noLoopsResult = await client.query(noLoopsQuery);
    console.log(`      Trails without loops: ${noLoopsResult.rows[0].count}`);
    
    // Solution 2: Split loops at intersection points
    console.log('    Solution 2: Split loops at intersection points');
    await testLoopSplittingAtIntersections();
    
    // Solution 3: Use pgr_createTopology instead
    console.log('    Solution 3: Use pgr_createTopology (doesn\'t split trails)');
    await testCreateTopologyAlternative();
    
  } catch (error) {
    console.log(`    ❌ Error testing preprocessing: ${(error as Error).message}`);
  }
}

async function testLoopSplittingAtIntersections() {
  try {
    // Create a test with a simple loop
    await client.query('DROP TABLE IF EXISTS test_loop_split');
    await client.query(`
      CREATE TABLE test_loop_split AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
        app_uuid as trail_uuid,
        name,
        geometry as the_geom
      FROM staging_boulder_1754318437837.trails 
      WHERE NOT ST_IsSimple(geometry)
      LIMIT 5
    `);
    
    // Try to split loops by finding intersection points and creating new segments
    const splitQuery = `
      SELECT 
        id,
        name,
        ST_AsText(ST_Intersection(the_geom, the_geom)) as intersection_points
      FROM test_loop_split
    `;
    
    const splitResult = await client.query(splitQuery);
    console.log(`      Found ${splitResult.rows.length} trails with self-intersections`);
    
    splitResult.rows.forEach(row => {
      console.log(`        ${row.name}: ${row.intersection_points}`);
    });
    
  } catch (error) {
    console.log(`      ❌ Error splitting loops: ${(error as Error).message}`);
  }
}

async function testCreateTopologyAlternative() {
  try {
    // Test pgr_createTopology on the same problematic data
    await client.query('DROP TABLE IF EXISTS test_create_topology');
    await client.query(`
      CREATE TABLE test_create_topology AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
        app_uuid as trail_uuid,
        name,
        ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001)) as the_geom
      FROM staging_boulder_1754318437837.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND NOT ST_IsSimple(geometry)
      LIMIT 10
    `);
    
    // Try pgr_createTopology
    await client.query(`SELECT pgr_createTopology('test_create_topology', 0.000001, 'the_geom', 'id')`);
    console.log('      ✅ pgr_createTopology succeeded with loops');
    
    // Check results
    const nodeResult = await client.query('SELECT COUNT(*) as count FROM test_create_topology_vertices_pgr');
    const edgeResult = await client.query('SELECT COUNT(*) as count FROM test_create_topology');
    
    console.log(`      Created ${nodeResult.rows[0].count} nodes and ${edgeResult.rows[0].count} edges`);
    
  } catch (error) {
    console.log(`      ❌ pgr_createTopology failed: ${(error as Error).message}`);
  }
}

analyzeGeometryIssues(); 