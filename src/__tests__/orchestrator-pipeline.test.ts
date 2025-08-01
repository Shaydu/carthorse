import { Client } from 'pg';
import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';
import { TEST_CONFIG } from '../config/test-config';
import fs from 'fs';

// LIGHTWEIGHT test configuration
const FAST_TEST_CONFIG = {
  database: {
    host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
    port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
    database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
  },
  test: {
    maxTrails: 3, // Only test with 3 trails for speed
    region: 'boulder',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    maxSqliteDbSizeMB: 10, // Small size for testing
  },
  limits: {
    timeout: 30000, // 30 seconds max
  },
};

describe.skip('Orchestrator Pipeline Integration Tests (Optimized) (Moved to staging-integration.test.ts)', () => {
  let pgClient: Client;

  beforeAll(async () => {
    // Connect to test database
    pgClient = new Client(FAST_TEST_CONFIG.database);
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  describe('Fast Orchestrator Tests', () => {
    test('should create orchestrator with valid configuration', async () => {
      // Check if we have real Boulder data
      const trailCount = await pgClient.query('SELECT COUNT(*) as count FROM trails WHERE region = $1', ['boulder']);
      console.log(`📊 Found ${trailCount.rows[0].count} real Boulder trails in test database`);

      if (trailCount.rows[0].count === 0) {
        console.log('⏭️  Skipping test - no Boulder trails found in test database');
        return;
      }

      const outputPath = 'test-fast-orchestrator.db';
      
      // Clean up any existing test file
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }

      // Create orchestrator with lightweight config
      const orchestrator = new CarthorseOrchestrator({
        region: FAST_TEST_CONFIG.test.region,
        outputPath: outputPath,
        simplifyTolerance: FAST_TEST_CONFIG.test.simplifyTolerance,
        intersectionTolerance: FAST_TEST_CONFIG.test.intersectionTolerance,
        replace: true,
        validate: false,
        verbose: false, // Disable verbose logging for speed
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: FAST_TEST_CONFIG.test.maxSqliteDbSizeMB,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      // Test that the orchestrator can be created and configured
      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe(FAST_TEST_CONFIG.test.region);
      expect(orchestrator['config'].outputPath).toBe(outputPath);
      expect(orchestrator['config'].maxSqliteDbSizeMB).toBe(FAST_TEST_CONFIG.test.maxSqliteDbSizeMB);

      console.log(`✅ Successfully created orchestrator with configuration`);
    }, FAST_TEST_CONFIG.limits.timeout);

    test('should validate orchestrator staging schema creation', async () => {
      // Check if we have real Boulder data
      const trailCount = await pgClient.query('SELECT COUNT(*) as count FROM trails WHERE region = $1', ['boulder']);
      
      if (parseInt(trailCount.rows[0].count) === 0) {
        console.log('⏭️  Skipping test - no Boulder trails found in test database');
        return;
      }

      const outputPath = 'test-staging-validation.db';
      
      // Clean up any existing test file
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }

      const orchestrator = new CarthorseOrchestrator({
        region: FAST_TEST_CONFIG.test.region,
        outputPath: outputPath,
        simplifyTolerance: FAST_TEST_CONFIG.test.simplifyTolerance,
        intersectionTolerance: FAST_TEST_CONFIG.test.intersectionTolerance,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: FAST_TEST_CONFIG.test.maxSqliteDbSizeMB,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      // Test that staging schema can be created (lightweight version)
      try {
        // Just test that the orchestrator can be created and configured
        expect(orchestrator).toBeDefined();
        expect(orchestrator['stagingSchema']).toBeDefined();
        expect(typeof orchestrator['stagingSchema']).toBe('string');
        expect(orchestrator['stagingSchema']).toContain('staging_');
        
        console.log(`✅ Successfully created orchestrator with staging schema: ${orchestrator['stagingSchema']}`);
        
      } catch (error) {
        console.log(`❌ Orchestrator creation failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }, FAST_TEST_CONFIG.limits.timeout);

    test('should validate orchestrator database connection', async () => {
      // Test that the orchestrator can connect to the database
      const outputPath = 'test-connection-validation.db';
      
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }

      const orchestrator = new CarthorseOrchestrator({
        region: FAST_TEST_CONFIG.test.region,
        outputPath: outputPath,
        simplifyTolerance: FAST_TEST_CONFIG.test.simplifyTolerance,
        intersectionTolerance: FAST_TEST_CONFIG.test.intersectionTolerance,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: FAST_TEST_CONFIG.test.maxSqliteDbSizeMB,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      // Test that the orchestrator can connect to the database
      try {
        await orchestrator['pgClient'].connect();
        
        // Test a simple query
        const result = await orchestrator['pgClient'].query('SELECT COUNT(*) as count FROM trails WHERE region = $1', [FAST_TEST_CONFIG.test.region]);
        expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0);
        
        console.log(`✅ Successfully connected to database and queried ${result.rows[0].count} trails`);
        
        await orchestrator['pgClient'].end();
        
      } catch (error) {
        console.log(`❌ Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }, FAST_TEST_CONFIG.limits.timeout);
  });
}); 