#!/usr/bin/env ts-node

/**
 * Standalone test for gap detection functionality
 * Tests the specific scenario where a degree-2 connector vertex should be connected to a degree-1 endpoint
 */

import { Pool } from 'pg';
import { detectAndFixGaps, validateGapDetection } from '../src/utils/services/network-creation/gap-detection-service';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_gap_detection_standalone_20241215';

async function testGapDetection() {
  console.log('🧪 Testing gap detection with specific coordinates...');
  
  const pgClient = new Pool(DB_CONFIG);
  
  try {
    await pgClient.connect();
    
    // Clean up test schema
    await pgClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    
    // Create test tables
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded (
        id integer PRIMARY KEY,
        source integer,
        target integer,
        the_geom geometry(LineString,4326),
        length_km real,
        elevation_gain real,
        elevation_loss real,
        name text,
        app_uuid text,
        old_id bigint
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${TEST_SCHEMA}.ways_noded_vertices_pgr (
        id bigint PRIMARY KEY,
        cnt integer,
        chk integer,
        ein integer,
        eout integer,
        the_geom geometry(Point,4326)
      )
    `);
    
    // Insert test vertices that are within 20m of each other
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      -- Vertex 30: Connector (degree 2) at (-105.236343, 39.946148)
      (30, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326)),
      -- Vertex 29: Endpoint (degree 1) at (-105.236343, 39.946168) - 2.2m away
      (29, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.236343 39.946168)', 4326))
    `);
    
    // Insert a sample edge connected to vertex 30 to make it degree-2
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      (1, 30, 31, ST_GeomFromText('LINESTRING(-105.236343 39.946148, -105.236343 39.946248)', 4326), 0.011, 0, 0, 'Test Trail', 'test-trail-1', NULL)
    `);
    
    // Insert vertex 31 to complete the edge
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      (31, 1, 0, 1, 0, ST_GeomFromText('POINT(-105.236343 39.946248)', 4326))
    `);
    
    // Calculate the actual distance between the vertices
    const distanceResult = await pgClient.query(`
      SELECT ST_Distance(
        (SELECT the_geom FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 30),
        (SELECT the_geom FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr WHERE id = 29)
      ) * 111320 as distance_meters
    `);
    
    const distanceMeters = distanceResult.rows[0].distance_meters;
    console.log(`📏 Distance between vertices: ${distanceMeters.toFixed(2)} meters`);
    
    // Test with 20m tolerance
    const gapConfig = {
      toleranceMeters: 20,
      maxBridgesToCreate: 10
    };
    
    console.log(`🎯 Testing with tolerance: ${gapConfig.toleranceMeters} meters`);
    
    // Validate gap detection before running
    const validation = await validateGapDetection(pgClient, TEST_SCHEMA, gapConfig);
    console.log(`📊 Gap detection validation:`);
    console.log(`   Total vertices: ${validation.totalVertices}`);
    console.log(`   Degree-1 vertices: ${validation.degree1Vertices}`);
    console.log(`   Degree-2+ vertices: ${validation.degree2PlusVertices}`);
    console.log(`   Potential gaps: ${validation.potentialGaps}`);
    
    // Use the gap detection service
    const result = await detectAndFixGaps(pgClient, TEST_SCHEMA, gapConfig);
    
    console.log(`🔍 Gap detection results:`);
    console.log(`   Gaps found: ${result.gapsFound}`);
    console.log(`   Bridges created: ${result.bridgesCreated}`);
    
    if (result.details.length > 0) {
      result.details.forEach((detail, index) => {
        console.log(`   Bridge ${index + 1}: Vertex ${detail.node1_id} → Vertex ${detail.node2_id} (${detail.distance_meters.toFixed(2)}m)`);
      });
    }
    
    // Check that our specific vertices are detected
    const ourBridge = result.details.find(detail => 
      (detail.node1_id === 29 && detail.node2_id === 30) || 
      (detail.node1_id === 30 && detail.node2_id === 29)
    );
    
    // Verify bridge was actually created in database
    const bridgeCount = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${TEST_SCHEMA}.ways_noded 
      WHERE name = 'Bridge Connector'
    `);
    
    console.log(`🔗 Bridges created in database: ${bridgeCount.rows[0].count}`);
    
    // Results summary
    console.log('\n📋 Test Results:');
    console.log(`   Distance between vertices: ${distanceMeters.toFixed(2)}m`);
    console.log(`   Tolerance: ${gapConfig.toleranceMeters}m`);
    console.log(`   Gaps detected: ${result.gapsFound}`);
    console.log(`   Bridges created: ${result.bridgesCreated}`);
    console.log(`   Our specific gap detected: ${ourBridge ? 'YES' : 'NO'}`);
    console.log(`   Bridge in database: ${bridgeCount.rows[0].count > 0 ? 'YES' : 'NO'}`);
    
    if (distanceMeters < gapConfig.toleranceMeters && result.gapsFound > 0 && ourBridge && bridgeCount.rows[0].count > 0) {
      console.log('\n✅ Gap detection test PASSED!');
    } else {
      console.log('\n❌ Gap detection test FAILED!');
    }
    
  } catch (error) {
    console.error('❌ Error during gap detection test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testGapDetection();
