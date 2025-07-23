#!/usr/bin/env ts-node
/**
 * Test script for OSM Extract Reader
 * 
 * This script tests the OSM extract reader with the Boulder OSM data.
 */

import { createOSMExtractReader } from './carthorse-osm-extract-reader';

async function testOSMExtractReader() {
  console.log('🧪 Testing OSM Extract Reader...');
  
  try {
    // Create OSM extract reader for Boulder
    const osmReader = createOSMExtractReader('boulder');
    
    // Extract trails from OSM PBF file
    console.log('📖 Extracting trails from OSM extract...');
    const trails = await osmReader.extractTrails();
    
    console.log(`✅ Successfully extracted ${trails.length} trails`);
    
    // Show first few trails as examples
    console.log('\n📋 Sample trails:');
    trails.slice(0, 5).forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.name} (OSM ID: ${trail.osm_id})`);
      console.log(`     Type: ${trail.trail_type}, Surface: ${trail.surface}`);
      console.log(`     Coordinates: ${trail.coordinates.length} points`);
    });
    
    // Clean up temporary files
    await osmReader.cleanup();
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testOSMExtractReader(); 