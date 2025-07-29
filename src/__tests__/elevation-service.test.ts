import { Client } from 'pg';
import { ElevationService } from '../utils/elevation-service';
import { getTestDbConfig } from '../database/connection';

describe('ElevationService', () => {
  let pgClient: Client;
  let elevationService: ElevationService;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
    elevationService = new ElevationService(pgClient);
  });

  afterAll(async () => {
    await pgClient.end();
  });

  describe('validateElevationData', () => {
    it('should validate existing test data', async () => {
      // Test with existing test database data
      const validation = await elevationService.validateElevationData('public');

      expect(validation).toBeDefined();
      expect(typeof validation.isValid).toBe('boolean');
      expect(Array.isArray(validation.errors)).toBe(true);
      expect(typeof validation.nullElevationCount).toBe('number');
      expect(typeof validation.zeroElevationCount).toBe('number');
      expect(typeof validation.invalidRangeCount).toBe('number');
    });

    it('should handle null elevation data correctly', async () => {
      // Create a temporary test schema for this specific test
      const testSchema = `test_elevation_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Copy the trails table structure
      await pgClient.query(`
        CREATE TABLE ${testSchema}.trails AS 
        SELECT * FROM public.trails WHERE 1=0
      `);

      // Insert test trail with null elevation data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-null', 'Test Trail Null', 'test-region', NULL, NULL, NULL, NULL, NULL
        )
      `);

      const validation = await elevationService.validateElevationData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have null elevation data');
      expect(validation.nullElevationCount).toBe(1);

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    });

    it('should handle zero elevation data correctly', async () => {
      // Create a temporary test schema for this specific test
      const testSchema = `test_elevation_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Copy the trails table structure
      await pgClient.query(`
        CREATE TABLE ${testSchema}.trails AS 
        SELECT * FROM public.trails WHERE 1=0
      `);

      // Insert test trail with all zero elevation data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-zero', 'Test Trail Zero', 'test-region', 0, 0, 0, 0, 0
        )
      `);

      const validation = await elevationService.validateElevationData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have zero elevation data');
      expect(validation.zeroElevationCount).toBe(1);

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    });
  });

  describe('getElevationStats', () => {
    it('should return elevation statistics for existing data', async () => {
      const stats = await elevationService.getElevationStats('public');

      expect(stats).toBeDefined();
      expect(typeof stats.total_trails).toBe('number');
      expect(typeof stats.trails_with_elevation).toBe('number');
      expect(typeof stats.trails_missing_elevation).toBe('number');
      expect(stats.total_trails).toBeGreaterThan(0);
      expect(stats.trails_with_elevation + stats.trails_missing_elevation).toBe(stats.total_trails);
    });
  });

  describe('initializeElevationData', () => {
    it('should set elevation fields to null in test schema', async () => {
      // Create a temporary test schema
      const testSchema = `test_elevation_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Copy the trails table structure
      await pgClient.query(`
        CREATE TABLE ${testSchema}.trails AS 
        SELECT * FROM public.trails WHERE 1=0
      `);

      // Insert test trail with existing elevation data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-init', 'Test Trail Init', 'test-region', 100, 50, 2000, 1800, 1900
        )
      `);

      // Initialize elevation data
      await elevationService.initializeElevationData(testSchema);

      // Verify all elevation fields are now null
      const result = await pgClient.query(`
        SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        FROM ${testSchema}.trails WHERE app_uuid = 'test-uuid-init'
      `);

      expect(result.rows[0].elevation_gain).toBeNull();
      expect(result.rows[0].elevation_loss).toBeNull();
      expect(result.rows[0].max_elevation).toBeNull();
      expect(result.rows[0].min_elevation).toBeNull();
      expect(result.rows[0].avg_elevation).toBeNull();

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    });
  });
});