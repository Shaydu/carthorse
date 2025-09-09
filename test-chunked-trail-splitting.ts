#!/usr/bin/env ts-node

/**
 * Test Chunked Trail Splitting
 * 
 * This script tests the new chunked trail splitting functionality
 * to solve the Y intersection detection issue with large bboxes.
 */

import { Pool } from 'pg';
import { TrailProcessingService } from './src/services/layer1/TrailProcessingService';
import { StagingSqlHelpers } from './src/utils/sql/staging-sql-helpers';

async function testChunkedTrailSplitting() {
  console.log('🧪 Testing Chunked Trail Splitting...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    // Create staging schema
    const stagingSchema = `carthorse_${Date.now()}`;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Create staging environment
    const stagingHelpers = new StagingSqlHelpers(pgClient, {
      stagingSchema,
      region: 'boulder'
    });
    
    await stagingHelpers.createStagingTables();
    console.log('✅ Staging tables created');
    
    // Copy trail data with the large bbox that was causing issues
    const largeBbox: [number, number, number, number] = [
      -105.30123174925316, 39.91538502242032, -105.26050515816028, 40.083172777276015
    ];
    
    console.log(`📊 Copying trails with large bbox: [${largeBbox.join(', ')}]`);
    await stagingHelpers.copyRegionDataToStaging(largeBbox);
    
    // Get initial trail count
    const initialCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`📊 Initial trail count: ${initialCount.rows[0].count}`);
    
    // Configure trail processing with chunked splitting enabled
    const trailProcessingConfig = {
      stagingSchema,
      pgClient,
      region: 'boulder',
      bbox: largeBbox,
      sourceFilter: 'cotrex',
      
      // Enable chunked trail splitting
      runChunkedTrailSplitting: true,
      
      // Disable other splitting services to isolate the chunked splitting
      runEndpointSnapping: false,
      runTrailEndpointSnapping: false,
      runProximitySnappingSplitting: false,
      runTrueCrossingSplitting: false,
      runMultipointIntersectionSplitting: false,
      runEnhancedIntersectionSplitting: false,
      runTIntersectionSplitting: false,
      runShortTrailSplitting: false,
      runIntersectionBasedTrailSplitter: false,
      runYIntersectionSnapping: false,
      runVertexBasedSplitting: false,
      runMissedIntersectionDetection: false,
      runSimpleTrailSnapping: false,
      runStandaloneTrailSplitting: false,
      
      // Parameters
      toleranceMeters: 5.0,
      tIntersectionToleranceMeters: 3.0,
      minSegmentLengthMeters: 5.0,
      verbose: true
    };
    
    // Process trails with chunked splitting
    const trailProcessor = new TrailProcessingService(trailProcessingConfig);
    const result = await trailProcessor.processTrails();
    
    console.log('📊 Trail Processing Results:');
    console.log(`   Trails copied: ${result.trailsCopied}`);
    console.log(`   Trails split: ${result.trailsSplit}`);
    console.log(`   Trails snapped: ${result.trailsSnapped}`);
    console.log(`   Overlaps removed: ${result.overlapsRemoved}`);
    
    // Check final trail count
    const finalCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`📊 Final trail count: ${finalCount.rows[0].count}`);
    
    // Check chunk distribution
    const chunkStats = await pgClient.query(`
      SELECT 
        chunk_id,
        COUNT(*) as trail_count
      FROM ${stagingSchema}.trails
      WHERE chunk_id IS NOT NULL
      GROUP BY chunk_id
      ORDER BY chunk_id
    `);
    
    console.log('📊 Chunk distribution:');
    chunkStats.rows.forEach(row => {
      console.log(`   Chunk ${row.chunk_id}: ${row.trail_count} trails`);
    });
    
    // Check for the specific Y intersection at node 380 coordinates
    const yIntersectionCheck = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        chunk_id,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails
      WHERE ST_DWithin(
        ST_StartPoint(geometry), 
        ST_GeomFromText('POINT(-105.282045 39.95136)', 4326), 
        0.001
      ) OR ST_DWithin(
        ST_EndPoint(geometry), 
        ST_GeomFromText('POINT(-105.282045 39.95136)', 4326), 
        0.001
      )
    `);
    
    console.log('🎯 Y Intersection Check (node 380 coordinates):');
    if (yIntersectionCheck.rows.length > 0) {
      yIntersectionCheck.rows.forEach(row => {
        console.log(`   Trail: ${row.name} (${row.app_uuid})`);
        console.log(`   Chunk: ${row.chunk_id}`);
        console.log(`   Start: ${row.start_point}`);
        console.log(`   End: ${row.end_point}`);
      });
    } else {
      console.log('   No trails found near Y intersection coordinates');
    }
    
    console.log('✅ Chunked trail splitting test completed');
    
  } catch (error) {
    console.error('❌ Error in chunked trail splitting test:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the test
if (require.main === module) {
  testChunkedTrailSplitting()
    .then(() => {
      console.log('🎉 Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

export { testChunkedTrailSplitting };
