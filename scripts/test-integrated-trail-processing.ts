#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { TrailProcessingService } from '../src/services/layer1/TrailProcessingService';

async function testIntegratedTrailProcessing() {
  console.log('🧪 Testing integrated TrailProcessingService with working approach...\n');

  // Connect to database
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    console.log('✅ Connected to database');

    // Create a unique staging schema for this test
    const stagingSchema = `test_integrated_processing_${Date.now()}`;
    console.log(`📋 Creating fresh staging schema: ${stagingSchema}`);

    // Create the TrailProcessingService with the working configuration
    const trailProcessingService = new TrailProcessingService({
      stagingSchema,
      pgClient: pool,
      region: 'boulder',
      bbox: [-105.3, 39.96, -105.26, 40.0], // Boulder area
      toleranceMeters: 10.0 // 10 meter tolerance for intersection detection
    });

    // Process trails using the integrated working approach
    console.log('🛤️ Processing trails with integrated working approach...\n');
    
    const result = await trailProcessingService.processTrails();

    console.log('\n📊 Final Results:');
    console.log(`   Trails copied: ${result.trailsCopied}`);
    console.log(`   Trails cleaned: ${result.trailsCleaned}`);
    console.log(`   Trails split: ${result.trailsSplit}`);
    console.log(`   Connectivity metrics:`, result.connectivityMetrics);

    // Check if topology was created successfully
    if (result.connectivityMetrics?.topologyCreated) {
      console.log('\n✅ SUCCESS: Topology created successfully!');
      console.log(`   Vertices: ${result.connectivityMetrics.vertices}`);
      console.log(`   Edges: ${result.connectivityMetrics.edges}`);
      console.log(`   Connected edges: ${result.connectivityMetrics.connectedEdges}`);
      console.log(`   Isolated edges: ${result.connectivityMetrics.isolatedEdges}`);
    } else {
      console.log('\n❌ FAILED: Topology creation failed');
      console.log(`   Error: ${result.connectivityMetrics?.error || 'Unknown error'}`);
    }

    // Keep the schema for debugging
    console.log(`\n🔍 Keeping schema ${stagingSchema} for debugging`);

  } catch (error) {
    console.error('❌ Error during integrated trail processing test:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testIntegratedTrailProcessing().catch(console.error);
