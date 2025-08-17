import { Client } from 'pg';
import { CleanupService } from '../services/CleanupService';
import { getTestDbConfig } from '../database/connection';
import * as fs from 'fs';
import * as path from 'path';

describe('CleanupService', () => {
  let pgClient: Client;
  let cleanupService: CleanupService;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
    cleanupService = new CleanupService(pgClient);
  });

  afterAll(async () => {
    await pgClient.end();
  });

  beforeEach(async () => {
    // Create test staging schemas for cleanup tests
    const testSchemas = [
      'staging_test_region_1',
      'staging_test_region_2', 
      'staging_test_region_3',
      'staging_other_region_1'
    ];

    for (const schema of testSchemas) {
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.test_table (
          id SERIAL PRIMARY KEY,
          name TEXT
        )
      `);
    }
  });

  afterEach(async () => {
    // Clean up any remaining test schemas
    const schemas = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%' OR schema_name LIKE 'test_cleanup_%'
    `);
    
    for (const schema of schemas.rows) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    }
  });

  describe('cleanupOldStagingSchemas', () => {
    it('should keep only the most recent staging schemas', async () => {
      // Create additional staging schemas with timestamps
      const timestamp = Date.now();
      const oldSchemas = [
        `staging_test_region_${timestamp - 1000}`,
        `staging_test_region_${timestamp - 2000}`,
        `staging_test_region_${timestamp - 3000}`
      ];

      for (const schema of oldSchemas) {
        await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await pgClient.query(`
          CREATE TABLE IF NOT EXISTS ${schema}.test_table (
            id SERIAL PRIMARY KEY,
            name TEXT
          )
        `);
      }

      // Perform cleanup, keeping only 2 most recent
      const cleanedCount = await cleanupService['cleanupOldStagingSchemas'](2);

      // Verify old schemas were cleaned up
      const remainingSchemas = await pgClient.query(`
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_test_region_%'
        ORDER BY schema_name DESC
      `);

      expect(cleanedCount).toBeGreaterThan(0);
      expect(remainingSchemas.rows.length).toBeLessThanOrEqual(2);
    });

    it('should not clean up schemas when count is within limit', async () => {
      const cleanedCount = await cleanupService['cleanupOldStagingSchemas'](5);

      expect(cleanedCount).toBe(0);
    });
  });

  describe('cleanupTempFiles', () => {
    it('should clean up old temporary files', async () => {
      // Create test temp directory and files
      const testTempDir = './tmp';
      if (!fs.existsSync(testTempDir)) {
        fs.mkdirSync(testTempDir, { recursive: true });
      }

      // Create old file (older than 24 hours)
      const oldFile = path.join(testTempDir, 'old-test-file.txt');
      const oldTime = new Date();
      oldTime.setHours(oldTime.getHours() - 25);
      
      fs.writeFileSync(oldFile, 'old content');
      fs.utimesSync(oldFile, oldTime, oldTime);

      // Create new file (less than 24 hours old)
      const newFile = path.join(testTempDir, 'new-test-file.txt');
      fs.writeFileSync(newFile, 'new content');

      const cleanedCount = await cleanupService['cleanupTempFiles']();

      // Verify old file was cleaned up
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
      expect(cleanedCount).toBeGreaterThan(0);
    });
  });

  describe('cleanupDatabaseLogs', () => {
    it('should clean up old log files', async () => {
      // Create test log directory and files
      const testLogDir = './logs';
      if (!fs.existsSync(testLogDir)) {
        fs.mkdirSync(testLogDir, { recursive: true });
      }

      // Create old log file (older than 7 days)
      const oldLogFile = path.join(testLogDir, 'old-test.log');
      const oldTime = new Date();
      oldTime.setDate(oldTime.getDate() - 8);
      
      fs.writeFileSync(oldLogFile, 'old log content');
      fs.utimesSync(oldLogFile, oldTime, oldTime);

      // Create new log file (less than 7 days old)
      const newLogFile = path.join(testLogDir, 'new-test.log');
      fs.writeFileSync(newLogFile, 'new log content');

      const cleanedCount = await cleanupService['cleanupDatabaseLogs']();

      // Verify old log file was cleaned up
      expect(fs.existsSync(oldLogFile)).toBe(false);
      expect(fs.existsSync(newLogFile)).toBe(true);
      expect(cleanedCount).toBeGreaterThan(0);
    });
  });

  describe('cleanupOrphanedStagingSchemas', () => {
    it('should clean up orphaned staging schemas', async () => {
      // Create orphaned schema (no tables)
      const orphanedSchema = 'staging_orphaned_test';
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${orphanedSchema}`);

      // Create normal schema with tables
      const normalSchema = 'staging_normal_test';
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${normalSchema}`);
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${normalSchema}.test_table (
          id SERIAL PRIMARY KEY,
          name TEXT
        )
      `);

      await cleanupService['cleanupOrphanedStagingSchemas']();

      // Verify orphaned schema was cleaned up
      const orphanedExists = await pgClient.query(`
        SELECT COUNT(*) as count FROM information_schema.schemata 
        WHERE schema_name = '${orphanedSchema}'
      `);
      expect(parseInt(orphanedExists.rows[0].count)).toBe(0);

      // Verify normal schema still exists
      const normalExists = await pgClient.query(`
        SELECT COUNT(*) as count FROM information_schema.schemata 
        WHERE schema_name = '${normalSchema}'
      `);
      expect(parseInt(normalExists.rows[0].count)).toBe(1);
    });
  });

  describe('cleanupTemporaryTables', () => {
    it('should clean up temporary tables', async () => {
      // Create temporary tables
      const tempTables = [
        'temp_test_table_1',
        'tmp_test_table_2',
        'test_table_temp',
        'test_table_tmp'
      ];

      for (const table of tempTables) {
        await pgClient.query(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id SERIAL PRIMARY KEY,
            name TEXT
          )
        `);
      }

      await cleanupService['cleanupTemporaryTables']();

      // Verify temporary tables were cleaned up
      for (const table of tempTables) {
        const tableExists = await pgClient.query(`
          SELECT COUNT(*) as count FROM information_schema.tables 
          WHERE table_name = '${table}'
        `);
        expect(parseInt(tableExists.rows[0].count)).toBe(0);
      }
    });
  });

  describe('performComprehensiveCleanup', () => {
    it('should perform comprehensive cleanup with default config', async () => {
      const result = await cleanupService.performComprehensiveCleanup();

      expect(result).toBeDefined();
      expect(typeof result.cleanedStagingSchemas).toBe('number');
      expect(typeof result.cleanedTempFiles).toBe('number');
      expect(typeof result.cleanedDatabaseLogs).toBe('number');
      expect(typeof result.freedSpaceMB).toBe('number');
    });

    it('should perform aggressive cleanup when configured', async () => {
      const aggressiveCleanupService = new CleanupService(pgClient, {
        aggressiveCleanup: true
      });

      const result = await aggressiveCleanupService.performComprehensiveCleanup();

      expect(result).toBeDefined();
      // Aggressive cleanup should perform additional operations
    });
  });

  describe('cleanAllTestStagingSchemas', () => {
    it('should clean all test staging schemas', async () => {
      // Create some test staging schemas
      const testSchemas = [
        'staging_test_1',
        'staging_test_2',
        'staging_test_3'
      ];

      for (const schema of testSchemas) {
        await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await pgClient.query(`
          CREATE TABLE IF NOT EXISTS ${schema}.test_table (
            id SERIAL PRIMARY KEY,
            name TEXT
          )
        `);
      }

      await cleanupService.cleanAllTestStagingSchemas();

      // Verify all staging schemas were cleaned up
      const remainingSchemas = await pgClient.query(`
        SELECT COUNT(*) as count FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%'
      `);

      expect(parseInt(remainingSchemas.rows[0].count)).toBe(0);
    });
  });
});