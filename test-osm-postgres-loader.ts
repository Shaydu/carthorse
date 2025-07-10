#!/usr/bin/env ts-node
/**
 * Test script for OSM PostgreSQL Loader
 * 
 * This script tests the OSM PostgreSQL loader with the Boulder OSM data.
 */

import { createOSMPostgresLoader } from './carthorse-osm-postgres-loader';

async function testOSMPostgresLoader() {
  console.log('🧪 Testing OSM PostgreSQL Loader...');
  
  try {
    // Create OSM PostgreSQL loader for Boulder
    const osmLoader = createOSMPostgresLoader('boulder');
    
    // Load OSM data into PostgreSQL
    console.log('📖 Loading OSM data into PostgreSQL...');
    await osmLoader.loadOSMData();
    
    // Extract trails from PostgreSQL OSM data
    console.log('🔍 Extracting trails from PostgreSQL...');
    const trails = await osmLoader.extractTrails();
    
    console.log(`✅ Successfully extracted ${trails.length} trails`);
    
    // Show first few trails as examples
    console.log('\n📋 Sample trails:');
    trails.slice(0, 5).forEach((trail, index) => {
      console.log(`  ${index + 1}. ${trail.name} (OSM ID: ${trail.osm_id})`);
      console.log(`     Type: ${trail.trail_type}, Surface: ${trail.surface}`);
      console.log(`     Coordinates: ${trail.coordinates.length} points`);
    });
    
    // Clean up OSM schema (optional)
    // await osmLoader.cleanup();
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testOSMPostgresLoader(); 