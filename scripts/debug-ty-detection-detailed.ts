#!/usr/bin/env ts-node

import { Client } from 'pg';
import { loadConfig } from '../src/utils/config-loader';

async function debugTYDetectionDetailed() {
  const config = loadConfig();
  const toleranceMeters = config.layer1_trails?.intersectionDetection?.tIntersectionToleranceMeters ?? 3.0;
  
  console.log(`🔍 Detailed T-intersection debugging with tolerance: ${toleranceMeters}m`);
  
  // Connect to the database
  const client = new Client({
    host: config.database.connection.host,
    port: config.database.connection.port,
    database: config.database.connection.database,
    user: config.database.connection.user,
    password: config.database.connection.password,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Find the staging schema
    const stagingSchemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (stagingSchemasResult.rowCount === 0) {
      console.log('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = stagingSchemasResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Check if the specific trails exist
    const trailsResult = await client.query(`
      SELECT 
        id, app_uuid, name, 
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ORDER BY name
    `);
    
    console.log(`\n📋 Found ${trailsResult.rowCount} trails:`);
    trailsResult.rows.forEach(trail => {
      console.log(`  - ${trail.name} (ID: ${trail.id})`);
      console.log(`    Start: ${trail.start_point}`);
      console.log(`    End: ${trail.end_point}`);
      console.log(`    Length: ${trail.length_meters.toFixed(1)}m`);
    });
    
    if (!trailsResult.rowCount || trailsResult.rowCount < 2) {
      console.log('❌ Need both trails to test T-intersection detection');
      return;
    }
    
    // Test the T-intersection detection logic
    console.log(`\n🔍 Testing T-intersection detection logic...`);
    
    const tIntersectionResult = await client.query(`
      WITH all_trails AS (
        SELECT 
          app_uuid, id, name, geometry
        FROM ${stagingSchema}.trails
        WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ),
      t_intersections AS (
        -- T-intersections: where any point on one trail is close to any point on another trail
        SELECT 
          ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry))) as intersection_point,
          ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry))) as intersection_point_3d,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
        FROM all_trails t1
        JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t1.geometry::geography, t2.geometry::geography, $1)
          AND ST_Distance(t1.geometry::geography, t2.geometry::geography) > 0
          AND ST_Distance(t1.geometry::geography, t2.geometry::geography) <= $1
      )
      SELECT 
        intersection_point,
        intersection_point_3d,
        connected_trail_ids,
        connected_trail_names,
        distance_meters
      FROM t_intersections
      WHERE array_length(connected_trail_ids, 1) > 1
      ORDER BY distance_meters ASC
    `, [toleranceMeters]);
    
    console.log(`\n📍 T-intersection detection results:`);
    if (tIntersectionResult.rowCount && tIntersectionResult.rowCount > 0) {
      tIntersectionResult.rows.forEach((intersection, index) => {
        console.log(`  ${index + 1}. ${intersection.connected_trail_names.join(' ↔ ')}`);
        console.log(`     Distance: ${intersection.distance_meters.toFixed(3)}m`);
        console.log(`     Point: ${intersection.intersection_point}`);
        console.log(`     Trail IDs: ${intersection.connected_trail_ids.join(', ')}`);
      });
    } else {
      console.log('  ❌ No T-intersections detected');
    }
    
    // Test the splitting logic for the first intersection
    if (tIntersectionResult.rowCount && tIntersectionResult.rowCount > 0) {
      const intersection = tIntersectionResult.rows[0];
      console.log(`\n🔧 Testing splitting logic for: ${intersection.connected_trail_names.join(' ↔ ')}`);
      
      // Find which trail should be split
      const trailToSplitResult = await client.query(`
        SELECT 
          id, app_uuid, name, geometry,
          ST_Distance(geometry::geography, $1::geography) as distance_to_point
        FROM ${stagingSchema}.trails 
        WHERE app_uuid = ANY($2)
        ORDER BY ST_Distance(geometry::geography, $1::geography)
        LIMIT 1
      `, [intersection.intersection_point, intersection.connected_trail_ids]);
      
      if (trailToSplitResult.rowCount && trailToSplitResult.rowCount > 0) {
        const trailToSplit = trailToSplitResult.rows[0];
        console.log(`  🎯 Trail to split: ${trailToSplit.name} (distance: ${trailToSplit.distance_to_point.toFixed(3)}m)`);
        
        // Test the splitting logic
        const splitTestResult = await client.query(`
          WITH split_segments AS (
            SELECT 
              ST_LineSubstring(geometry, 0, ST_LineLocatePoint(geometry, ST_Force2D($1))) as segment1,
              ST_LineSubstring(geometry, ST_LineLocatePoint(geometry, ST_Force2D($1)), 1) as segment2
            FROM ${stagingSchema}.trails 
            WHERE id = $2
          )
          SELECT 
            ST_Length(segment1) as segment1_length,
            ST_Length(segment2) as segment2_length,
            ST_NumPoints(segment1) as segment1_points,
            ST_NumPoints(segment2) as segment2_points
          FROM split_segments
        `, [intersection.intersection_point, trailToSplit.id]);
        
        if (splitTestResult.rowCount && splitTestResult.rowCount > 0) {
          const splitTest = splitTestResult.rows[0];
          console.log(`  📏 Split test results:`);
          console.log(`    Segment 1: ${splitTest.segment1_length.toFixed(1)}m, ${splitTest.segment1_points} points`);
          console.log(`    Segment 2: ${splitTest.segment2_length.toFixed(1)}m, ${splitTest.segment2_points} points`);
          
          if (splitTest.segment1_length > 0 && splitTest.segment2_length > 0) {
            console.log(`  ✅ Splitting logic should work!`);
          } else {
            console.log(`  ❌ Splitting logic failed - one segment has zero length`);
          }
        } else {
          console.log(`  ❌ Splitting test failed - no results`);
        }
      } else {
        console.log(`  ❌ No trail found to split`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

debugTYDetectionDetailed().catch(console.error);
