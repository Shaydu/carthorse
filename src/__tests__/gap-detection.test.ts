#!/usr/bin/env ts-node

/**
 * Unit test for gap detection functionality
 * Tests the specific scenario where a degree-2 connector vertex should be connected to a degree-1 endpoint
 */

import { Pool } from 'pg';
import { detectAndFixGaps, validateGapDetection } from '../utils/services/network-creation/gap-detection-service';

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: ''
};

const TEST_SCHEMA = 'test_gap_detection_20241215';

describe('Gap Detection', () => {
  let pgClient: Pool;

  beforeAll(async () => {
    pgClient = new Pool(DB_CONFIG);
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  beforeEach(async () => {
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
        original_trail_id bigint
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
  });

  test('should detect gap between degree-2 connector and degree-1 endpoint within 20m tolerance', async () => {
    console.log('🧪 Testing gap detection with specific coordinates...');
    
    // Insert test vertices based on the provided GeoJSON
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      -- Vertex 30: Connector (degree 2) at (-105.236343, 39.946148)
      (30, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326)),
      -- Vertex 29: Endpoint (degree 1) at (-105.236601, 39.94537)
      (29, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.236601 39.94537)', 4326))
    `);
    
    // Insert a sample edge connected to vertex 30 to make it degree-2
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, original_trail_id) VALUES
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
    
    // Assertions
    expect(distanceMeters).toBeLessThan(gapConfig.toleranceMeters);
    expect(result.gapsFound).toBeGreaterThan(0);
    expect(result.bridgesCreated).toBeGreaterThan(0);
    
    // Check that our specific vertices are detected
    const ourBridge = result.details.find(detail => 
      (detail.node1_id === 29 && detail.node2_id === 30) || 
      (detail.node1_id === 30 && detail.node2_id === 29)
    );
    
    expect(ourBridge).toBeDefined();
    expect(ourBridge!.distance_meters).toBeLessThan(gapConfig.toleranceMeters);
    
    // Verify bridge was actually created in database
    const bridgeCount = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${TEST_SCHEMA}.ways_noded 
      WHERE name = 'Bridge Connector'
    `);
    
    expect(bridgeCount.rows[0].count).toBeGreaterThan(0);
    
    console.log('✅ Gap detection test passed!');
  });

  test('should not detect gap when vertices are too far apart', async () => {
    console.log('🧪 Testing gap detection with vertices too far apart...');
    
    // Insert vertices that are too far apart (>20m)
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      -- Vertex 40: Endpoint (degree 1) at (-105.236343, 39.946148)
      (40, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326)),
      -- Vertex 41: Connector (degree 2) at (-105.236343, 39.946348) - 22m away
      (41, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.236343 39.946348)', 4326))
    `);
    
    // Insert a sample edge connected to vertex 41
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      (2, 41, 42, ST_GeomFromText('LINESTRING(-105.236343 39.946348, -105.236343 39.946448)', 4326), 0.011, 0, 0, 'Test Trail 2', 'test-trail-2', NULL)
    `);
    
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      (42, 1, 0, 1, 0, ST_GeomFromText('POINT(-105.236343 39.946448)', 4326))
    `);
    
    const toleranceDegrees = 0.00018; // ~20 meters
    const toleranceMeters = toleranceDegrees * 111320;
    
    const gapDetectionResult = await pgClient.query(`
      WITH endpoint_pairs AS (
        SELECT 
          v1.id as node1_id,
          v2.id as node2_id,
          ST_Distance(v1.the_geom, v2.the_geom) * 111320 as distance_meters
        FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr v1
        CROSS JOIN ${TEST_SCHEMA}.ways_noded_vertices_pgr v2
        WHERE v1.id < v2.id
          AND v1.cnt = 1
          AND v2.cnt >= 2
          AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
      )
      SELECT * FROM endpoint_pairs
      WHERE distance_meters <= $2
    `, [toleranceDegrees, toleranceMeters]);
    
    console.log(`🔍 Gap detection found ${gapDetectionResult.rows.length} pairs (should be 0)`);
    
    // Should not detect any gaps for vertices that are too far apart
    expect(gapDetectionResult.rows.length).toBe(0);
    
    console.log('✅ No gap detection test passed!');
  });

  test('should not detect gap when vertices are already connected', async () => {
    console.log('🧪 Testing gap detection with already connected vertices...');
    
    // Insert vertices that are close together
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      -- Vertex 50: Endpoint (degree 1) at (-105.236343, 39.946148)
      (50, 1, 0, 0, 1, ST_GeomFromText('POINT(-105.236343 39.946148)', 4326)),
      -- Vertex 51: Connector (degree 2) at (-105.236343, 39.946158) - 1m away
      (51, 2, 0, 1, 1, ST_GeomFromText('POINT(-105.236343 39.946158)', 4326))
    `);
    
    // Insert an edge that already connects them
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      (3, 50, 51, ST_GeomFromText('LINESTRING(-105.236343 39.946148, -105.236343 39.946158)', 4326), 0.001, 0, 0, 'Existing Connection', 'existing-connection', NULL)
    `);
    
    // Insert another edge connected to vertex 51
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, old_id) VALUES
      (4, 51, 52, ST_GeomFromText('LINESTRING(-105.236343 39.946158, -105.236343 39.946258)', 4326), 0.011, 0, 0, 'Test Trail 3', 'test-trail-3', NULL)
    `);
    
    await pgClient.query(`
      INSERT INTO ${TEST_SCHEMA}.ways_noded_vertices_pgr (id, cnt, chk, ein, eout, the_geom) VALUES
      (52, 1, 0, 1, 0, ST_GeomFromText('POINT(-105.236343 39.946258)', 4326))
    `);
    
    const toleranceDegrees = 0.00018; // ~20 meters
    
    const gapDetectionResult = await pgClient.query(`
      WITH endpoint_pairs AS (
        SELECT 
          v1.id as node1_id,
          v2.id as node2_id,
          ST_Distance(v1.the_geom, v2.the_geom) * 111320 as distance_meters
        FROM ${TEST_SCHEMA}.ways_noded_vertices_pgr v1
        CROSS JOIN ${TEST_SCHEMA}.ways_noded_vertices_pgr v2
        WHERE v1.id < v2.id
          AND v1.cnt = 1
          AND v2.cnt >= 2
          AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
          AND NOT EXISTS (
            SELECT 1 FROM ${TEST_SCHEMA}.ways_noded e 
            WHERE (e.source = v1.id AND e.target = v2.id) 
               OR (e.source = v2.id AND e.target = v1.id)
          )
      )
      SELECT * FROM endpoint_pairs
    `, [toleranceDegrees]);
    
    console.log(`🔍 Gap detection found ${gapDetectionResult.rows.length} pairs (should be 0 since already connected)`);
    
    // Should not detect any gaps for vertices that are already connected
    expect(gapDetectionResult.rows.length).toBe(0);
    
    console.log('✅ Already connected test passed!');
  });
});
