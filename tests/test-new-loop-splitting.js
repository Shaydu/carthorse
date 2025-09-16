#!/usr/bin/env node

const { Client } = require('pg');

async function testNewLoopSplitting() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🧪 Testing new LoopSplittingService with multi-strategy approach...');

    // Clear staging schema and copy some test data
    console.log('\n📊 Setting up test data...');
    await client.query('DELETE FROM staging.trails');
    
    // Copy some non-simple trails to staging for testing
    await client.query(`
      INSERT INTO staging.trails 
      SELECT * FROM public.trails 
      WHERE NOT ST_IsSimple(geometry) 
        AND ST_IsValid(geometry) 
        AND ST_Length(geometry::geography) > 0
      LIMIT 3
    `);

    const beforeCount = await client.query(`
      SELECT COUNT(*) as count FROM staging.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
    `);
    console.log(`   Test trails loaded: ${beforeCount.rows[0].count}`);

    // Show details of test trails
    const testTrails = await client.query(`
      SELECT id, app_uuid, name, 
             ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points,
             ST_IsSimple(geometry) as is_simple,
             ST_GeometryType(ST_Intersection(geometry, geometry)) as intersection_type,
             ST_NumGeometries(ST_Intersection(geometry, geometry)) as intersection_count
      FROM staging.trails 
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
      ORDER BY name
    `);

    console.log('\n📋 Test trails:');
    testTrails.rows.forEach((trail, index) => {
      console.log(`   ${index + 1}. ${trail.name}`);
      console.log(`      Length: ${trail.length_meters?.toFixed(2)}m, Points: ${trail.num_points}`);
      console.log(`      Is Simple: ${trail.is_simple}, Intersection Type: ${trail.intersection_type}, Count: ${trail.intersection_count}`);
    });

    // Test each strategy individually
    console.log('\n🔧 Testing individual strategies...');
    
    for (const trail of testTrails.rows) {
      console.log(`\n   Testing trail: ${trail.name}`);
      
      // Test Strategy 1: ST_Split
      try {
        const splitQuery = `
          WITH loop_geometry AS (
            SELECT '${trail.app_uuid}' as trail_uuid, '${trail.name}' as name, ST_Force2D(geometry) as geom
            FROM staging.trails 
            WHERE app_uuid = '${trail.app_uuid}'
          ),
          split_segments AS (
            SELECT 
              (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment_geom,
              generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
            FROM loop_geometry
          )
          SELECT 
            segment_geom,
            segment_index
          FROM split_segments
          WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
            AND ST_NumPoints(segment_geom) > 1
        `;
        
        const splitResult = await client.query(splitQuery);
        console.log(`     Strategy 1 (ST_Split): ${splitResult.rows.length} segments`);
      } catch (error) {
        console.log(`     Strategy 1 (ST_Split): ❌ Failed - ${error.message}`);
      }

      // Test Strategy 2: ST_SimplifyPreserveTopology
      try {
        const simplifyQuery = `
          SELECT 
            ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001)) as segment_geom,
            1 as segment_index
          FROM staging.trails 
          WHERE app_uuid = $1
            AND ST_GeometryType(ST_SimplifyPreserveTopology(geometry, 0.00001)) = 'ST_LineString'
            AND ST_NumPoints(ST_SimplifyPreserveTopology(geometry, 0.00001)) > 1
        `;
        
        const simplifyResult = await client.query(simplifyQuery, [trail.app_uuid]);
        console.log(`     Strategy 2 (Simplify): ${simplifyResult.rows.length} segments`);
      } catch (error) {
        console.log(`     Strategy 2 (Simplify): ❌ Failed - ${error.message}`);
      }

      // Test Strategy 3: ST_Node
      try {
        const nodeQuery = `
          WITH noded_geometry AS (
            SELECT 
              (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as segment_geom,
              generate_series(1, ST_NumGeometries(ST_Node(ST_Force2D(geometry)))) as segment_index
            FROM staging.trails 
            WHERE app_uuid = $1
          )
          SELECT 
            segment_geom,
            segment_index
          FROM noded_geometry
          WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
            AND ST_NumPoints(segment_geom) > 1
        `;
        
        const nodeResult = await client.query(nodeQuery, [trail.app_uuid]);
        console.log(`     Strategy 3 (ST_Node): ${nodeResult.rows.length} segments`);
      } catch (error) {
        console.log(`     Strategy 3 (ST_Node): ❌ Failed - ${error.message}`);
      }
    }

    // Test the complete service (would require importing the TypeScript service)
    console.log('\n✅ Individual strategy testing completed.');
    console.log('   To test the complete service, you would need to:');
    console.log('   1. Import the LoopSplittingService from TypeScript');
    console.log('   2. Create an instance with config: { stagingSchema: "staging", verbose: true }');
    console.log('   3. Call handleSelfIntersectingLoops()');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testNewLoopSplitting();
