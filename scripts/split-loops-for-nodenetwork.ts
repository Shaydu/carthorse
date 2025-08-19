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

async function splitLoopsForNodeNetwork() {
  try {
    await client.connect();
    console.log('🔧 Testing loop splitting approaches for pgr_nodeNetwork...');

    // Get the Ute Trail (known loop)
    const uteTrail = await getUteTrail();
    console.log(`Testing with Ute Trail: ${uteTrail.name} (${uteTrail.num_points} points)`);

    // Test different splitting approaches
    console.log('\n📊 Approach 1: Split at self-intersection points');
    await testSelfIntersectionSplitting(uteTrail);

    console.log('\n📊 Approach 2: Split at regular intervals');
    await testIntervalSplitting(uteTrail);

    console.log('\n📊 Approach 3: Split at significant direction changes');
    await testDirectionChangeSplitting(uteTrail);

    console.log('\n📊 Approach 4: Simplify and split');
    await testSimplifyAndSplit(uteTrail);

    console.log('\n📊 Approach 5: Manual loop breaking');
    await testManualLoopBreaking(uteTrail);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function getUteTrail() {
  const query = `
    SELECT 
      app_uuid,
      name,
      geometry,
      ST_NumPoints(geometry) as num_points,
      ST_IsSimple(geometry) as is_simple,
      ST_IsValid(geometry) as is_valid
    FROM staging_boulder_1754318437837.trails 
    WHERE name LIKE '%Ute%' AND NOT ST_IsSimple(geometry)
    LIMIT 1
  `;
  
  const result = await client.query(query);
  return result.rows[0];
}

async function testSelfIntersectionSplitting(trail: any) {
  try {
    console.log('  Testing self-intersection splitting...');
    
    // Find self-intersection points
    const intersectionQuery = `
      SELECT 
        ST_AsText(ST_Intersection(geometry, geometry)) as intersection_points,
        ST_NumGeometries(ST_Intersection(geometry, geometry)) as num_intersections
      FROM staging_boulder_1754318437837.trails 
      WHERE app_uuid = '${trail.app_uuid}'
    `;
    
    const intersectionResult = await client.query(intersectionQuery);
    const intersection = intersectionResult.rows[0];
    
    console.log(`    Found ${intersection.num_intersections} self-intersection points`);
    console.log(`    Intersection: ${intersection.intersection_points}`);
    
    if (intersection.num_intersections > 0) {
      // Try to split at intersection points
      const splitQuery = `
        WITH loop_geom AS (
          SELECT ST_Force2D(geometry) as geom
          FROM staging_boulder_1754318437837.trails 
          WHERE app_uuid = '${trail.app_uuid}'
        ),
        split_result AS (
          SELECT (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment
          FROM loop_geom
        )
        SELECT 
          ST_GeometryType(segment) as geom_type,
          ST_NumPoints(segment) as num_points,
          ST_IsSimple(segment) as is_simple,
          ST_AsText(ST_StartPoint(segment)) as start_point,
          ST_AsText(ST_EndPoint(segment)) as end_point
        FROM split_result
        WHERE ST_GeometryType(segment) = 'ST_LineString'
          AND ST_NumPoints(segment) > 1
      `;
      
      const splitResult = await client.query(splitQuery);
      console.log(`    Created ${splitResult.rows.length} segments:`);
      
      splitResult.rows.forEach((segment, i) => {
        console.log(`      Segment ${i + 1}: ${segment.geom_type}, ${segment.num_points} points, simple: ${segment.is_simple}`);
      });
      
      // Test if segments work with pgr_nodeNetwork
      await testSegmentsWithNodeNetwork(splitResult.rows, 'self_intersection_split');
      
    } else {
      console.log('    No self-intersections found');
    }
    
  } catch (error) {
    console.log(`    ❌ Error: ${(error as Error).message}`);
  }
}

async function testIntervalSplitting(trail: any) {
  try {
    console.log('  Testing interval splitting...');
    
    // Split the loop at regular intervals (every N points)
    const intervalSize = Math.floor(trail.num_points / 4); // Split into ~4 segments
    
    const intervalQuery = `
      WITH loop_geom AS (
        SELECT ST_Force2D(geometry) as geom, ST_NumPoints(geometry) as num_points
        FROM staging_boulder_1754318437837.trails 
        WHERE app_uuid = '${trail.app_uuid}'
      ),
      split_points AS (
        SELECT 
          generate_series(1, num_points - 1, ${intervalSize}) as point_index
        FROM loop_geom
      ),
      segments AS (
        SELECT 
          ST_LineSubstring(geom, 
            (point_index::float / num_points), 
            LEAST((point_index + ${intervalSize})::float / num_points, 1.0)
          ) as segment,
          point_index
        FROM split_points, loop_geom
        WHERE point_index < num_points
      )
      SELECT 
        ST_GeometryType(segment) as geom_type,
        ST_NumPoints(segment) as num_points,
        ST_IsSimple(segment) as is_simple,
        ST_AsText(ST_StartPoint(segment)) as start_point,
        ST_AsText(ST_EndPoint(segment)) as end_point,
        point_index
      FROM segments
      WHERE ST_GeometryType(segment) = 'ST_LineString'
        AND ST_NumPoints(segment) > 1
      ORDER BY point_index
    `;
    
    const intervalResult = await client.query(intervalQuery);
    console.log(`    Created ${intervalResult.rows.length} segments by interval splitting`);
    
    intervalResult.rows.forEach((segment, i) => {
      console.log(`      Segment ${i + 1}: ${segment.geom_type}, ${segment.num_points} points, simple: ${segment.is_simple}`);
    });
    
    // Test if segments work with pgr_nodeNetwork
    await testSegmentsWithNodeNetwork(intervalResult.rows, 'interval_split');
    
  } catch (error) {
    console.log(`    ❌ Error: ${(error as Error).message}`);
  }
}

async function testDirectionChangeSplitting(trail: any) {
  try {
    console.log('  Testing direction change splitting...');
    
    // Split at points where direction changes significantly
    const directionQuery = `
      WITH loop_geom AS (
        SELECT ST_Force2D(geometry) as geom, ST_NumPoints(geometry) as num_points
        FROM staging_boulder_1754318437837.trails 
        WHERE app_uuid = '${trail.app_uuid}'
      ),
      direction_changes AS (
        SELECT 
          point_index,
          ST_Azimuth(
            ST_PointN(geom, GREATEST(point_index - 1, 1)),
            ST_PointN(geom, point_index)
          ) - ST_Azimuth(
            ST_PointN(geom, point_index),
            ST_PointN(geom, LEAST(point_index + 1, num_points))
          ) as direction_change
        FROM loop_geom,
             generate_series(2, num_points - 1) as point_index
        WHERE point_index BETWEEN 2 AND num_points - 1
      ),
      significant_changes AS (
        SELECT point_index
        FROM direction_changes
        WHERE ABS(direction_change) > 0.5  -- ~30 degrees
        ORDER BY point_index
      )
      SELECT point_index
      FROM significant_changes
      LIMIT 5  -- Limit to 5 split points
    `;
    
    const directionResult = await client.query(directionQuery);
    console.log(`    Found ${directionResult.rows.length} significant direction changes`);
    
    if (directionResult.rows.length > 0) {
      const splitPoints = directionResult.rows.map(r => r.point_index);
      console.log(`    Split points: ${splitPoints.join(', ')}`);
      
      // Create segments based on direction changes
      await createSegmentsFromSplitPoints(trail, splitPoints, 'direction_change_split');
    } else {
      console.log('    No significant direction changes found');
    }
    
  } catch (error) {
    console.log(`    ❌ Error: ${(error as Error).message}`);
  }
}

async function testSimplifyAndSplit(trail: any) {
  try {
    console.log('  Testing simplify and split...');
    
    // Simplify the geometry first, then split
    const simplifyQuery = `
      WITH simplified_geom AS (
        SELECT 
          ST_Force2D(geometry) as geom,
          ST_NumPoints(ST_Force2D(geometry)) as num_points
        FROM staging_boulder_1754318437837.trails 
        WHERE app_uuid = '${trail.app_uuid}'
      ),
      split_segments AS (
        SELECT 
          (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment,
          generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
        FROM simplified_geom
      )
      SELECT 
        ST_GeometryType(segment) as geom_type,
        ST_NumPoints(segment) as num_points,
        ST_IsSimple(segment) as is_simple,
        ST_AsText(ST_StartPoint(segment)) as start_point,
        ST_AsText(ST_EndPoint(segment)) as end_point,
        segment_index
      FROM split_segments
      WHERE ST_GeometryType(segment) = 'ST_LineString'
        AND ST_NumPoints(segment) > 1
      ORDER BY segment_index
    `;
    
    const simplifyResult = await client.query(simplifyQuery);
    console.log(`    Created ${simplifyResult.rows.length} segments after simplification`);
    
    simplifyResult.rows.forEach((segment, i) => {
      console.log(`      Segment ${i + 1}: ${segment.geom_type}, ${segment.num_points} points, simple: ${segment.is_simple}`);
    });
    
    // Test if segments work with pgr_nodeNetwork
    await testSegmentsWithNodeNetwork(simplifyResult.rows, 'simplify_split');
    
  } catch (error) {
    console.log(`    ❌ Error: ${(error as Error).message}`);
  }
}

async function testManualLoopBreaking(trail: any) {
  try {
    console.log('  Testing manual loop breaking...');
    
    // Break the loop by removing the last segment that connects back to start
    const manualQuery = `
      WITH loop_geom AS (
        SELECT ST_Force2D(geometry) as geom, ST_NumPoints(geometry) as num_points
        FROM staging_boulder_1754318437837.trails 
        WHERE app_uuid = '${trail.app_uuid}'
      ),
      broken_loop AS (
        SELECT 
          ST_LineSubstring(geom, 0.0, 0.95) as segment  -- Remove last 5%
        FROM loop_geom
      )
      SELECT 
        ST_GeometryType(segment) as geom_type,
        ST_NumPoints(segment) as num_points,
        ST_IsSimple(segment) as is_simple,
        ST_AsText(ST_StartPoint(segment)) as start_point,
        ST_AsText(ST_EndPoint(segment)) as end_point
      FROM broken_loop
      WHERE ST_GeometryType(segment) = 'ST_LineString'
        AND ST_NumPoints(segment) > 1
    `;
    
    const manualResult = await client.query(manualQuery);
    console.log(`    Created ${manualResult.rows.length} segments by manual breaking`);
    
    manualResult.rows.forEach((segment, i) => {
      console.log(`      Segment ${i + 1}: ${segment.geom_type}, ${segment.num_points} points, simple: ${segment.is_simple}`);
    });
    
    // Test if segments work with pgr_nodeNetwork
    await testSegmentsWithNodeNetwork(manualResult.rows, 'manual_break');
    
  } catch (error) {
    console.log(`    ❌ Error: ${(error as Error).message}`);
  }
}

async function createSegmentsFromSplitPoints(trail: any, splitPoints: number[], methodName: string) {
  try {
    console.log(`    Creating segments from split points: ${splitPoints.join(', ')}`);
    
    // This would create segments based on the split points
    // Implementation would depend on the specific splitting logic
    
  } catch (error) {
    console.log(`    ❌ Error creating segments: ${(error as Error).message}`);
  }
}

async function testSegmentsWithNodeNetwork(segments: any[], methodName: string) {
  try {
    console.log(`    Testing ${segments.length} segments with pgr_nodeNetwork...`);
    
    // Create a test table with the segments
    const tableName = `test_${methodName}_segments`;
    await client.query(`DROP TABLE IF EXISTS staging_boulder_1754318437837.${tableName}`);
    
    // For now, just test if segments are simple
    const simpleSegments = segments.filter(s => s.is_simple);
    const nonSimpleSegments = segments.filter(s => !s.is_simple);
    
    console.log(`      Simple segments: ${simpleSegments.length}`);
    console.log(`      Non-simple segments: ${nonSimpleSegments.length}`);
    
    if (simpleSegments.length > 0) {
      console.log(`      ✅ ${simpleSegments.length} segments are ready for pgr_nodeNetwork`);
    } else {
      console.log(`      ❌ No segments are simple enough for pgr_nodeNetwork`);
    }
    
  } catch (error) {
    console.log(`    ❌ Error testing with pgr_nodeNetwork: ${(error as Error).message}`);
  }
}

splitLoopsForNodeNetwork(); 