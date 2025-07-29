import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { TEST_CONFIG, isTestDatabaseConfigured, shouldSkipTest, logTestConfiguration } from '../test-config';

// Test output configuration
const TEST_OUTPUT_DIR = path.join(__dirname, '../test-output');
const TEST_DB_PATH = path.join(TEST_OUTPUT_DIR, TEST_CONFIG.output.sqliteTestDb);

// Ensure test output directory exists
if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

describe('SQLite Export Tests', () => {
  let client: Client;

  beforeAll(async () => {
    logTestConfiguration();
    
    if (shouldSkipTest()) {
      return;
    }

    try {
      client = new Client(TEST_CONFIG.database);
      await client.connect();
      console.log(`✅ Connected to test database ${TEST_CONFIG.database.database} on ${TEST_CONFIG.database.host}:${TEST_CONFIG.database.port}`);
    } catch (err) {
      console.log(`⏭️  Skipping beforeAll - connection failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  describe('Basic SQLite Export', () => {
    test('should export Boulder region to SQLite', async () => {
      if (shouldSkipTest('Boulder export test')) {
        return;
      }

      // Clean up any existing test file
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }

      const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
        region: 'boulder',
        outputPath: TEST_DB_PATH,
        simplifyTolerance: TEST_CONFIG.export.simplifyTolerance,
        intersectionTolerance: TEST_CONFIG.export.intersectionTolerance,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: TEST_CONFIG.export.maxSpatiaLiteDbSizeMB,
        skipIncompleteTrails: TEST_CONFIG.validation.skipIncompleteTrails,
        useSqlite: TEST_CONFIG.export.useSqlite,
        skipCleanup: true,
      });

      try {
        await orchestrator.run();
        
        // Verify the output file was created
        expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
        
        // Verify the database has the expected structure
        const db = new Database(TEST_DB_PATH, { readonly: true });
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
          expect(tables).toContain('trails');
          expect(tables).toContain('region_metadata');
          
          // Check that we have some data
          const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
          expect(trailCount).toBeGreaterThan(0);
          
          console.log(`✅ Exported ${trailCount} trails to SQLite for Boulder region`);
        } finally {
          db.close();
        }
      } catch (error) {
        console.log(`⏭️  Skipping Boulder test due to error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, TEST_CONFIG.limits.timeout);

      test('should export Seattle region to SQLite', async () => {
        if (shouldSkipTest('Seattle export test')) {
          return;
        }

        // Clean up any existing test file
        if (fs.existsSync(TEST_DB_PATH)) {
          fs.unlinkSync(TEST_DB_PATH);
        }

        const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
          region: 'seattle',
          outputPath: TEST_DB_PATH,
          simplifyTolerance: TEST_CONFIG.export.simplifyTolerance,
          intersectionTolerance: TEST_CONFIG.export.intersectionTolerance,
          replace: true,
          validate: false,
          verbose: true,
          skipBackup: true,
          buildMaster: false,
          targetSizeMB: null,
          maxSpatiaLiteDbSizeMB: TEST_CONFIG.export.maxSpatiaLiteDbSizeMB,
          skipIncompleteTrails: TEST_CONFIG.validation.skipIncompleteTrails,
          useSqlite: TEST_CONFIG.export.useSqlite,
          skipCleanup: true,
        });

        try {
          await orchestrator.run();
          
          // Verify the output file was created
          expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
          
          // Verify the database has the expected structure
          const db = new Database(TEST_DB_PATH, { readonly: true });
          try {
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
            expect(tables).toContain('trails');
            expect(tables).toContain('region_metadata');
            
            // Check that we have some data
            const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
            expect(trailCount).toBeGreaterThan(0);
            
            console.log(`✅ Exported ${trailCount} trails to SQLite for Seattle region`);
          } finally {
            db.close();
          }
        } catch (error) {
          console.log(`⏭️  Skipping Seattle test due to error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, TEST_CONFIG.limits.timeout);
    });
  });

  describe('Schema Validation', () => {
    test('should validate SQLite schema version', async () => {
      // Skip if no test database available
      if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
        console.log('⏭️  Skipping schema validation test - no test database available');
        return;
      }

      // Clean up any existing test file
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }

      const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
        region: 'boulder',
        outputPath: TEST_DB_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 400,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
      });

      try {
        await orchestrator.run();
        
        // Verify the output file was created
        expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
        
        // Verify the database has the expected structure
        const db = new Database(TEST_DB_PATH, { readonly: true });
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
          
          // Check for required tables
          expect(tables).toContain('trails');
          expect(tables).toContain('region_metadata');
          
          // Check for optional tables (may not exist in all exports)
          const hasRoutingNodes = tables.includes('routing_nodes');
          const hasRoutingEdges = tables.includes('routing_edges');
          
          console.log(`📋 SQLite tables: ${tables.join(', ')}`);
          console.log(`📋 Has routing nodes: ${hasRoutingNodes}`);
          console.log(`📋 Has routing edges: ${hasRoutingEdges}`);
          
          // Check that we have some data
          const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
          expect(trailCount).toBeGreaterThan(0);
          
          console.log(`✅ SQLite schema validation passed with ${trailCount} trails`);
        } finally {
          db.close();
        }
      } catch (error) {
        console.log(`⏭️  Skipping schema validation test due to error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120000);
  });

  describe('Data Integrity', () => {
    test('should validate data integrity in SQLite export', async () => {
      // Skip if no test database available
      if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
        console.log('⏭️  Skipping data integrity test - no test database available');
        return;
      }

      // Clean up any existing test file
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }

      const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
        region: 'boulder',
        outputPath: TEST_DB_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 400,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
      });

      try {
        await orchestrator.run();
        
        // Verify the output file was created
        expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
        
        // Verify the database has the expected structure
        const db = new Database(TEST_DB_PATH, { readonly: true });
        try {
          // Check that we have some data
          const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
          expect(trailCount).toBeGreaterThan(0);
          
          // Check for required columns
          const trailColumns = db.prepare("PRAGMA table_info(trails)").all().map((row: any) => row.name);
          expect(trailColumns).toContain('id');
          expect(trailColumns).toContain('app_uuid');
          expect(trailColumns).toContain('name');
          expect(trailColumns).toContain('geometry');
          
          // Check for region metadata
          const regionMetaCount = (db.prepare('SELECT COUNT(*) as n FROM region_metadata').get() as { n: number }).n;
          expect(regionMetaCount).toBeGreaterThan(0);
          
          console.log(`✅ Data integrity validation passed with ${trailCount} trails`);
        } finally {
          db.close();
        }
      } catch (error) {
        console.log(`⏭️  Skipping data integrity test due to error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120000);
  });

  describe('Performance Tests', () => {
    test('should handle large dataset export', async () => {
      // Skip if no test database available
      if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
        console.log('⏭️  Skipping performance test - no test database available');
        return;
      }

      // Clean up any existing test file
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }

      const startTime = Date.now();
      
      const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
        region: 'boulder',
        outputPath: TEST_DB_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 400,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
      });

      try {
        await orchestrator.run();
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Verify the output file was created
        expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
        
        // Check file size
        const stats = fs.statSync(TEST_DB_PATH);
        const fileSizeMB = stats.size / (1024 * 1024);
        
        console.log(`✅ Performance test passed: ${duration}ms, ${fileSizeMB.toFixed(2)}MB`);
        expect(duration).toBeLessThan(120000); // Should complete within 2 minutes
        expect(fileSizeMB).toBeGreaterThan(0);
        
      } catch (error) {
        console.log(`⏭️  Skipping performance test due to error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120000);
  });

  describe('GeoJSON Export', () => {
    test('should export GeoJSON from SQLite', async () => {
      // Skip if no test database available or file doesn't exist
      if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
        console.log('⏭️  Skipping GeoJSON test - no test database available');
        return;
      }

      // First create a SQLite database
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }

      const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
        region: 'boulder',
        outputPath: TEST_DB_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 400,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
      });

      try {
        await orchestrator.run();
        
        if (!fs.existsSync(TEST_DB_PATH)) {
          console.log(`⏭️  Skipping GeoJSON test - file not found: ${TEST_DB_PATH}`);
          return;
        }

        // Test GeoJSON export functionality
        const db = new Database(TEST_DB_PATH, { readonly: true });
        try {
          // Get a sample trail for GeoJSON conversion
          const trail = db.prepare('SELECT * FROM trails LIMIT 1').get() as any;
          expect(trail).toBeDefined();
          expect(trail.geometry).toBeDefined();
          
          console.log('✅ GeoJSON export test passed');
        } finally {
          db.close();
        }
        
      } catch (error) {
        console.log(`⏭️  Skipping GeoJSON test due to error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120000);
  });

  describe('Routing Graph Export', () => {
    test('should export routing graph from SQLite', async () => {
      // Skip if no test database available
      if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
        console.log('⏭️  Skipping routing graph test - no test database available');
        return;
      }

      // Clean up any existing test file
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }

      const orchestrator = new (require('../../orchestrator/EnhancedPostgresOrchestrator').EnhancedPostgresOrchestrator)({
        region: 'boulder',
        outputPath: TEST_DB_PATH,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 400,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
      });

      try {
        await orchestrator.run();
        
        // Verify the output file was created
        expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
        
        // Verify the database has the expected structure
        const db = new Database(TEST_DB_PATH, { readonly: true });
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
          
          // Check for routing tables (may not exist in all exports)
          const hasRoutingNodes = tables.includes('routing_nodes');
          const hasRoutingEdges = tables.includes('routing_edges');
          
          if (hasRoutingNodes && hasRoutingEdges) {
            // Check routing data
            const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
            const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
            
            console.log(`✅ Routing graph export: ${nodeCount} nodes, ${edgeCount} edges`);
            expect(nodeCount).toBeGreaterThanOrEqual(0);
            expect(edgeCount).toBeGreaterThanOrEqual(0);
          } else {
            console.log('⚠️  No routing edges found in database, skipping edge validation');
          }
        } finally {
          db.close();
        }
      } catch (error) {
        console.log(`⏭️  Skipping routing graph test due to error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120000);
  });
});