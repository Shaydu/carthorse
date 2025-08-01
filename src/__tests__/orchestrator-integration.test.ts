import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Client } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';

describe('Orchestrator Integration Tests - Complete 3-Step Flow', () => {
  let pgClient: Client;
  let testDbPath: string;
  let orchestrator: CarthorseOrchestrator;

  beforeAll(async () => {
    // Connect to test database
    pgClient = new Client({
      host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
      port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
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
    // Setup test database path
    testDbPath = path.join(__dirname, '../../test-output/orchestrator-integration-test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(async () => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Complete 3-Step Export Flow', () => {
    it('should execute full orchestrator flow: readiness check → export → validation', async () => {
      // Step 0: Ensure test database is properly installed with all functions
      console.log('🔧 Step 0: Ensuring test database is properly installed...');
      
      try {
        // Check if required functions exist
        const functionCheck = await pgClient.query(`
          SELECT proname FROM pg_proc 
          WHERE proname IN ('copy_and_split_trails_to_staging_native', 'generate_routing_nodes_native', 'generate_routing_edges_native')
        `);
        
        if (functionCheck.rows.length < 3) {
          console.log('⚠️  Missing required functions, installing test database...');
          await CarthorseOrchestrator.installTestDatabase('boulder', 50);
          console.log('✅ Test database installation completed');
        } else {
          console.log('✅ Required functions already available');
        }
      } catch (error) {
        console.log('⚠️  Test database installation failed, continuing with existing database...');
      }

      // Check if we have real Boulder data
      const trailCount = await pgClient.query('SELECT COUNT(*) as count FROM trails WHERE region = $1', ['boulder']);
      console.log(`📊 Found ${trailCount.rows[0].count} real Boulder trails in test database`);

      if (trailCount.rows[0].count === 0) {
        console.log('⏭️  Skipping test - no Boulder trails found in test database');
        return;
      }

      // Step 1: Create orchestrator with readiness check enabled
      orchestrator = new CarthorseOrchestrator({
        region: 'boulder',
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: true, // Enable validation for post-export checks
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 50, // Reasonable size for testing
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: false, // Clean up staging for this test
        testCleanup: true,
      });

      // Verify orchestrator was created successfully
      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe('boulder');
      expect(orchestrator['config'].outputPath).toBe(testDbPath);

      console.log('✅ Step 1: Orchestrator created successfully');

      // Step 2: Execute the full pipeline (includes readiness check)
      console.log('🔄 Step 2: Executing full pipeline...');
      
      try {
        await orchestrator.exportSqlite();
        console.log('✅ Step 2: Full pipeline executed successfully');
      } catch (error) {
        console.error('❌ Pipeline execution failed:', error);
        throw error;
      }

      // Step 3: Verify the SQLite database was created and validate its contents
      console.log('🔍 Step 3: Validating exported SQLite database...');
      
      expect(fs.existsSync(testDbPath)).toBe(true);
      expect(fs.statSync(testDbPath).size).toBeGreaterThan(0);

      // Open and validate the SQLite database
      const sqliteDb = new Database(testDbPath);
      
      try {
        // Validate schema version
        const schemaVersion = sqliteDb.prepare('SELECT version FROM schema_version ORDER BY id DESC LIMIT 1').get() as { version: number };
        expect(schemaVersion.version).toBe(14);
        console.log(`✅ Schema version validated: v${schemaVersion.version}`);

        // Validate trails table
        const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number };
        expect(trailCount.count).toBeGreaterThan(0);
        console.log(`✅ Trails exported: ${trailCount.count}`);

        // Validate routing tables
        const nodeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes').get() as { count: number };
        const edgeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as { count: number };
        expect(nodeCount.count).toBeGreaterThan(0);
        expect(edgeCount.count).toBeGreaterThan(0);
        console.log(`✅ Routing graph generated: ${nodeCount.count} nodes, ${edgeCount.count} edges`);

        // Validate route recommendations
        const routeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM route_recommendations').get() as { count: number };
        expect(routeCount.count).toBeGreaterThanOrEqual(0);
        console.log(`✅ Route recommendations generated: ${routeCount.count}`);

        // Validate data integrity
        const nullRegions = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails WHERE region IS NULL OR region = ""').get() as { count: number };
        expect(nullRegions.count).toBe(0);
        console.log('✅ Data integrity validated: no null regions');

        // Validate required columns exist
        const trailColumns = sqliteDb.prepare("PRAGMA table_info(trails)").all() as any[];
        const columnNames = trailColumns.map(col => col.name);
        expect(columnNames).toContain('region');
        expect(columnNames).toContain('surface_type');
        expect(columnNames).toContain('length_km');
        console.log('✅ Required columns validated');

        console.log('✅ Step 3: SQLite database validation completed successfully');

      } finally {
        sqliteDb.close();
      }
    }, 120000); // 2 minute timeout for full integration test

    it('should handle readiness check failures gracefully', async () => {
      // Test with invalid region to trigger readiness check failure
      const invalidRegion = 'nonexistent_region';
      
      orchestrator = new CarthorseOrchestrator({
        region: invalidRegion,
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 50,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
        testCleanup: false,
      });

      // Expect the readiness check to fail
      await expect(orchestrator.exportSqlite()).rejects.toThrow();
      
      // Verify no database was created
      expect(fs.existsSync(testDbPath)).toBe(false);
      
      console.log('✅ Readiness check failure handled gracefully');
    }, 30000);

    it('should validate post-export data quality', async () => {
      // Check if we have real Boulder data
      const trailCount = await pgClient.query('SELECT COUNT(*) as count FROM trails WHERE region = $1', ['boulder']);
      
      if (trailCount.rows[0].count === 0) {
        console.log('⏭️  Skipping test - no Boulder trails found in test database');
        return;
      }

      // Run successful export
      orchestrator = new CarthorseOrchestrator({
        region: 'boulder',
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: true,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 50,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanup: true,
        testCleanup: false,
      });

      await orchestrator.exportSqlite();

      // Validate data quality metrics
      const sqliteDb = new Database(testDbPath);
      
      try {
        // Check trail data quality
        const trailQuality = sqliteDb.prepare(`
          SELECT 
            COUNT(*) as total_trails,
            COUNT(CASE WHEN length_km > 0 THEN 1 END) as trails_with_length,
            COUNT(CASE WHEN elevation_gain >= 0 THEN 1 END) as trails_with_elevation,
            COUNT(CASE WHEN region IS NOT NULL AND region != '' THEN 1 END) as trails_with_region,
            AVG(length_km) as avg_length,
            AVG(elevation_gain) as avg_elevation_gain
          FROM trails
        `).get() as any;

        expect(trailQuality.total_trails).toBeGreaterThan(0);
        expect(trailQuality.trails_with_length).toBe(trailQuality.total_trails);
        expect(trailQuality.trails_with_elevation).toBe(trailQuality.total_trails);
        expect(trailQuality.trails_with_region).toBe(trailQuality.total_trails);
        expect(trailQuality.avg_length).toBeGreaterThan(0);
        expect(trailQuality.avg_elevation_gain).toBeGreaterThanOrEqual(0);

        console.log(`✅ Data quality validated: ${trailQuality.total_trails} trails with complete data`);

        // Check routing graph quality
        const routingQuality = sqliteDb.prepare(`
          SELECT 
            COUNT(*) as total_nodes,
            COUNT(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 END) as nodes_with_coords,
            COUNT(CASE WHEN elevation IS NOT NULL THEN 1 END) as nodes_with_elevation
          FROM routing_nodes
        `).get() as any;

        if (routingQuality.total_nodes > 0) {
          expect(routingQuality.nodes_with_coords).toBe(routingQuality.total_nodes);
          expect(routingQuality.nodes_with_elevation).toBe(routingQuality.total_nodes);
          console.log(`✅ Routing graph quality validated: ${routingQuality.total_nodes} nodes with complete data`);
        }

        // Check edge quality
        const edgeQuality = sqliteDb.prepare(`
          SELECT 
            COUNT(*) as total_edges,
            COUNT(CASE WHEN distance_km > 0 THEN 1 END) as edges_with_distance,
            COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as edges_with_nodes
          FROM routing_edges
        `).get() as any;

        if (edgeQuality.total_edges > 0) {
          expect(edgeQuality.edges_with_distance).toBe(edgeQuality.total_edges);
          expect(edgeQuality.edges_with_nodes).toBe(edgeQuality.total_edges);
          console.log(`✅ Routing edges quality validated: ${edgeQuality.total_edges} edges with complete data`);
        }

      } finally {
        sqliteDb.close();
      }
    }, 120000);
  });

  describe('Orchestrator Configuration Validation', () => {
    it('should validate orchestrator configuration options', async () => {
      // Test different configuration combinations
      const configs = [
        {
          name: 'Minimal config',
          config: {
            region: 'boulder',
            outputPath: testDbPath,
            simplifyTolerance: 0.001,
            intersectionTolerance: 2.0,
            replace: true,
            validate: false,
            verbose: false,
            skipBackup: true,
            buildMaster: false,
            targetSizeMB: null,
            maxSqliteDbSizeMB: 50,
            skipIncompleteTrails: true,
            useSqlite: true,
            skipCleanup: true,
          }
        },
        {
          name: 'Full validation config',
          config: {
            region: 'boulder',
            outputPath: testDbPath,
            simplifyTolerance: 0.001,
            intersectionTolerance: 2.0,
            replace: true,
            validate: true,
            verbose: true,
            skipBackup: true,
            buildMaster: false,
            targetSizeMB: null,
            maxSqliteDbSizeMB: 50,
            skipIncompleteTrails: true,
            useSqlite: true,
            skipCleanup: false,
            testCleanup: true,
          }
        }
      ];

      for (const testConfig of configs) {
        console.log(`Testing configuration: ${testConfig.name}`);
        
        const orchestrator = new CarthorseOrchestrator(testConfig.config);
        expect(orchestrator).toBeDefined();
        expect(orchestrator['config'].region).toBe('boulder');
        expect(orchestrator['config'].outputPath).toBe(testDbPath);
        
        console.log(`✅ Configuration validated: ${testConfig.name}`);
      }
    });
  });
}); 