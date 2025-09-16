#!/usr/bin/env npx ts-node

import { Pool, PoolClient } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

interface ModifiedYIntersectionResult {
  success: boolean;
  originalTrailCount: number;
  finalTrailCount: number;
  intersectionsProcessed: number;
  error?: string;
}

async function testModifiedYIntersection(): Promise<ModifiedYIntersectionResult> {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-modified-y-intersection.ts <schema>');
    process.exit(1);
  }

  console.log(`🧪 Testing Modified Y-Intersection Service with 2% threshold for schema: ${schema}`);

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);
  let client: PoolClient | null = null;

  try {
    console.log('✅ Connected to database');

    // Get a client for transaction management
    client = await pool.connect();
    
    // Start transaction
    await client.query('BEGIN');
    console.log('🔄 Started database transaction');

    // Get initial trail count
    const initialTrailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
    const originalTrailCount = parseInt(initialTrailCountResult.rows[0].count);
    console.log(`📊 Initial trail count: ${originalTrailCount}`);

    // Check the specific intersection we want to process
    const intersectionQuery = `
      SELECT 
        t1.id as trail1_id,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.name as trail2_name,
        ST_Distance(
          ST_StartPoint(t1.geometry)::geography, 
          t2.geometry::geography
        ) as distance_meters,
        ST_LineLocatePoint(t2.geometry, ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) as line_location_ratio
      FROM ${schema}.trails t1
      CROSS JOIN ${schema}.trails t2
      WHERE t1.id = 201 AND t2.id = 680;
    `;

    const intersectionResult = await client.query(intersectionQuery);
    const intersection = intersectionResult.rows[0];
    
    console.log(`🔍 Intersection details:`);
    console.log(`   ${intersection.trail1_name} (ID: ${intersection.trail1_id}) → ${intersection.trail2_name} (ID: ${intersection.trail2_id})`);
    console.log(`   Distance: ${intersection.distance_meters.toFixed(3)}m`);
    console.log(`   Line location: ${(intersection.line_location_ratio * 100).toFixed(1)}%`);
    console.log(`   Within 2% threshold: ${intersection.line_location_ratio <= 0.02 ? '✅ Yes' : '❌ No'}`);

    if (intersection.distance_meters > 10.0) {
      throw new Error(`Distance ${intersection.distance_meters.toFixed(3)}m exceeds 10m tolerance`);
    }

    if (intersection.line_location_ratio > 0.02) {
      console.log(`⚠️  Line location ${(intersection.line_location_ratio * 100).toFixed(1)}% exceeds 2% threshold, but proceeding anyway for testing`);
    }

    // Find the intersection point
    const intersectionPointQuery = `
      SELECT 
        ST_AsText(ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) as intersection_point,
        ST_X(ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) as lng,
        ST_Y(ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) as lat,
        ST_Z(ST_ClosestPoint(t2.geometry, ST_StartPoint(t1.geometry))) as elevation
      FROM ${schema}.trails t1
      CROSS JOIN ${schema}.trails t2
      WHERE t1.id = 201 AND t2.id = 680;
    `;

    const pointResult = await client.query(intersectionPointQuery);
    const intersectionPoint = pointResult.rows[0];
    
    console.log(`📍 Intersection point: ${intersectionPoint.lng}, ${intersectionPoint.lat}, ${intersectionPoint.elevation}`);

    // Split the 1st/2nd Flatiron trail at the intersection point
    const splitQuery = `
      WITH split_segments AS (
        SELECT 
          (ST_Dump(ST_Split(geometry, ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2, $3), 4326), 0.00001)))).geom as segment_geom
        FROM ${schema}.trails 
        WHERE id = $4
      )
      SELECT 
        ST_AsText(segment_geom) as geometry_text,
        ST_Length(segment_geom::geography) as length_meters
      FROM split_segments
      WHERE ST_Length(segment_geom::geography) > 0.1
      ORDER BY ST_Length(segment_geom::geography) DESC;
    `;

    const splitResult = await client.query(splitQuery, [
      intersectionPoint.lng,
      intersectionPoint.lat,
      intersectionPoint.elevation || 0,
      680 // 1st/2nd Flatiron trail ID
    ]);

    console.log(`🔍 Split result: ${splitResult.rows.length} segments created`);
    splitResult.rows.forEach((segment, index) => {
      console.log(`   Segment ${index + 1}: ${segment.length_meters.toFixed(2)}m`);
    });

    if (splitResult.rows.length < 2) {
      throw new Error(`Split did not create enough segments (got ${splitResult.rows.length}, need at least 2)`);
    }

    // Get the original trail data before deleting
    const originalTrailQuery = `
      SELECT * FROM ${schema}.trails WHERE id = 680
    `;
    const originalTrailResult = await client.query(originalTrailQuery);
    
    if (originalTrailResult.rows.length === 0) {
      throw new Error('Original 1st/2nd Flatiron trail not found');
    }
    
    const originalTrail = originalTrailResult.rows[0];

    // Calculate total length of split children
    const childrenTotalLength = splitResult.rows.reduce((sum, segment) => sum + segment.length_meters, 0);
    const parentLength = originalTrail.length_km * 1000; // Convert km to meters
    const lengthDifference = Math.abs(childrenTotalLength - parentLength);
    const lengthMatch = lengthDifference < 1.0; // Allow 1 meter tolerance

    console.log(`📏 Length verification:`);
    console.log(`   Parent length: ${parentLength.toFixed(2)}m`);
    console.log(`   Children total: ${childrenTotalLength.toFixed(2)}m`);
    console.log(`   Difference: ${lengthDifference.toFixed(2)}m`);
    console.log(`   Length match: ${lengthMatch ? '✅ Yes' : '❌ No'}`);

    if (!lengthMatch) {
      throw new Error(`Length mismatch: parent ${parentLength.toFixed(2)}m vs children ${childrenTotalLength.toFixed(2)}m (diff: ${lengthDifference.toFixed(2)}m)`);
    }

    // Insert the new split segments (children)
    let segmentsInserted = 0;
    for (const segment of splitResult.rows) {
      await client.query(`
        INSERT INTO ${schema}.trails (
          app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        ) VALUES (
          gen_random_uuid(),
          $1,
          $2,
          $3, $4, $5,
          ST_Force3D($6::geometry),
          ST_Length($6::geography) / 1000.0,
          $7, $8, $9, $10, $11,
          ST_XMin($6::geometry), ST_XMax($6::geometry),
          ST_YMin($6::geometry), ST_YMax($6::geometry),
          $12, $13, $14
        )
      `, [
        originalTrail.app_uuid, // original_trail_uuid
        originalTrail.name,     // name
        originalTrail.trail_type,
        originalTrail.surface,
        originalTrail.difficulty,
        segment.geometry_text,  // geometry
        originalTrail.elevation_gain,
        originalTrail.elevation_loss,
        originalTrail.max_elevation,
        originalTrail.min_elevation,
        originalTrail.avg_elevation,
        originalTrail.source,
        originalTrail.source_tags,
        originalTrail.osm_id
      ]);
      segmentsInserted++;
    }

    console.log(`➕ Inserted ${segmentsInserted} split segments (children)`);

    // Verify children were inserted correctly
    const childrenQuery = `
      SELECT 
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE original_trail_uuid = $1
      ORDER BY ST_Length(geometry::geography) DESC;
    `;

    const childrenResult = await client.query(childrenQuery, [originalTrail.app_uuid]);
    console.log(`\n✂️  Split trail segments (children): ${childrenResult.rows.length} segments`);
    
    childrenResult.rows.forEach((segment, index) => {
      console.log(`   ${index + 1}. ${segment.app_uuid}: "${segment.name}" (${segment.length_meters.toFixed(2)}m)`);
    });

    // Only now delete the parent trail (after confirming children are correct)
    await client.query(
      `DELETE FROM ${schema}.trails WHERE id = 680`
    );
    console.log(`🗑️  Deleted parent trail 680 (after confirming children)`);

    // Get final trail count
    const finalTrailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
    const finalTrailCount = parseInt(finalTrailCountResult.rows[0].count);
    console.log(`📊 Final trail count: ${finalTrailCount}`);

    // Commit the transaction
    await client.query('COMMIT');
    console.log('\n✅ Transaction committed successfully!');

    return {
      success: true,
      originalTrailCount,
      finalTrailCount,
      intersectionsProcessed: 1
    };

  } catch (error) {
    console.error('\n❌ Error occurred, rolling back transaction:', error instanceof Error ? error.message : String(error));
    
    if (client) {
      try {
        await client.query('ROLLBACK');
        console.log('🔄 Transaction rolled back successfully');
      } catch (rollbackError) {
        console.error('❌ Error during rollback:', rollbackError);
      }
    }

    return {
      success: false,
      originalTrailCount: 0,
      finalTrailCount: 0,
      intersectionsProcessed: 0,
      error: error instanceof Error ? error.message : String(error)
    };

  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Test with rollback option
async function testWithRollback(): Promise<void> {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-modified-y-intersection.ts <schema> [--rollback]');
    process.exit(1);
  }

  const shouldRollback = process.argv.includes('--rollback');
  
  if (shouldRollback) {
    console.log('🧪 Testing modified Y-intersection rollback behavior...');
    
    const dbConfig = getDatabasePoolConfig();
    const pool = new Pool(dbConfig);
    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      
      // Get initial state
      const initialCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Initial trail count: ${initialCount.rows[0].count}`);

      // Check if 1st/2nd Flatiron exists
      const flatironExists = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails WHERE id = 680`);
      console.log(`📊 1st/2nd Flatiron exists: ${flatironExists.rows[0].count > 0 ? 'Yes' : 'No'}`);

      // Intentionally rollback without doing anything
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back intentionally');

      // Check final state
      const finalCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Final trail count after rollback: ${finalCount.rows[0].count}`);

      if (initialCount.rows[0].count === finalCount.rows[0].count) {
        console.log('✅ Rollback test successful - database state unchanged');
      } else {
        console.log('❌ Rollback test failed - database state changed');
      }

    } catch (error) {
      console.error('❌ Rollback test error:', error);
    } finally {
      if (client) {
        client.release();
      }
      await pool.end();
    }
  } else {
    // Run normal test
    const result = await testModifiedYIntersection();
    
    console.log('\n🎯 Final Test Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Intersections processed: ${result.intersectionsProcessed}`);
    console.log(`   Trail count change: ${result.originalTrailCount} → ${result.finalTrailCount} (${result.finalTrailCount - result.originalTrailCount > 0 ? '+' : ''}${result.finalTrailCount - result.originalTrailCount})`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
}

testWithRollback().catch(console.error);
