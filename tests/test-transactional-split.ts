#!/usr/bin/env npx ts-node

import { Pool, PoolClient } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';
import { PointSnapAndSplitService } from '../src/services/layer1/PointSnapAndSplitService';

interface TransactionalSplitResult {
  success: boolean;
  pointsProcessed: number;
  trailsSplit: number;
  intersectionsCreated: number;
  originalTrailCount: number;
  finalTrailCount: number;
  error?: string;
}

async function testTransactionalSplit(): Promise<TransactionalSplitResult> {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-transactional-split.ts <schema>');
    process.exit(1);
  }

  console.log(`🧪 Testing Transactional Point Snap and Split Service for schema: ${schema}`);

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

    // Create the service with the transaction client
    const service = new PointSnapAndSplitService({
      stagingSchema: schema,
      pgClient: client, // Use the transaction client
      snapToleranceMeters: 10.0, // 10 meter tolerance
      verbose: true
    });

    // Add your specific point
    service.addPoint({
      lng: -105.295095,
      lat: 39.990015,
      elevation: 2176.841796875,
      description: 'Y intersection point to snap and split',
      preferredTrailName: '1st/2nd Flatiron'
    });

    console.log('\n🎯 Running Point Snap and Split Service within transaction...');
    
    // Execute the service
    const result = await service.execute();

    console.log('\n📊 Service Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Points processed: ${result.pointsProcessed}`);
    console.log(`   Trails split: ${result.trailsSplit}`);
    console.log(`   Intersections created: ${result.intersectionsCreated}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
      throw new Error(`Service failed: ${result.error}`);
    }

    // Get final trail count
    const finalTrailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${schema}.trails`);
    const finalTrailCount = parseInt(finalTrailCountResult.rows[0].count);
    console.log(`📊 Final trail count: ${finalTrailCount}`);

    // Verify the results by checking the database within the transaction
    console.log('\n🔍 Verifying results within transaction...');
    
    // Check for updated predictions
    const predictionsQuery = `
      SELECT 
        gp.node_id,
        gp.prediction,
        gp.confidence,
        rn.lat,
        rn.lng,
        rn.elevation,
        rn.node_type,
        rn.connected_trails
      FROM ${schema}.graphsage_predictions gp
      JOIN ${schema}.routing_nodes rn ON gp.node_id = rn.id
      WHERE gp.confidence = 1.0
      ORDER BY gp.node_id;
    `;

    const predictionsResult = await client.query(predictionsQuery);
    console.log(`\n📈 Expert corrections (confidence = 1.0): ${predictionsResult.rows.length} nodes`);
    
    predictionsResult.rows.forEach((row, index) => {
      const labelText = row.prediction === 0 ? 'Keep as-is' : 
                       row.prediction === 1 ? 'Merge degree-2' : 
                       row.prediction === 2 ? 'Split Y/T' : 'Unknown';
      console.log(`   ${index + 1}. Node ${row.node_id}: ${labelText} at ${row.lng}, ${row.lat}, ${row.elevation} (type: ${row.node_type}, trails: ${row.connected_trails})`);
    });

    // Check for degree-3 intersections
    const degree3Query = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails
      FROM ${schema}.routing_nodes 
      WHERE node_type = 'degree3_intersection'
      ORDER BY id;
    `;

    const degree3Result = await client.query(degree3Query);
    console.log(`\n🔗 Degree-3 intersections: ${degree3Result.rows.length} nodes`);
    
    degree3Result.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Node ${row.id}: ${row.lng}, ${row.lat}, ${row.elevation} (trails: ${row.connected_trails})`);
    });

    // Check for split trails (trails with original_trail_uuid set)
    const splitTrailsQuery = `
      SELECT 
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE original_trail_uuid IS NOT NULL
      ORDER BY original_trail_uuid, ST_Length(geometry::geography) DESC;
    `;

    const splitTrailsResult = await client.query(splitTrailsQuery);
    console.log(`\n✂️  Split trail segments: ${splitTrailsResult.rows.length} segments`);
    
    if (splitTrailsResult.rows.length > 0) {
      const groupedByOriginal: Record<string, any[]> = {};
      
      splitTrailsResult.rows.forEach((row: any) => {
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
      pointsProcessed: result.pointsProcessed,
      trailsSplit: result.trailsSplit,
      intersectionsCreated: result.intersectionsCreated,
      originalTrailCount,
      finalTrailCount
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
      pointsProcessed: 0,
      trailsSplit: 0,
      intersectionsCreated: 0,
      originalTrailCount: 0,
      finalTrailCount: 0,
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
    console.error('Usage: npx ts-node test-transactional-split.ts <schema> [--rollback]');
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

      // Run the service
      const service = new PointSnapAndSplitService({
        stagingSchema: schema,
        pgClient: client,
        snapToleranceMeters: 10.0,
        verbose: true
      });

      service.addPoint({
        lng: -105.295095,
        lat: 39.990015,
        elevation: 2176.841796875,
        description: 'Y intersection point to snap and split (ROLLBACK TEST)',
        preferredTrailName: '1st/2nd Flatiron'
      });

      const result = await service.execute();
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
    const result = await testTransactionalSplit();
    
    console.log('\n🎯 Final Test Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Points processed: ${result.pointsProcessed}`);
    console.log(`   Trails split: ${result.trailsSplit}`);
    console.log(`   Intersections created: ${result.intersectionsCreated}`);
    console.log(`   Trail count change: ${result.originalTrailCount} → ${result.finalTrailCount} (${result.finalTrailCount - result.originalTrailCount > 0 ? '+' : ''}${result.finalTrailCount - result.originalTrailCount})`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
}

testWithRollback().catch(console.error);
