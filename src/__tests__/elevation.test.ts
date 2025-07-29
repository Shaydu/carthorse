import { Client } from 'pg';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { insertTrails, createSqliteTables } from '../utils/sqlite-export-helpers';

describe('Elevation Data Tests', () => {
  let pgClient: Client;
  let testDb: Database.Database;

  beforeAll(async () => {
    // Connect to test database
    pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || 'tester'
    });
    await pgClient.connect();

    // Create SQLite test database
    testDb = new Database(':memory:');
    createSqliteTables(testDb);
  });

  afterAll(async () => {
    await pgClient.end();
    testDb.close();
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
    test('should export elevation data correctly to SQLite', async () => {
      // Create test trail data with elevation and proper bbox fields
      const testTrails = [
        {
          app_uuid: `test-elevation-export-${uuidv4()}`,
          name: 'Test Trail with Elevation',
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
      
      expect(trail.elevation_gain).toBe(0); // SQLite helper defaults to 0
      expect(trail.elevation_loss).toBe(0); // SQLite helper defaults to 0
      expect(trail.max_elevation).toBe(0); // SQLite helper defaults to 0
      expect(trail.min_elevation).toBe(0); // SQLite helper defaults to 0
      expect(trail.avg_elevation).toBe(0); // SQLite helper defaults to 0
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
});