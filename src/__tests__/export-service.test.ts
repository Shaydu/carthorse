import { Client } from 'pg';
import Database from 'better-sqlite3';
import { ExportService } from '../utils/export-service';
import { createTestSchema, createTestTrailsTable, createTestRoutingTables, insertTestTrail, cleanupTestSchema, generateTestSchemaName } from '../utils/test-helpers';

describe('ExportService', () => {
  let pgClient: Client;
  let testSchema: string;

  beforeAll(async () => {
    // Connect to test database
    pgClient = new Client({
      host: process.env.TEST_PGHOST || process.env.PGHOST,
      port: process.env.TEST_PGPORT || process.env.PGPORT ? parseInt(process.env.TEST_PGPORT || process.env.PGPORT!) : undefined,
      database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
      password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
    });
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  beforeEach(async () => {
    testSchema = generateTestSchemaName('test_export');
    await createTestSchema(pgClient, testSchema);
    await createTestTrailsTable(pgClient, testSchema);
  });

  afterEach(async () => {
    await cleanupTestSchema(pgClient, testSchema);
  });

  describe('exportDatabase', () => {
    it('should export trails to SQLite database', async () => {
      // Insert test trail data
      await insertTestTrail(pgClient, testSchema, {
        app_uuid: 'test-trail-1',
        name: 'Test Trail 1',
        region: 'boulder',
        osm_id: '12345',
        osm_type: 'way',
        length_km: 2.5,
        elevation_gain: 100,
        elevation_loss: 50,
        max_elevation: 2000,
        min_elevation: 1900,
        avg_elevation: 1950,
        bbox_min_lng: -105.3,
        bbox_max_lng: -105.2,
        bbox_min_lat: 40.0,
        bbox_max_lat: 40.1,
        geometry: 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598)'
      });

      const outputPath = 'test-export.db';
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: outputPath,
        maxDbSizeMB: 100,
        validate: true,
        region: 'boulder'
      });

      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Clean up
      if (require('fs').existsSync(outputPath)) {
        require('fs').unlinkSync(outputPath);
      }
    });

    it('should export routing nodes and edges when available', async () => {
      // Insert test trail data
      await insertTestTrail(pgClient, testSchema, {
        app_uuid: 'test-trail-2',
        name: 'Test Trail 2',
        region: 'boulder',
        geometry: 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598)'
      });

      // Create routing tables
      await createTestRoutingTables(pgClient, testSchema);

      const outputPath = 'test-export-routing.db';
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: outputPath,
        maxDbSizeMB: 100,
        validate: true,
        region: 'boulder'
      });

      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);

      // Clean up
      if (require('fs').existsSync(outputPath)) {
        require('fs').unlinkSync(outputPath);
      }
    });

    it('should fail when no trails are found', async () => {
      const outputPath = 'test-export-empty.db';
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: outputPath,
        maxDbSizeMB: 100,
        validate: true,
        region: 'boulder'
      });

      try {
        await exportService.exportDatabase(testSchema);
        fail('Expected error for no trails found');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('No trails found to export');
      }

      // Clean up
      if (require('fs').existsSync(outputPath)) {
        require('fs').unlinkSync(outputPath);
      }
    });

    it('should handle null elevation values correctly', async () => {
      // Insert test trail with null elevation data
      await insertTestTrail(pgClient, testSchema, {
        app_uuid: 'test-trail-3',
        name: 'Test Trail 3',
        region: 'boulder',
        osm_id: '12346',
        osm_type: 'way',
        length_km: 1.5,
        elevation_gain: null,
        elevation_loss: null,
        max_elevation: null,
        min_elevation: null,
        avg_elevation: null,
        geometry: 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598)'
      });

      const outputPath = 'test-export-null-elevation.db';
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: outputPath,
        maxDbSizeMB: 100,
        validate: true,
        region: 'boulder'
      });

      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);

      // Clean up
      if (require('fs').existsSync(outputPath)) {
        require('fs').unlinkSync(outputPath);
      }
    });
  });

  describe('exportStagingData', () => {
    it('should export staging data to SQLite database', async () => {
      // Insert test trail data
      await insertTestTrail(pgClient, testSchema, {
        app_uuid: 'test-staging-1',
        name: 'Test Staging Trail 1',
        region: 'boulder',
        osm_id: '12347',
        osm_type: 'way',
        length_km: 3.0,
        elevation_gain: 150,
        elevation_loss: 75,
        max_elevation: 2100,
        min_elevation: 1950,
        avg_elevation: 2025,
        geometry: 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598)'
      });

      const outputPath = 'test-staging-export.db';
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: outputPath,
        maxDbSizeMB: 100,
        validate: true,
        region: 'boulder'
      });

      const result = await exportService.exportStagingData(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);

      // Clean up
      if (require('fs').existsSync(outputPath)) {
        require('fs').unlinkSync(outputPath);
      }
    });

    it('should handle missing routing tables gracefully', async () => {
      // Insert test trail data only (no routing tables)
      await insertTestTrail(pgClient, testSchema, {
        app_uuid: 'test-staging-2',
        name: 'Test Staging Trail 2',
        region: 'boulder',
        geometry: 'LINESTRING(-105.289304 39.994971, -105.2892954 39.9948598)'
      });

      const outputPath = 'test-staging-no-routing.db';
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: outputPath,
        maxDbSizeMB: 100,
        validate: true,
        region: 'boulder'
      });

      const result = await exportService.exportStagingData(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);

      // Clean up
      if (require('fs').existsSync(outputPath)) {
        require('fs').unlinkSync(outputPath);
      }
    });
  });
});