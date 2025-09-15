#!/usr/bin/env npx ts-node

import { Pool, PoolClient } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import { YIntersectionSplittingService } from './src/services/layer1/YIntersectionSplittingService';

interface YIntersectionTestResult {
  success: boolean;
  originalTrailCount: number;
  finalTrailCount: number;
  intersectionsProcessed: number;
  toleranceUsed: number;
  error?: string;
}

async function testYIntersectionService(): Promise<YIntersectionTestResult> {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-y-intersection-service.ts <schema> [--tolerance=10]');
    process.exit(1);
  }

  // Parse tolerance from command line args
  const toleranceArg = process.argv.find(arg => arg.startsWith('--tolerance='));
  const tolerance = toleranceArg ? parseFloat(toleranceArg.split('=')[1]) : 5.0; // Default 5m

  console.log(`🧪 Testing Y-Intersection Splitting Service for schema: ${schema} with tolerance: ${tolerance}m`);

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

    // Check for the specific trails we expect to find
    const flatironTrailQuery = `
      SELECT id, name, ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE name ILIKE '%flatiron%' AND name ILIKE '%1st%'
      LIMIT 1;
    `;

    const flatironResult = await client.query(flatironTrailQuery);
    
    if (flatironResult.rows.length === 0) {
      throw new Error('1st/2nd Flatiron trail not found');
    }

    const flatironTrail = flatironResult.rows[0];
    console.log(`🛤️  Found 1st/2nd Flatiron trail: ID ${flatironTrail.id} (${flatironTrail.length_meters.toFixed(2)}m)`);

    const saddleRockTrailQuery = `
      SELECT id, name, ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE name ILIKE '%saddle rock%'
      LIMIT 1;
    `;

    const saddleRockResult = await client.query(saddleRockTrailQuery);
    
    if (saddleRockResult.rows.length === 0) {
      throw new Error('New Saddle Rock Trail not found');
    }

    const saddleRockTrail = saddleRockResult.rows[0];
    console.log(`🛤️  Found New Saddle Rock Trail: ID ${saddleRockTrail.id} (${saddleRockTrail.length_meters.toFixed(2)}m)`);

    // Check the distance between them
    const distanceQuery = `
      SELECT 
        ST_Distance(
          ST_StartPoint(t1.geometry),
          t2.geometry
        ) * 111320 as distance_meters
      FROM ${schema}.trails t1
      CROSS JOIN ${schema}.trails t2
      WHERE t1.id = $1 AND t2.id = $2;
    `;

    const distanceResult = await client.query(distanceQuery, [saddleRockTrail.id, flatironTrail.id]);
    const distance = distanceResult.rows[0].distance_meters;
    console.log(`📏 Distance from New Saddle Rock start to 1st/2nd Flatiron: ${distance.toFixed(2)}m`);

    if (distance > tolerance) {
      console.log(`⚠️  Distance (${distance.toFixed(2)}m) exceeds tolerance (${tolerance}m). The Y-intersection service may not catch this.`);
    } else {
      console.log(`✅ Distance (${distance.toFixed(2)}m) is within tolerance (${tolerance}m). The Y-intersection service should catch this.`);
    }

    // Create the Y-intersection splitting service with our tolerance
    const yIntersectionService = new YIntersectionSplittingService(
      client,
      schema,
      {
        toleranceMeters: tolerance,
        minTrailLengthMeters: 5.0,
        minSnapDistanceMeters: 1.0,
        maxIterations: 3,
        verbose: true
      }
    );

    console.log('\n🎯 Running Y-Intersection Splitting Service...');
    
    // Execute the service
    const result = await yIntersectionService.applyYIntersectionSplitting();

    console.log('\n📊 Service Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Intersections detected: ${result.intersectionCount}`);
    console.log(`   Trails processed: ${result.trailsProcessed}`);
    console.log(`   Segments created: ${result.segmentsCreated}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
      throw new Error(`Service failed: ${result.error}`);
    }

    // Get final trail count
    const finalTrailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
    const finalTrailCount = parseInt(finalTrailCountResult.rows[0].count);
    console.log(`📊 Final trail count: ${finalTrailCount}`);

    // Check for split segments
    const splitSegmentsQuery = `
      SELECT 
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE original_trail_uuid IS NOT NULL
      ORDER BY original_trail_uuid, ST_Length(geometry::geography) DESC;
    `;

    const splitSegmentsResult = await client.query(splitSegmentsQuery);
    console.log(`\n✂️  Split trail segments: ${splitSegmentsResult.rows.length} segments`);
    
    if (splitSegmentsResult.rows.length > 0) {
      const groupedByOriginal: Record<string, any[]> = {};
      
      splitSegmentsResult.rows.forEach((row: any) => {
        if (!groupedByOriginal[row.original_trail_uuid]) {
          groupedByOriginal[row.original_trail_uuid] = [];
        }
        groupedByOriginal[row.original_trail_uuid].push(row);
      });

      for (const [originalUuid, segments] of Object.entries(groupedByOriginal)) {
        console.log(`   Original trail ${originalUuid} split into ${segments.length} segments:`);
        segments.forEach((segment: any, index: number) => {
          console.log(`      ${index + 1}. ${segment.app_uuid}: "${segment.name}" (${segment.length_meters.toFixed(2)}m)`);
        });
      }
    }

    // Commit the transaction
    await client.query('COMMIT');
    console.log('\n✅ Transaction committed successfully!');

    return {
      success: true,
      originalTrailCount,
      finalTrailCount,
      intersectionsProcessed: result.intersectionCount,
      toleranceUsed: tolerance
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
      toleranceUsed: tolerance,
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
    console.error('Usage: npx ts-node test-y-intersection-service.ts <schema> [--tolerance=10] [--rollback]');
    process.exit(1);
  }

  const shouldRollback = process.argv.includes('--rollback');
  
  if (shouldRollback) {
    console.log('🧪 Testing Y-intersection service rollback behavior...');
    
    const dbConfig = getDatabasePoolConfig();
    const pool = new Pool(dbConfig);
    let client: PoolClient | null = null;

    try {
      client = await pool.connect();
      await client.query('BEGIN');
      
      // Get initial state
      const initialCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Initial trail count: ${initialCount.rows[0].count}`);

      // Parse tolerance
      const toleranceArg = process.argv.find(arg => arg.startsWith('--tolerance='));
      const tolerance = toleranceArg ? parseFloat(toleranceArg.split('=')[1]) : 5.0;

      // Run the Y-intersection service
      const yIntersectionService = new YIntersectionSplittingService(
        client,
        schema,
        {
          toleranceMeters: tolerance,
          minTrailLengthMeters: 5.0,
          minSnapDistanceMeters: 1.0,
          maxIterations: 1, // Just one iteration for rollback test
          verbose: true
        }
      );

      const result = await yIntersectionService.applyYIntersectionSplitting();
      console.log(`📊 Service completed: ${result.success ? 'Success' : 'Failed'}`);

      // Get state after service
      const afterCount = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
      console.log(`📊 Trail count after service: ${afterCount.rows[0].count}`);

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
    const result = await testYIntersectionService();
    
    console.log('\n🎯 Final Test Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Intersections processed: ${result.intersectionsProcessed}`);
    console.log(`   Trail count change: ${result.originalTrailCount} → ${result.finalTrailCount} (${result.finalTrailCount - result.originalTrailCount > 0 ? '+' : ''}${result.finalTrailCount - result.originalTrailCount})`);
    console.log(`   Tolerance used: ${result.toleranceUsed}m`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
}

testWithRollback().catch(console.error);
