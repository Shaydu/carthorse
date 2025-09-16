#!/usr/bin/env npx ts-node

import { Pool, PoolClient } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

interface SimpleSplitResult {
  success: boolean;
  originalTrailCount: number;
  finalTrailCount: number;
  trailsSplit: number;
  error?: string;
}

async function testSimpleTransactionalSplit(): Promise<SimpleSplitResult> {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-simple-transactional-split.ts <schema>');
    process.exit(1);
  }

  console.log(`🧪 Testing Simple Transactional Trail Split for schema: ${schema}`);

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

    // Find the 1st/2nd Flatiron trail
    const flatironTrailQuery = `
      SELECT id, app_uuid, name, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE name ILIKE '%flatiron%' AND name ILIKE '%1st%'
      LIMIT 1;
    `;

    const flatironResult = await client.query(flatironTrailQuery);
    
    if (flatironResult.rows.length === 0) {
      throw new Error('1st/2nd Flatiron trail not found');
    }

    const flatironTrail = flatironResult.rows[0];
    console.log(`🛤️  Found trail: "${flatironTrail.name}" (${flatironTrail.length_meters.toFixed(2)}m)`);

    // Define the split point (Y intersection point)
    const splitPointLng = -105.295095;
    const splitPointLat = 39.990015;
    const splitPointElevation = 2176.841796875;

    console.log(`📍 Split point: ${splitPointLng}, ${splitPointLat}, ${splitPointElevation}`);

    // Step 1: Split the trail at the point
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
      splitPointLng,
      splitPointLat,
      splitPointElevation,
      flatironTrail.id
    ]);

    console.log(`🔍 Split result: ${splitResult.rows.length} segments created`);
    splitResult.rows.forEach((segment, index) => {
      console.log(`   Segment ${index + 1}: ${segment.length_meters.toFixed(2)}m`);
    });

    if (splitResult.rows.length < 2) {
      throw new Error(`Split did not create enough segments (got ${splitResult.rows.length}, need at least 2)`);
    }

    // Step 2: Get the original trail data before deleting
    const originalTrailQuery = `
      SELECT * FROM ${schema}.trails WHERE id = $1
    `;
    const originalTrailResult = await client.query(originalTrailQuery, [flatironTrail.id]);
    
    if (originalTrailResult.rows.length === 0) {
      throw new Error('Original trail not found');
    }
    
    const originalTrail = originalTrailResult.rows[0];

    // Step 3: Delete the original trail
    await client.query(
      `DELETE FROM ${schema}.trails WHERE id = $1`,
      [flatironTrail.id]
    );
    console.log(`🗑️  Deleted original trail ${flatironTrail.id}`);

    // Step 4: Insert the new split segments
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

    console.log(`➕ Inserted ${segmentsInserted} split segments`);

    // Get final trail count
    const finalTrailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
    const finalTrailCount = parseInt(finalTrailCountResult.rows[0].count);
    console.log(`📊 Final trail count: ${finalTrailCount}`);

    // Verify the split segments
    const splitSegmentsQuery = `
      SELECT 
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE original_trail_uuid = $1
      ORDER BY ST_Length(geometry::geography) DESC;
    `;

    const splitSegmentsResult = await client.query(splitSegmentsQuery, [originalTrail.app_uuid]);
    console.log(`\n✂️  Split trail segments: ${splitSegmentsResult.rows.length} segments`);
    
    splitSegmentsResult.rows.forEach((segment, index) => {
      console.log(`   ${index + 1}. ${segment.app_uuid}: "${segment.name}" (${segment.length_meters.toFixed(2)}m)`);
    });

    // Commit the transaction
    await client.query('COMMIT');
    console.log('\n✅ Transaction committed successfully!');

    return {
      success: true,
      originalTrailCount,
      finalTrailCount,
      trailsSplit: 1
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
      trailsSplit: 0,
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
    console.error('Usage: npx ts-node test-simple-transactional-split.ts <schema> [--rollback]');
    process.exit(1);
  }

  const shouldRollback = process.argv.includes('--rollback');
  
  if (shouldRollback) {
    console.log('🧪 Testing transaction rollback behavior...');
    
    const dbConfig = getDatabasePoolConfig();
    const pool = new Pool(dbConfig);
    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      
      // Get initial state
      const initialCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Initial trail count: ${initialCount.rows[0].count}`);

      // Run the split operation
      const flatironTrailQuery = `
        SELECT id, app_uuid, name, ST_AsText(geometry) as geom_text, ST_Length(geometry::geography) as length_meters
        FROM ${schema}.trails 
        WHERE name ILIKE '%flatiron%' AND name ILIKE '%1st%'
        LIMIT 1;
      `;

      const flatironResult = await client.query(flatironTrailQuery);
      
      if (flatironResult.rows.length === 0) {
        throw new Error('1st/2nd Flatiron trail not found');
      }

      const flatironTrail = flatironResult.rows[0];
      console.log(`🛤️  Found trail: "${flatironTrail.name}" (${flatironTrail.length_meters.toFixed(2)}m)`);

      // Split the trail
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
        -105.295095, 39.990015, 2176.841796875, flatironTrail.id
      ]);

      console.log(`🔍 Split result: ${splitResult.rows.length} segments created`);

      // Get state after split
      const afterCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Trail count after split: ${afterCount.rows[0].count}`);

      // Intentionally rollback
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back intentionally');

      // Check final state
      const finalCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Final trail count after rollback: ${finalCount.rows[0].count}`);

      if (initialCount.rows[0].count === finalCount.rows[0].count) {
        console.log('✅ Rollback test successful - database state restored');
      } else {
        console.log('❌ Rollback test failed - database state not restored');
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
    const result = await testSimpleTransactionalSplit();
    
    console.log('\n🎯 Final Test Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Trails split: ${result.trailsSplit}`);
    console.log(`   Trail count change: ${result.originalTrailCount} → ${result.finalTrailCount} (${result.finalTrailCount - result.originalTrailCount > 0 ? '+' : ''}${result.finalTrailCount - result.originalTrailCount})`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
}

testWithRollback().catch(console.error);
