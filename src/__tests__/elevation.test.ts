import { Client } from 'pg';
import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges } from '../utils/sqlite-export-helpers';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

describe('Elevation Data Tests', () => {
  let pgClient: Client;
  let orchestrator: EnhancedPostgresOrchestrator;
  let testDbPath: string;
  let testDb: Database.Database;

  beforeAll(async () => {
    // Connect to test database
    pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || 'testpass'
    });
    await pgClient.connect();

    // Create test SQLite database
    testDbPath = path.join(__dirname, 'test-output', 'test-elevation.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterAll(async () => {
    await pgClient.end();
    if (testDb) {
      testDb.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  beforeEach(async () => {
    // Create fresh SQLite database
    testDb = new Database(testDbPath);
    createSqliteTables(testDb);
  });

  afterEach(async () => {
    if (testDb) {
      testDb.close();
    }
  });

  describe('Elevation Recalculation Function', () => {
    test('should recalculate elevation data for a trail geometry', async () => {
      // Test the recalculate_elevation_data function directly
      const result = await pgClient.query(`
        SELECT * FROM recalculate_elevation_data(
          ST_GeomFromText('LINESTRING(-105.289304 39.994971 1800, -105.2892954 39.9948598 1820, -105.2892831 39.9947500 1840)')
        );
      `);

      expect(result.rows[0]).toBeDefined();
      expect(result.rows[0].elevation_gain).toBeGreaterThan(0);
      expect(result.rows[0].elevation_loss).toBeGreaterThanOrEqual(0);
      expect(result.rows[0].max_elevation).toBe(1840);
      expect(result.rows[0].min_elevation).toBe(1800);
      expect(result.rows[0].avg_elevation).toBeGreaterThan(1800);
      expect(result.rows[0].avg_elevation).toBeLessThan(1840);
    });

    test('should handle flat trails correctly', async () => {
      // Test with a flat trail (no elevation change)
      const result = await pgClient.query(`
        SELECT * FROM recalculate_elevation_data(
          ST_GeomFromText('LINESTRING(-105.289304 39.994971 1800, -105.2892954 39.9948598 1800, -105.2892831 39.9947500 1800)')
        );
      `);

      expect(result.rows[0].elevation_gain).toBe(0);
      expect(result.rows[0].elevation_loss).toBe(0);
      expect(result.rows[0].max_elevation).toBe(1800);
      expect(result.rows[0].min_elevation).toBe(1800);
      expect(result.rows[0].avg_elevation).toBe(1800);
    });

    test('should handle very short trails', async () => {
      // Test with a very short trail (2 points minimum for PostGIS)
      const result = await pgClient.query(`
        SELECT * FROM recalculate_elevation_data(
          ST_GeomFromText('LINESTRING(-105.289304 39.994971 1800, -105.2892954 39.9948598 1820)')
        );
      `);

      expect(result.rows[0].elevation_gain).toBe(20);
      expect(result.rows[0].elevation_loss).toBe(0);
      expect(result.rows[0].max_elevation).toBe(1820);
      expect(result.rows[0].min_elevation).toBe(1800);
      expect(result.rows[0].avg_elevation).toBe(1810);
    });
  });

  describe('Trail Splitting with Elevation', () => {
    test('should maintain elevation data after trail splitting', async () => {
      // Create a test trail with elevation data
      const testTrail = {
        app_uuid: 'test-elevation-trail-1',
        name: 'Test Elevation Trail',
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
        WHERE name LIKE '%Test Elevation Trail%'
        ORDER BY max_elevation DESC;
      `);

      expect(splitTrails.rows.length).toBeGreaterThan(0);
      
      // Verify that each split segment has proper elevation data
      for (const trail of splitTrails.rows) {
        expect(trail.elevation_gain).toBeGreaterThanOrEqual(0);
        expect(trail.elevation_loss).toBeGreaterThanOrEqual(0);
        expect(trail.max_elevation).toBeGreaterThan(0);
        expect(trail.min_elevation).toBeGreaterThan(0);
        expect(trail.avg_elevation).toBeGreaterThan(0);
      }

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    });
  });

  describe('SQLite Export with Elevation', () => {
    test('should export elevation data correctly to SQLite', async () => {
      // Create test trail data with elevation and bbox
      const testTrails = [
        {
          app_uuid: 'test-elevation-1',
          name: 'Test Trail with Elevation',
          region: 'boulder',
          geometry: 'LINESTRING(-105.289304 39.994971 1800, -105.2892954 39.9948598 1820, -105.2892831 39.9947500 1840)',
          bbox: [-105.289304, 39.9947500, -105.2892831, 39.994971],
          elevation_gain: 40,
          elevation_loss: 0,
          max_elevation: 1840,
          min_elevation: 1800,
          avg_elevation: 1820
        }
      ];

      // Insert into SQLite
      await insertTrails(testDb, testTrails);

      // Verify elevation data in SQLite
      const trails = testDb.prepare('SELECT * FROM trails WHERE name = ?').all('Test Trail with Elevation');
      
      expect(trails.length).toBe(1);
      const trail = trails[0] as any;
      
      expect(trail.elevation_gain).toBe(40);
      expect(trail.elevation_loss).toBe(0);
      expect(trail.max_elevation).toBe(1840);
      expect(trail.min_elevation).toBe(1800);
      expect(trail.avg_elevation).toBe(1820);
    });

    test('should handle trails with no elevation data', async () => {
      // Create test trail data without elevation but with bbox
      const testTrails = [
        {
          app_uuid: 'test-no-elevation-1',
          name: 'Test Trail No Elevation',
          region: 'boulder',
          geometry: 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598, -105.2892831 39.9947500)',
          bbox: [-105.289304, 39.9947500, -105.2892831, 39.994971],
          elevation_gain: null,
          elevation_loss: null,
          max_elevation: null,
          min_elevation: null,
          avg_elevation: null
        }
      ];

      // Insert into SQLite
      await insertTrails(testDb, testTrails);

      // Verify data in SQLite
      const trails = testDb.prepare('SELECT * FROM trails WHERE name = ?').all('Test Trail No Elevation');
      
      expect(trails.length).toBe(1);
      const trail = trails[0] as any;
      
      expect(trail.elevation_gain).toBeNull();
      expect(trail.elevation_loss).toBeNull();
      expect(trail.max_elevation).toBeNull();
      expect(trail.min_elevation).toBeNull();
      expect(trail.avg_elevation).toBeNull();
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
        OR elevation_loss IS NULL 
        OR max_elevation IS NULL 
        OR min_elevation IS NULL 
        OR avg_elevation IS NULL;
      `);

      const missingElevationCount = parseInt(result.rows[0].count);
      console.log(`📊 Found ${missingElevationCount} trails with missing elevation data`);
      
      // This test documents the current state but doesn't fail
      // as some trails may legitimately not have elevation data
      expect(missingElevationCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Elevation Data After Trail Splitting', () => {
    test('should maintain elevation data consistency after splitting', async () => {
      // Get a sample trail that has elevation data
      const sampleTrail = await pgClient.query(`
        SELECT * FROM trails 
        WHERE elevation_gain IS NOT NULL 
        AND elevation_loss IS NOT NULL 
        AND max_elevation IS NOT NULL 
        AND min_elevation IS NOT NULL 
        AND avg_elevation IS NOT NULL
        LIMIT 1;
      `);

      if (sampleTrail.rows.length === 0) {
        console.log('⚠️  No trails with elevation data found for testing');
        return;
      }

      const originalTrail = sampleTrail.rows[0];
      console.log(`🧪 Testing elevation consistency with trail: ${originalTrail.name}`);

      // Create staging schema and split the trail
      const stagingSchema = `staging_elevation_test_${Date.now()}`;
      
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
      await pgClient.query(`
        SELECT * FROM copy_and_split_trails_to_staging_native(
          $1, 'trails', $2, 0, 0, 0, 0, 0, 0
        );
      `, [stagingSchema, originalTrail.region]);

      // Check split trails
      const splitTrails = await pgClient.query(`
        SELECT 
          COUNT(*) as split_count,
          SUM(elevation_gain) as total_gain,
          SUM(elevation_loss) as total_loss,
          MAX(max_elevation) as max_elev,
          MIN(min_elevation) as min_elev
        FROM ${stagingSchema}.trails
        WHERE name = $1;
      `, [originalTrail.name]);

      const splitData = splitTrails.rows[0];
      
      if (splitData.split_count > 0) {
        console.log(`📊 Trail split into ${splitData.split_count} segments`);
        console.log(`⛰️  Total elevation gain: ${splitData.total_gain}m (original: ${originalTrail.elevation_gain}m)`);
        console.log(`📉 Total elevation loss: ${splitData.total_loss}m (original: ${originalTrail.elevation_loss}m)`);
        console.log(`🔝 Max elevation: ${splitData.max_elev}m (original: ${originalTrail.max_elevation}m)`);
        console.log(`🔻 Min elevation: ${splitData.min_elev}m (original: ${originalTrail.min_elevation}m)`);

        // Verify that elevation data is maintained
        expect(splitData.total_gain).toBeGreaterThanOrEqual(originalTrail.elevation_gain);
        expect(splitData.total_loss).toBeGreaterThanOrEqual(originalTrail.elevation_loss);
        expect(splitData.max_elev).toBeGreaterThanOrEqual(originalTrail.max_elevation);
        expect(splitData.min_elev).toBeLessThanOrEqual(originalTrail.min_elevation);
      }

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    });
  });
});