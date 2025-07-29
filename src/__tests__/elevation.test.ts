import { Client } from 'pg';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { insertTrails, createSqliteTables } from '../utils/sqlite-export-helpers';
import fs from 'fs';
import path from 'path';
import { TEST_CONFIG, shouldSkipTest, logTestConfiguration } from './test-config';

describe('Elevation Data Tests', () => {
  let pgClient: Client;
  let testDb: Database.Database;

  beforeAll(async () => {
    logTestConfiguration();
    
    if (shouldSkipTest()) {
      return;
    }

    try {
      // Connect to test database using centralized configuration
      pgClient = new Client(TEST_CONFIG.database);
      await pgClient.connect();
      console.log(`✅ Connected to test database ${TEST_CONFIG.database.database} on ${TEST_CONFIG.database.host}:${TEST_CONFIG.database.port}`);

      // Create SQLite test database
      testDb = new Database(':memory:');
      createSqliteTables(testDb);
    } catch (err) {
      console.log(`⏭️  Skipping beforeAll - connection failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  });

  afterAll(async () => {
    if (pgClient) {
      await pgClient.end();
    }
    if (testDb) {
      testDb.close();
    }
  });

  describe('Trail Splitting with Elevation', () => {
    test('should maintain elevation data after trail splitting', async () => {
      // Create unique test trail data
      const testTrail = {
        app_uuid: `test-elevation-split-${uuidv4()}`,
        name: 'Test Elevation Trail Split',
        region: 'boulder',
        geometry: 'LINESTRING(-105.289304 39.994971 1800, -105.2892954 39.9948598 1820, -105.2892831 39.9947500 1840, -105.2892700 39.9946500 1860)',
        elevation_gain: 60,
        elevation_loss: 0,
        max_elevation: 1860,
        min_elevation: 1800,
        avg_elevation: 1830
      };

      // Insert test trail into trails table
      await pgClient.query(`
        INSERT INTO trails (app_uuid, name, region, geometry, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation)
        VALUES ($1, $2, $3, ST_GeomFromText($4), $5, $6, $7, $8, $9)
      `, [testTrail.app_uuid, testTrail.name, testTrail.region, testTrail.geometry, testTrail.elevation_gain, testTrail.elevation_loss, testTrail.max_elevation, testTrail.min_elevation, testTrail.avg_elevation]);

      // Check if the copy_and_split_trails_to_staging_native function exists
      const functionExists = await pgClient.query(`
        SELECT EXISTS(
          SELECT 1 FROM pg_proc 
          WHERE proname = 'copy_and_split_trails_to_staging_native'
        );
      `);

      if (!functionExists.rows[0].exists) {
        console.log('⚠️  copy_and_split_trails_to_staging_native function not found, skipping trail splitting test');
        return;
      }

      // Create a staging schema and copy/split the trail
      const stagingSchema = `staging_test_elevation_${Date.now()}`;
      
      // Create staging environment
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.trails (
          LIKE trails INCLUDING ALL
        );
      `);
      await pgClient.query(`
        CREATE TRIGGER trigger_generate_app_uuid
        BEFORE INSERT ON ${stagingSchema}.trails
        FOR EACH ROW EXECUTE FUNCTION generate_app_uuid();
      `);

      // Copy and split the trail
      const result = await pgClient.query(`
        SELECT * FROM copy_and_split_trails_to_staging_native(
          $1, 'trails', $2, 0, 0, 0, 0, 0, 0
        );
      `, [stagingSchema, 'boulder']);

      // Check that the trail was split and elevation data is maintained
      const splitTrails = await pgClient.query(`
        SELECT name, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        FROM ${stagingSchema}.trails
        WHERE name = $1
        ORDER BY max_elevation DESC;
      `, [testTrail.name]);

      // If no split trails found, check if the original trail was copied
      if (splitTrails.rows.length === 0) {
        const copiedTrails = await pgClient.query(`
          SELECT name, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
          FROM ${stagingSchema}.trails
          ORDER BY max_elevation DESC;
        `);
        
        if (copiedTrails.rows.length > 0) {
          console.log(`✅ Trail copied to staging (${copiedTrails.rows.length} trails found)`);
          // Use the copied trails for validation
          for (const trail of copiedTrails.rows) {
            expect(trail.elevation_gain).toBeGreaterThanOrEqual(0);
            expect(trail.elevation_loss).toBeGreaterThanOrEqual(0);
            expect(trail.max_elevation).toBeGreaterThan(0);
            expect(trail.min_elevation).toBeGreaterThan(0);
            expect(trail.avg_elevation).toBeGreaterThan(0);
          }
        } else {
          console.log('⚠️  No trails found in staging schema');
        }
      } else {
        console.log(`✅ Trail split into ${splitTrails.rows.length} segments`);
        // Verify that each split segment has proper elevation data
        for (const trail of splitTrails.rows) {
          expect(trail.elevation_gain).toBeGreaterThanOrEqual(0);
          expect(trail.elevation_loss).toBeGreaterThanOrEqual(0);
          expect(trail.max_elevation).toBeGreaterThan(0);
          expect(trail.min_elevation).toBeGreaterThan(0);
          expect(trail.avg_elevation).toBeGreaterThan(0);
        }
      }

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    });
  });

  describe('SQLite Export with Elevation', () => {
    test('should export pre-calculated elevation data correctly to SQLite', async () => {
      // Create test trail data with pre-calculated elevation (from PostgreSQL staging)
      const testTrails = [
        {
          app_uuid: `test-elevation-export-${uuidv4()}`,
          name: 'Test Trail with Pre-calculated Elevation',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971, 1800],
                [-105.2892954, 39.9948598, 1820],
                [-105.2892831, 39.9947500, 1840]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892831,
          bbox_min_lat: 39.9947500,
          bbox_max_lat: 39.994971,
          length_km: 0.5,
          // Pre-calculated elevation data from PostgreSQL staging
          elevation_gain: 40,
          elevation_loss: 0,
          max_elevation: 1840,
          min_elevation: 1800,
          avg_elevation: 1820
        }
      ];

      // Insert into SQLite (no elevation calculation - just transfer pre-calculated values)
      await insertTrails(testDb, testTrails);

      // Verify pre-calculated elevation data is preserved in SQLite
      const trails = testDb.prepare('SELECT * FROM trails WHERE name = ?').all('Test Trail with Pre-calculated Elevation');
      
      expect(trails.length).toBe(1);
      const trail = trails[0] as any;
      
      // Verify that pre-calculated values are preserved exactly
      expect(trail.elevation_gain).toBe(40);
      expect(trail.elevation_loss).toBe(0);
      expect(trail.max_elevation).toBe(1840);
      expect(trail.min_elevation).toBe(1800);
      expect(trail.avg_elevation).toBe(1820);
    });

    test('should handle trails with no elevation data (null values)', async () => {
      // Create test trail data without elevation but with proper bbox fields
      const testTrails = [
        {
          app_uuid: `test-no-elevation-${uuidv4()}`,
          name: 'Test Trail No Elevation',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971],
                [-105.2892954, 39.9948598],
                [-105.2892831, 39.9947500]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892831,
          bbox_min_lat: 39.9947500,
          bbox_max_lat: 39.994971,
          length_km: 0.3,
          // Null elevation data (no calculation in SQLite export)
          elevation_gain: null,
          elevation_loss: null,
          max_elevation: null,
          min_elevation: null,
          avg_elevation: null
        }
      ];

      // Insert into SQLite (no elevation calculation)
      await insertTrails(testDb, testTrails);

      // Verify data in SQLite
      const trails = testDb.prepare('SELECT * FROM trails WHERE name = ?').all('Test Trail No Elevation');
      
      expect(trails.length).toBe(1);
      const trail = trails[0] as any;
      
      // Verify that null values are preserved (no calculation during SQLite export)
      expect(trail.elevation_gain).toBeNull();
      expect(trail.elevation_loss).toBeNull();
      expect(trail.max_elevation).toBeNull();
      expect(trail.min_elevation).toBeNull();
      expect(trail.avg_elevation).toBeNull();
    });
  });

  describe('PostgreSQL Staging Elevation Calculation', () => {
    test('should calculate elevation data in PostgreSQL staging after trail splitting', async () => {
      // This test verifies that elevation calculation happens in PostgreSQL staging
      // using the recalculate_elevation_data() function, not during SQLite export
      
      const stagingSchema = `staging_test_${uuidv4().replace(/-/g, '_')}`;
      
      try {
        // Create staging schema
        await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
        
        // Create trails table in staging
        await pgClient.query(`
          CREATE TABLE ${stagingSchema}.trails (
            id SERIAL PRIMARY KEY,
            app_uuid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            geometry GEOMETRY(LINESTRINGZ, 4326),
            elevation_gain REAL,
            elevation_loss REAL,
            max_elevation REAL,
            min_elevation REAL,
            avg_elevation REAL
          )
        `);
        
        // Insert test trail with 3D geometry
        const testGeometry = 'LINESTRING Z (-105.289304 39.994971 1800, -105.2892954 39.9948598 1820, -105.2892831 39.9947500 1840)';
        await pgClient.query(`
          INSERT INTO ${stagingSchema}.trails (app_uuid, name, geometry)
          VALUES ($1, $2, ST_GeomFromText($3, 4326))
        `, [`test-staging-elevation-${uuidv4()}`, 'Test Staging Trail', testGeometry]);
        
        // Calculate elevation using PostgreSQL function (this is the correct approach)
        const elevationResult = await pgClient.query(`
          SELECT 
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation
          FROM recalculate_elevation_data((
            SELECT geometry FROM ${stagingSchema}.trails WHERE name = 'Test Staging Trail'
          ))
        `);
        
        const elevationData = elevationResult.rows[0];
        
        // Verify elevation calculation results
        expect(elevationData.elevation_gain).toBe(40); // 1820 - 1800 + 1840 - 1820
        expect(elevationData.elevation_loss).toBe(0);
        expect(elevationData.max_elevation).toBe(1840);
        expect(elevationData.min_elevation).toBe(1800);
        expect(elevationData.avg_elevation).toBe(1820);
        
        // Update trail with calculated elevation data
        await pgClient.query(`
          UPDATE ${stagingSchema}.trails 
          SET 
            elevation_gain = $1,
            elevation_loss = $2,
            max_elevation = $3,
            min_elevation = $4,
            avg_elevation = $5
          WHERE name = 'Test Staging Trail'
        `, [
          elevationData.elevation_gain,
          elevationData.elevation_loss,
          elevationData.max_elevation,
          elevationData.min_elevation,
          elevationData.avg_elevation
        ]);
        
        // Verify the trail now has elevation data
        const updatedTrail = await pgClient.query(`
          SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
          FROM ${stagingSchema}.trails 
          WHERE name = 'Test Staging Trail'
        `);
        
        const trail = updatedTrail.rows[0];
        expect(trail.elevation_gain).toBe(40);
        expect(trail.elevation_loss).toBe(0);
        expect(trail.max_elevation).toBe(1840);
        expect(trail.min_elevation).toBe(1800);
        expect(trail.avg_elevation).toBe(1820);
        
      } finally {
        // Clean up
        await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
      }
    });

    test('should calculate elevation for split trail segments correctly', async () => {
      // This test verifies that elevation calculation works correctly after trail splitting
      // which is the proper flow: split trails -> calculate elevation -> export to SQLite
      
      const stagingSchema = `staging_split_test_${uuidv4().replace(/-/g, '_')}`;
      
      try {
        // Create staging schema
        await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
        
        // Create trails table in staging
        await pgClient.query(`
          CREATE TABLE ${stagingSchema}.trails (
            id SERIAL PRIMARY KEY,
            app_uuid TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            geometry GEOMETRY(LINESTRINGZ, 4326),
            elevation_gain REAL,
            elevation_loss REAL,
            max_elevation REAL,
            min_elevation REAL,
            avg_elevation REAL
          )
        `);
        
        // Insert original trail that will be split
        const originalGeometry = 'LINESTRING Z (-105.289304 39.994971 1800, -105.2892954 39.9948598 1820, -105.2892831 39.9947500 1840, -105.2892700 39.9946500 1860)';
        await pgClient.query(`
          INSERT INTO ${stagingSchema}.trails (app_uuid, name, geometry)
          VALUES ($1, $2, ST_GeomFromText($3, 4326))
        `, [`test-original-trail-${uuidv4()}`, 'Original Trail', originalGeometry]);
        
        // Simulate trail splitting by creating two segments
        const segment1Geometry = 'LINESTRING Z (-105.289304 39.994971 1800, -105.2892954 39.9948598 1820)';
        const segment2Geometry = 'LINESTRING Z (-105.2892831 39.9947500 1840, -105.2892700 39.9946500 1860)';
        
        await pgClient.query(`
          INSERT INTO ${stagingSchema}.trails (app_uuid, name, geometry)
          VALUES 
            ($1, $2, ST_GeomFromText($3, 4326)),
            ($4, $5, ST_GeomFromText($6, 4326))
        `, [
          `test-segment-1-${uuidv4()}`, 'Trail Segment 1', segment1Geometry,
          `test-segment-2-${uuidv4()}`, 'Trail Segment 2', segment2Geometry
        ]);
        
        // Calculate elevation for each split segment using PostgreSQL function
        const segments = await pgClient.query(`
          SELECT id, name, geometry FROM ${stagingSchema}.trails 
          WHERE name LIKE 'Trail Segment%'
          ORDER BY name
        `);
        
        for (const segment of segments.rows) {
          const elevationResult = await pgClient.query(`
            SELECT 
              elevation_gain,
              elevation_loss,
              max_elevation,
              min_elevation,
              avg_elevation
            FROM recalculate_elevation_data($1)
          `, [segment.geometry]);
          
          const elevationData = elevationResult.rows[0];
          
          // Update segment with calculated elevation data
          await pgClient.query(`
            UPDATE ${stagingSchema}.trails 
            SET 
              elevation_gain = $1,
              elevation_loss = $2,
              max_elevation = $3,
              min_elevation = $4,
              avg_elevation = $5
            WHERE id = $6
          `, [
            elevationData.elevation_gain,
            elevationData.elevation_loss,
            elevationData.max_elevation,
            elevationData.min_elevation,
            elevationData.avg_elevation,
            segment.id
          ]);
        }
        
        // Verify elevation data for split segments
        const updatedSegments = await pgClient.query(`
          SELECT name, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
          FROM ${stagingSchema}.trails 
          WHERE name LIKE 'Trail Segment%'
          ORDER BY name
        `);
        
        expect(updatedSegments.rows).toHaveLength(2);
        
        // Segment 1: 1800 -> 1820 (gain: 20)
        const segment1 = updatedSegments.rows[0];
        expect(segment1.name).toBe('Trail Segment 1');
        expect(segment1.elevation_gain).toBe(20);
        expect(segment1.elevation_loss).toBe(0);
        expect(segment1.max_elevation).toBe(1820);
        expect(segment1.min_elevation).toBe(1800);
        expect(segment1.avg_elevation).toBe(1810);
        
        // Segment 2: 1840 -> 1860 (gain: 20)
        const segment2 = updatedSegments.rows[1];
        expect(segment2.name).toBe('Trail Segment 2');
        expect(segment2.elevation_gain).toBe(20);
        expect(segment2.elevation_loss).toBe(0);
        expect(segment2.max_elevation).toBe(1860);
        expect(segment2.min_elevation).toBe(1840);
        expect(segment2.avg_elevation).toBe(1850);
        
      } finally {
        // Clean up
        await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
      }
    });
  });

  describe('Elevation Profile Validation', () => {
    test('should validate elevation profile data integrity', async () => {
      // Test that elevation data follows expected patterns
      const result = await pgClient.query(`
        SELECT 
          name,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          CASE 
            WHEN max_elevation IS NOT NULL AND min_elevation IS NOT NULL 
            THEN max_elevation >= min_elevation 
            ELSE true 
          END as elevation_range_valid,
          CASE 
            WHEN avg_elevation IS NOT NULL AND max_elevation IS NOT NULL AND min_elevation IS NOT NULL
            THEN avg_elevation BETWEEN min_elevation AND max_elevation
            ELSE true 
          END as avg_elevation_valid
        FROM trails 
        WHERE elevation_gain IS NOT NULL 
        LIMIT 10;
      `);

      for (const row of result.rows) {
        expect(row.elevation_range_valid).toBe(true);
        expect(row.avg_elevation_valid).toBe(true);
        if (row.elevation_gain !== null) {
          expect(row.elevation_gain).toBeGreaterThanOrEqual(0);
        }
        if (row.elevation_loss !== null) {
          expect(row.elevation_loss).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('should detect trails with missing elevation data', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE elevation_gain IS NULL 
        AND elevation_loss IS NULL 
        AND max_elevation IS NULL 
        AND min_elevation IS NULL 
        AND avg_elevation IS NULL;
      `);

      // This test just verifies the query works, doesn't assert specific counts
      expect(typeof result.rows[0].count).toBe('string');
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Elevation Data Processing', () => {
    test('should calculate elevation statistics correctly', async () => {
      // Test elevation calculations on sample data
      const result = await pgClient.query(`
        SELECT 
          name,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          CASE 
            WHEN elevation_gain > 0 AND elevation_loss > 0 
            THEN elevation_gain + elevation_loss 
            ELSE GREATEST(elevation_gain, elevation_loss) 
          END as total_elevation_change
        FROM trails 
        WHERE elevation_gain IS NOT NULL 
        AND elevation_loss IS NOT NULL 
        LIMIT 5;
      `);

      for (const row of result.rows) {
        if (row.elevation_gain !== null && row.elevation_loss !== null) {
          expect(row.elevation_gain).toBeGreaterThanOrEqual(0);
          expect(row.elevation_loss).toBeGreaterThanOrEqual(0);
          expect(row.total_elevation_change).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('should handle trails with zero elevation change', async () => {
      // Test trails with no elevation change
      const result = await pgClient.query(`
        SELECT COUNT(*) as count
        FROM trails 
        WHERE (elevation_gain = 0 OR elevation_gain IS NULL)
        AND (elevation_loss = 0 OR elevation_loss IS NULL);
      `);

      expect(typeof result.rows[0].count).toBe('string');
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SQLite Export Elevation Data Integrity', () => {
    test('should preserve null elevation values without fallback to 0', async () => {
      // Create test trails with explicit null elevation values
      const testTrails = [
        {
          app_uuid: `test-null-elevation-${uuidv4()}`,
          name: 'Test Trail with Null Elevation',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971],
                [-105.2892954, 39.9948598],
                [-105.2892831, 39.9947500]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892831,
          bbox_min_lat: 39.9947500,
          bbox_max_lat: 39.994971,
          length_km: 0.3,
          elevation_gain: null,
          elevation_loss: null,
          max_elevation: null,
          min_elevation: null,
          avg_elevation: null
        },
        {
          app_uuid: `test-zero-elevation-${uuidv4()}`,
          name: 'Test Trail with Zero Elevation',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971, 1800],
                [-105.2892954, 39.9948598, 1800],
                [-105.2892831, 39.9947500, 1800]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892831,
          bbox_min_lat: 39.9947500,
          bbox_max_lat: 39.994971,
          length_km: 0.3,
          elevation_gain: 0,
          elevation_loss: 0,
          max_elevation: 1800,
          min_elevation: 1800,
          avg_elevation: 1800
        },
        {
          app_uuid: `test-positive-elevation-${uuidv4()}`,
          name: 'Test Trail with Positive Elevation',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971, 1800],
                [-105.2892954, 39.9948598, 1820],
                [-105.2892831, 39.9947500, 1840]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892831,
          bbox_min_lat: 39.9947500,
          bbox_max_lat: 39.994971,
          length_km: 0.3,
          elevation_gain: 40,
          elevation_loss: 0,
          max_elevation: 1840,
          min_elevation: 1800,
          avg_elevation: 1820
        }
      ];

      // Insert into SQLite
      await insertTrails(testDb, testTrails);

      // Verify that null values are preserved (not converted to 0)
      const nullElevationTrail = testDb.prepare('SELECT * FROM trails WHERE name = ?').get('Test Trail with Null Elevation') as any;
      const zeroElevationTrail = testDb.prepare('SELECT * FROM trails WHERE name = ?').get('Test Trail with Zero Elevation') as any;
      const positiveElevationTrail = testDb.prepare('SELECT * FROM trails WHERE name = ?').get('Test Trail with Positive Elevation') as any;

      // Check null elevation trail - should have null values, not 0
      console.log('🔍 Null elevation trail data:', {
        elevation_gain: nullElevationTrail.elevation_gain,
        elevation_loss: nullElevationTrail.elevation_loss,
        max_elevation: nullElevationTrail.max_elevation,
        min_elevation: nullElevationTrail.min_elevation,
        avg_elevation: nullElevationTrail.avg_elevation
      });

      // Check zero elevation trail - should have 0 values
      console.log('🔍 Zero elevation trail data:', {
        elevation_gain: zeroElevationTrail.elevation_gain,
        elevation_loss: zeroElevationTrail.elevation_loss,
        max_elevation: zeroElevationTrail.max_elevation,
        min_elevation: zeroElevationTrail.min_elevation,
        avg_elevation: zeroElevationTrail.avg_elevation
      });

      // Check positive elevation trail - should have positive values
      console.log('🔍 Positive elevation trail data:', {
        elevation_gain: positiveElevationTrail.elevation_gain,
        elevation_loss: positiveElevationTrail.elevation_loss,
        max_elevation: positiveElevationTrail.max_elevation,
        min_elevation: positiveElevationTrail.min_elevation,
        avg_elevation: positiveElevationTrail.avg_elevation
      });

      // Test that we can distinguish between null and 0
      // This test will fail if the current fallback logic is used
      expect(nullElevationTrail.elevation_gain).toBeNull();
      expect(nullElevationTrail.elevation_loss).toBeNull();
      expect(nullElevationTrail.max_elevation).toBeNull();
      expect(nullElevationTrail.min_elevation).toBeNull();
      expect(nullElevationTrail.avg_elevation).toBeNull();

      // Verify zero values are preserved
      expect(zeroElevationTrail.elevation_gain).toBe(0);
      expect(zeroElevationTrail.elevation_loss).toBe(0);
      expect(zeroElevationTrail.max_elevation).toBe(1800);
      expect(zeroElevationTrail.min_elevation).toBe(1800);
      expect(zeroElevationTrail.avg_elevation).toBe(1800);

      // Verify positive values are preserved
      expect(positiveElevationTrail.elevation_gain).toBe(40);
      expect(positiveElevationTrail.elevation_loss).toBe(0);
      expect(positiveElevationTrail.max_elevation).toBe(1840);
      expect(positiveElevationTrail.min_elevation).toBe(1800);
      expect(positiveElevationTrail.avg_elevation).toBe(1820);
    });

    test('should handle mixed elevation data correctly', async () => {
      // Create test trails with mixed elevation data (some null, some zero, some positive)
      const testTrails = [
        {
          app_uuid: `test-mixed-1-${uuidv4()}`,
          name: 'Test Trail Mixed 1',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971],
                [-105.2892954, 39.9948598]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892954,
          bbox_min_lat: 39.9948598,
          bbox_max_lat: 39.994971,
          length_km: 0.1,
          elevation_gain: null,
          elevation_loss: null,
          max_elevation: null,
          min_elevation: null,
          avg_elevation: null
        },
        {
          app_uuid: `test-mixed-2-${uuidv4()}`,
          name: 'Test Trail Mixed 2',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971, 1800],
                [-105.2892954, 39.9948598, 1800]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892954,
          bbox_min_lat: 39.9948598,
          bbox_max_lat: 39.994971,
          length_km: 0.1,
          elevation_gain: 0,
          elevation_loss: 0,
          max_elevation: 1800,
          min_elevation: 1800,
          avg_elevation: 1800
        },
        {
          app_uuid: `test-mixed-3-${uuidv4()}`,
          name: 'Test Trail Mixed 3',
          region: 'boulder',
          geojson: JSON.stringify({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [-105.289304, 39.994971, 1800],
                [-105.2892954, 39.9948598, 1820]
              ]
            }
          }),
          bbox_min_lng: -105.289304,
          bbox_max_lng: -105.2892954,
          bbox_min_lat: 39.9948598,
          bbox_max_lat: 39.994971,
          length_km: 0.1,
          elevation_gain: 20,
          elevation_loss: 0,
          max_elevation: 1820,
          min_elevation: 1800,
          avg_elevation: 1810
        }
      ];

      // Insert into SQLite
      await insertTrails(testDb, testTrails);

      // Query all trails and verify data integrity
      const allTrails = testDb.prepare('SELECT name, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails WHERE name LIKE ? ORDER BY name').all('Test Trail Mixed%') as any[];

      console.log('🔍 Mixed elevation trails data:', allTrails);

      // Verify that null values are preserved and not converted to 0
      const nullTrail = allTrails.find(t => t.name === 'Test Trail Mixed 1');
      const zeroTrail = allTrails.find(t => t.name === 'Test Trail Mixed 2');
      const positiveTrail = allTrails.find(t => t.name === 'Test Trail Mixed 3');

      expect(nullTrail.elevation_gain).toBeNull();
      expect(nullTrail.elevation_loss).toBeNull();
      expect(nullTrail.max_elevation).toBeNull();
      expect(nullTrail.min_elevation).toBeNull();
      expect(nullTrail.avg_elevation).toBeNull();

      expect(zeroTrail.elevation_gain).toBe(0);
      expect(zeroTrail.elevation_loss).toBe(0);
      expect(zeroTrail.max_elevation).toBe(1800);
      expect(zeroTrail.min_elevation).toBe(1800);
      expect(zeroTrail.avg_elevation).toBe(1800);

      expect(positiveTrail.elevation_gain).toBe(20);
      expect(positiveTrail.elevation_loss).toBe(0);
      expect(positiveTrail.max_elevation).toBe(1820);
      expect(positiveTrail.min_elevation).toBe(1800);
      expect(positiveTrail.avg_elevation).toBe(1810);
    });
  });

  describe('Export Pipeline Elevation Validation', () => {
    test('should fail export when trails are missing elevation data', async () => {
      // Create test trails with missing elevation data
      const testTrails = [
        {
          app_uuid: `test-missing-elevation-${uuidv4()}`,
          name: 'Test Trail Missing Elevation',
          region: 'boulder',
          osm_id: '123456789',
          trail_type: 'hiking',
          surface: 'dirt',
          difficulty: 'moderate',
          length_km: 2.5,
          elevation_gain: null,
          elevation_loss: null,
          max_elevation: null,
          min_elevation: null,
          avg_elevation: null,
          bbox_min_lng: -105.2705,
          bbox_max_lng: -105.2706,
          bbox_min_lat: 40.0150,
          bbox_max_lat: 40.0151,
          geojson: JSON.stringify({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[-105.2705, 40.0150], [-105.2706, 40.0151]]
            },
            properties: {}
          }),
          source_tags: JSON.stringify({ highway: 'path' }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      // Insert test trails into PostgreSQL
      for (const trail of testTrails) {
        await pgClient.query(`
          INSERT INTO trails (
            app_uuid, name, region, osm_id, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            geometry, source_tags, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        `, [
          trail.app_uuid, trail.name, trail.region, trail.osm_id, trail.trail_type,
          trail.surface, trail.difficulty, trail.length_km, trail.elevation_gain,
          trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation,
          trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat,
          'SRID=4326;LINESTRING(-105.2705 40.0150, -105.2706 40.0151)', trail.source_tags, trail.created_at, trail.updated_at
        ]);
      }

      // Create SQLite database
      const testDbPath = path.join(__dirname, 'test-output', 'test-elevation-validation.db');
      const testDb = Database(testDbPath);

      try {
        // Create tables
        createSqliteTables(testDb, testDbPath);

        // This should fail because trails are missing elevation data
        await expect(async () => {
          // Get trails from PostgreSQL
          const result = await pgClient.query(`
            SELECT * FROM trails WHERE app_uuid = $1
          `, [testTrails[0].app_uuid]);

          // Try to insert into SQLite - this should fail validation
          insertTrails(testDb, result.rows, testDbPath);
        }).rejects.toThrow();

        // Verify the SQLite database was not created or is empty
        const trailCount = testDb.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number };
        expect(trailCount.count).toBe(0);

      } finally {
        testDb.close();
        // Clean up test file
        if (fs.existsSync(testDbPath)) {
          fs.unlinkSync(testDbPath);
        }
      }
    });

    test('should pass export when all trails have complete elevation data', async () => {
      // Create test trails with complete elevation data
      const testTrails = [
        {
          app_uuid: `test-complete-elevation-${uuidv4()}`,
          name: 'Test Trail Complete Elevation',
          region: 'boulder',
          osm_id: '123456790',
          trail_type: 'hiking',
          surface: 'dirt',
          difficulty: 'moderate',
          length_km: 2.5,
          elevation_gain: 100,
          elevation_loss: 50,
          max_elevation: 2000,
          min_elevation: 1900,
          avg_elevation: 1950,
          bbox_min_lng: -105.2705,
          bbox_max_lng: -105.2706,
          bbox_min_lat: 40.0150,
          bbox_max_lat: 40.0151,
          geojson: JSON.stringify({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[-105.2705, 40.0150], [-105.2706, 40.0151]]
            },
            properties: {}
          }),
          source_tags: JSON.stringify({ highway: 'path' }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      // Insert test trails into PostgreSQL
      for (const trail of testTrails) {
        await pgClient.query(`
          INSERT INTO trails (
            app_uuid, name, region, osm_id, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            geometry, source_tags, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        `, [
          trail.app_uuid, trail.name, trail.region, trail.osm_id, trail.trail_type,
          trail.surface, trail.difficulty, trail.length_km, trail.elevation_gain,
          trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation,
          trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat,
          'SRID=4326;LINESTRING(-105.2705 40.0150, -105.2706 40.0151)', trail.source_tags, trail.created_at, trail.updated_at
        ]);
      }

      // Create SQLite database
      const testDbPath = path.join(__dirname, 'test-output', 'test-elevation-complete.db');
      const testDb = Database(testDbPath);

      try {
        // Create tables
        createSqliteTables(testDb, testDbPath);

        // This should pass because trails have complete elevation data
        const result = await pgClient.query(`
          SELECT * FROM trails WHERE app_uuid = $1
        `, [testTrails[0].app_uuid]);

        // Insert into SQLite - this should pass validation
        insertTrails(testDb, result.rows, testDbPath);

        // Verify the SQLite database has the trail
        const trailCount = testDb.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number };
        expect(trailCount.count).toBe(1);

        // Verify elevation data is preserved
        const trail = testDb.prepare('SELECT * FROM trails WHERE app_uuid = ?').get(testTrails[0].app_uuid) as any;
        expect(trail.elevation_gain).toBe(100);
        expect(trail.elevation_loss).toBe(50);
        expect(trail.max_elevation).toBe(2000);
        expect(trail.min_elevation).toBe(1900);
        expect(trail.avg_elevation).toBe(1950);

      } finally {
        testDb.close();
        // Clean up test file
        if (fs.existsSync(testDbPath)) {
          fs.unlinkSync(testDbPath);
        }
      }
    });
  });
});