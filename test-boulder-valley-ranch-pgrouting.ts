#!/usr/bin/env ts-node

import { PgRoutingOrchestrator } from './src/orchestrator/PgRoutingOrchestrator';
import * as dotenv from 'dotenv';
dotenv.config();

async function testBoulderValleyRanchPgRouting() {
  console.log('🗺️ Testing PgRouting with Boulder Valley Ranch bbox...');
  
  // Boulder Valley Ranch bbox coordinates
  const boulderValleyRanchBbox: [number, number, number, number] = [
    -105.2895, 40.0533,  // min_lng, min_lat
    -105.2355, 40.1073   // max_lng, max_lat
  ];
  
  const config = {
    region: 'boulder',
    outputPath: 'data/boulder-valley-ranch-pgrouting-test.geojson',
    bbox: boulderValleyRanchBbox,
    simplifyTolerance: 0.001,
    intersectionTolerance: 1,
    skipCleanup: true
  };
  
  const orchestrator = new PgRoutingOrchestrator(config);
  
  try {
    console.log('🚀 Starting PgRouting test with Boulder Valley Ranch bbox...');
    await orchestrator.run();
    console.log('✅ PgRouting test completed successfully!');
  } catch (error) {
    console.error('❌ PgRouting test failed:', error);
    throw error;
  } finally {
    await orchestrator.cleanupStaging();
  }
}

if (require.main === module) {
  testBoulderValleyRanchPgRouting()
    .then(() => {
      console.log('🎉 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
} 