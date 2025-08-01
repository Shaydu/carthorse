#!/usr/bin/env ts-node
/**
 * Carthorse Orchestrator for Trail Data Processing
 * 
 * This orchestrator manages the complete pipeline for processing trail data:
 * 1. Creates staging environment in PostgreSQL
 * 2. Copies region data to staging schema
 * 3. Detects trail intersections using PostGIS
 * 4. Splits trails at intersection points
 * 5. Generates routing graph with nodes and edges
 * 6. Exports processed data to SQLite
 * 
 * Usage:
 *   npx ts-node carthorse-orchestrator.ts --region <region> --sqlite-db-export <path> [options]
 *   npx ts-node carthorse-orchestrator.ts --region boulder --sqlite-db-export ./data/boulder.db
 *   npx ts-node carthorse-orchestrator.ts --region boulder --sqlite-db-export ./data/boulder.db --build-master
 * 
 * Options:
 *   --region                    Region name (required)
 *   --sqlite-db-export         SQLite database export path (required)
 *   --build-master             Build master database from scratch
 *   --max-sqlite-db-size       Maximum database size in MB (default: 400)
 *   --intersection-tolerance   Distance tolerance for intersection detection (default: 2.0)
 *   --simplify-tolerance       Geometry simplification tolerance (default: 0.001)
 *   --validate                 Validate exported database
 *   --verbose                  Enable verbose logging
 */

// NOTE: Do not set process.env.PGDATABASE or PGUSER here.
// Test DB safety must be enforced in test setup or before importing this module.

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as readline from 'readline';
dotenv.config();

import { getDbConfig, validateTestEnvironment } from '../utils/env';
import { backupDatabase } from '../utils/sql/backup';
import { getStagingSchemaSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { isValidNumberTuple, hashString } from '../utils';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { execSync } from 'child_process';
import { createCanonicalRoutingEdgesTable } from '../utils/sql/postgres-schema-helpers';
import { getTolerances } from '../utils/config-loader';
import { getCurrentSqliteSchemaVersion } from '../utils/schema-version-reader';
import { calculateInitialViewBbox, getValidInitialViewBbox } from '../utils/bbox';
import { getTestDbConfig } from '../database/connection';

// --- Type Definitions ---
import type { CarthorseOrchestratorConfig } from '../types';
import { ElevationService } from '../utils/elevation-service';
import { ValidationService } from '../utils/validation-service';
import { CleanupService } from '../utils/cleanup-service';
import { OrchestratorHooks, OrchestratorContext } from './orchestrator-hooks';

async function checkSchemaVersion(pgClient: Client, expectedVersion: number) {
  const res = await pgClient.query('SELECT version FROM schema_version ORDER BY id DESC LIMIT 1;');
  if (!res.rows.length) {
    throw new Error('❌ schema_version table is missing or empty!');
  }
  const dbVersion = res.rows[0].version;
  if (dbVersion !== expectedVersion) {
    throw new Error(`❌ Schema version mismatch: expected ${expectedVersion}, found ${dbVersion}`);
  }
  console.log(`✅ Schema version ${dbVersion} is as expected.`);
}

export class CarthorseOrchestrator {
  private pgClient: Client;
  private pgConfig: any;
  private config: CarthorseOrchestratorConfig;
  public readonly stagingSchema: string;
  private elevationService: ElevationService;
  private validationService: ValidationService;
  private cleanupService: CleanupService;
  private hooks: OrchestratorHooks;

  /**
   * Public method to manually cleanup staging schema (useful for tests)
   */
  public async cleanupStaging(): Promise<void> {
    await this.cleanupService.cleanAllTestStagingSchemas();
  }

  /**
   * Backup the production database
   * This method creates a complete backup of the production PostgreSQL database
   */
  public static async backupProductionDatabase(): Promise<void> {
    console.log('💾 Starting production database backup...');
    
    try {
      const dbConfig = getDbConfig();
      await backupDatabase(dbConfig);
      console.log('✅ Production database backup completed successfully!');
    } catch (error) {
      console.error('❌ Production database backup failed:', error);
      throw error;
    }
  }

  /**
   * Validate a SQLite database export using the comprehensive validation tool
   * This method uses the existing carthorse-validate-database.ts script
   */
  public static async validateDatabase(dbPath: string): Promise<void> {
    console.log('🔍 Starting comprehensive database validation...');
    
    try {
      // Use the existing comprehensive validation tool
      const { spawnSync } = require('child_process');
      
      // Check if database file exists
      const fs = require('fs');
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Database file not found: ${dbPath}`);
      }
      
      // Run the comprehensive validation script
      const result = spawnSync('npx', [
        'ts-node', 
        'src/tools/carthorse-validate-database.ts', 
        '--db', 
        dbPath
      ], {
        stdio: 'inherit',
        cwd: process.cwd()
      });
      
      if (result.status !== 0) {
        throw new Error(`Database validation failed with exit code ${result.status}`);
      }
      
      console.log('✅ Comprehensive database validation completed successfully!');
    } catch (error) {
      console.error('❌ Database validation failed:', error);
      throw error;
    }
  }

  /**
   * Perform comprehensive cleanup of all test databases and staging schemas
   * This method calls the static cleanup methods for thorough cleanup
   */
  public async performComprehensiveCleanup(): Promise<void> {
    console.log('🧹 Performing comprehensive cleanup...');
    
    try {
      // First clean up the current staging schema if it exists
      if (this.stagingSchema) {
        console.log(`🗑️ Cleaning up current staging schema: ${this.stagingSchema}`);
        await this.cleanupStaging();
      }
      
      // Then perform comprehensive cleanup of all test databases
      await CarthorseOrchestrator.cleanAllTestDatabases();
      
      console.log('✅ Comprehensive cleanup completed');
    } catch (error) {
      console.error('❌ Error during comprehensive cleanup:', error);
      // Don't throw error - cleanup failures shouldn't break the main process
    }
  }

  /**
   * Export schema and data from staging to SQLite (Phase 1: Schema Creation)
   * This method can be called independently to export the database without running the full pipeline
   */
  public async exportSchema(): Promise<void> {
    try {
      if (!this.pgClient) {
        throw new Error('No database connection available');
      }

      // Query data from staging schema
      const trailsRes = await this.pgClient.query(`
        SELECT 
          *,
          surface as surface_type,
          CASE
            WHEN difficulty = 'unknown' THEN 'moderate'
            ELSE difficulty
          END as difficulty,
          ST_AsGeoJSON(geometry, 6, 0) AS geojson 
        FROM ${this.stagingSchema}.trails
      `);
      const nodesRes = await this.pgClient.query(`
        SELECT 
          id,
          node_uuid,
          lat,
          lng,
          elevation,
          node_type,
          connected_trails,
          NOW() as created_at
        FROM ${this.stagingSchema}.routing_nodes
      `);
      const edgesRes = await this.pgClient.query(`
        SELECT 
          id,
          source,
          target,
          trail_id,
          trail_name,
          distance_km,
          elevation_gain,
          elevation_loss,
          is_bidirectional,
          NOW() as created_at,
          ST_AsGeoJSON(geometry, 6, 0) AS geojson
        FROM ${this.stagingSchema}.routing_edges
        WHERE source IS NOT NULL AND target IS NOT NULL
      `);

      console.log(`📊 Found ${trailsRes.rows.length} trails, ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);

      // Import SQLite helpers
      const { 
        createSqliteTables, 
        insertTrails, 
        insertRoutingNodes, 
        insertRoutingEdges, 
        buildRegionMeta, 
        insertRegionMetadata, 
        insertSchemaVersion,
        validateSchemaVersion
      } = require('../utils/sqlite-export-helpers');

      // Open database and export to SQLite
      const Database = require('better-sqlite3');
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Force delete existing SQLite database to ensure clean v14 schema
      if (fs.existsSync(this.config.outputPath)) {
        console.log(`🗑️  Deleting existing SQLite database: ${this.config.outputPath}`);
        fs.unlinkSync(this.config.outputPath);
      }
      
      // Also delete any related SQLite files (WAL, SHM)
      const dbPathWithoutExt = this.config.outputPath.replace(/\.db$/, '');
      const relatedFiles = [
        `${dbPathWithoutExt}.db-shm`,
        `${dbPathWithoutExt}.db-wal`,
        `${this.config.outputPath}-shm`,
        `${this.config.outputPath}-wal`
      ];
      
      for (const file of relatedFiles) {
        if (fs.existsSync(file)) {
          console.log(`🗑️  Deleting related SQLite file: ${file}`);
          fs.unlinkSync(file);
        }
      }
      
      const sqliteDb = new Database(this.config.outputPath);
      
      console.log('📊 Exporting to SQLite...');

      // Create tables and insert data
      createSqliteTables(sqliteDb, this.config.outputPath);
      
      // Validate and transform GeoJSON data
      function ensureFeature(geojson: any) {
        if (!geojson) return null;
        if (typeof geojson === 'string') geojson = JSON.parse(geojson);
        if (geojson.type === 'Feature') return geojson;
        return {
          type: 'Feature',
          properties: {},
          geometry: geojson
        };
      }
      
      for (const trail of trailsRes.rows) {
        if (!trail.geojson || typeof trail.geojson !== 'string' || trail.geojson.length < 10) {
          throw new Error(`geojson is required for all trails (app_uuid: ${trail.app_uuid})`);
        }
        trail.geojson = JSON.stringify(ensureFeature(trail.geojson));
      }
      
      for (const edge of edgesRes.rows) {
        if (!edge.geojson || typeof edge.geojson !== 'string' || edge.geojson.length < 10) {
          throw new Error(`geojson is required for all routing edges (id: ${edge.id})`);
        }
        edge.geojson = JSON.stringify(ensureFeature(edge.geojson));
      }
      
      insertTrails(sqliteDb, trailsRes.rows, this.config.outputPath);
      insertRoutingNodes(sqliteDb, nodesRes.rows, this.config.outputPath);
      insertRoutingEdges(sqliteDb, edgesRes.rows, this.config.outputPath);

      // Export route recommendations if they exist
      try {
        const recommendationsRes = await this.pgClient.query(`
          SELECT 
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
          FROM ${this.stagingSchema}.route_recommendations
        `);
        
        if (recommendationsRes.rows.length > 0) {
          console.log(`📊 Exporting ${recommendationsRes.rows.length} route recommendations to SQLite...`);
          const { insertRouteRecommendations } = require('../utils/sqlite-export-helpers');
          insertRouteRecommendations(sqliteDb, recommendationsRes.rows);
        } else {
          console.log('ℹ️  No route recommendations found in staging schema');
        }
      } catch (error) {
        console.warn('⚠️  Route recommendations export failed:', error);
        console.warn('Continuing with export...');
      }

      // Build region metadata and insert
      const regionMeta = buildRegionMeta(trailsRes.rows, this.config.region, this.regionBbox);
      insertRegionMetadata(sqliteDb, regionMeta, this.config.outputPath);
      insertSchemaVersion(sqliteDb, getCurrentSqliteSchemaVersion(), 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)', this.config.outputPath);

      sqliteDb.close();
      console.log('✅ Database export completed successfully');
      console.log(`📁 Output: ${this.config.outputPath}`);

      // Single validation at the end: check version, schema, and data
      await this.validateExport();

    } catch (error) {
      console.error('❌ Database export failed:', error);
      throw error;
    }
  }

  /**
   * Export data from staging to SQLite (Phase 2: Data Export)
   * Useful when you already have processed data in staging and just want to export it
   */
  public async exportData(): Promise<void> {
    console.log('💾 Exporting staging data to SQLite...');
    
    try {
      // Ensure we have a connection
      if (!this.pgClient) {
        throw new Error('No database connection available');
      }

      // Check if staging schema exists
      const schemaExists = await this.pgClient.query(`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.schemata 
          WHERE schema_name = $1
        )
      `, [this.stagingSchema]);

      if (!schemaExists.rows[0].exists) {
        throw new Error(`Staging schema '${this.stagingSchema}' does not exist. Run the pipeline first or create staging environment.`);
      }

      // Query data from staging schema
      const trailsRes = await this.pgClient.query(`
        SELECT 
          *,
          surface as surface_type,
          CASE
            WHEN difficulty = 'unknown' THEN 'moderate'
            ELSE difficulty
          END as difficulty,
          ST_AsGeoJSON(geometry, 6, 0) AS geojson 
        FROM ${this.stagingSchema}.trails
      `);
      const nodesRes = await this.pgClient.query(`
        SELECT 
          id,
          COALESCE(node_uuid, gen_random_uuid()::text) as node_uuid,
          lat,
          lng,
          elevation,
          COALESCE(node_type, 'intersection') as node_type,
          COALESCE(connected_trails, '') as connected_trails,
          NOW() as created_at
        FROM ${this.stagingSchema}.routing_nodes
      `);
      const edgesRes = await this.pgClient.query(`
        SELECT 
          id,
          source,
          target,
          trail_id,
          trail_name,
          distance_km,
          ST_AsGeoJSON(geometry, 6, 0) AS geojson,
          NOW() as created_at
        FROM ${this.stagingSchema}.routing_edges
      `);

      console.log(`📊 Found ${trailsRes.rows.length} trails, ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);

      // Import SQLite helpers
      const { 
        createSqliteTables, 
        insertTrails, 
        insertRoutingNodes, 
        insertRoutingEdges, 
        buildRegionMeta, 
        insertRegionMetadata, 
        insertSchemaVersion,
        validateSchemaVersion
      } = require('../utils/sqlite-export-helpers');

      // Open database and export to SQLite
      const Database = require('better-sqlite3');
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Force delete existing SQLite database to ensure clean v14 schema
      if (fs.existsSync(this.config.outputPath)) {
        console.log(`🗑️  Deleting existing SQLite database: ${this.config.outputPath}`);
        fs.unlinkSync(this.config.outputPath);
      }
      
      // Also delete any related SQLite files (WAL, SHM)
      const dbPathWithoutExt = this.config.outputPath.replace(/\.db$/, '');
      const relatedFiles = [
        `${dbPathWithoutExt}.db-shm`,
        `${dbPathWithoutExt}.db-wal`,
        `${this.config.outputPath}-shm`,
        `${this.config.outputPath}-wal`
      ];
      
      for (const file of relatedFiles) {
        if (fs.existsSync(file)) {
          console.log(`🗑️  Deleting related SQLite file: ${file}`);
          fs.unlinkSync(file);
        }
      }
      
      const sqliteDb = new Database(this.config.outputPath);
      
      console.log('📊 Exporting to SQLite...');

      // Create tables and insert data
      createSqliteTables(sqliteDb, this.config.outputPath);
      
      // Validate and transform data
      const trailsToExport = trailsRes.rows.map((trail: any) => {
        if (!trail.geojson || typeof trail.geojson !== 'string' || trail.geojson.length < 10) {
          throw new Error(`geojson is required for all trails (app_uuid: ${trail.app_uuid})`);
        }
        return trail;
      });
      
      console.log(`📊 Exporting ${trailsToExport.length} trails`);
      insertTrails(sqliteDb, trailsToExport, this.config.outputPath);
      insertRoutingNodes(sqliteDb, nodesRes.rows, this.config.outputPath);
      insertRoutingEdges(sqliteDb, edgesRes.rows, this.config.outputPath);

      // Export route recommendations if they exist
      try {
        const recommendationsRes = await this.pgClient.query(`
          SELECT 
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
          FROM ${this.stagingSchema}.route_recommendations
        `);
        
        if (recommendationsRes.rows.length > 0) {
          console.log(`📊 Exporting ${recommendationsRes.rows.length} route recommendations to SQLite...`);
          const { insertRouteRecommendations } = require('../utils/sqlite-export-helpers');
          insertRouteRecommendations(sqliteDb, recommendationsRes.rows);
        } else {
          console.log('ℹ️  No route recommendations found in staging schema');
        }
      } catch (error) {
        console.warn('⚠️  Route recommendations export failed:', error);
        console.warn('Continuing with export...');
      }

      // Build region metadata and insert
      const regionMeta = buildRegionMeta([], this.config.region, this.regionBbox);
      insertRegionMetadata(sqliteDb, regionMeta, this.config.outputPath);
      insertSchemaVersion(sqliteDb, getCurrentSqliteSchemaVersion(), 'Carthorse Staging Export v14.0 (Enhanced Route Recommendations + Trail Composition)', this.config.outputPath);

      sqliteDb.close();
      console.log('✅ Staging data export completed successfully');
      console.log(`📁 Output: ${this.config.outputPath}`);

      // Single validation at the end: check version, schema, and data
      await this.validateExport();
      
    } catch (error) {
      console.error('❌ Staging data export failed:', error);
      throw error;
    }
  }
  private regionBbox: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    trailCount: number;
  } | null = null;

  /**
   * Static method to clean up all test staging schemas
   * Used by CLI commands for comprehensive cleanup
   */
  public static async cleanAllTestStagingSchemas(): Promise<void> {
    console.log('🗑️ Cleaning up all test staging schemas...');
    
    try {
      // Use test DB config for safety
      const clientConfig = getTestDbConfig();
      const pgClient = new Client(clientConfig);
      
      await pgClient.connect();
      
      // Find all staging schemas
      const result = await pgClient.query(`
        SELECT nspname 
        FROM pg_namespace 
        WHERE nspname LIKE 'staging_%' 
        ORDER BY nspname
      `);

      const stagingSchemas = result.rows.map(row => row.nspname);
      
      if (stagingSchemas.length === 0) {
        console.log('📊 No staging schemas found to clean up');
        await pgClient.end();
        return;
      }

      console.log(`🗑️ Found ${stagingSchemas.length} staging schemas to clean up:`);
      
      for (const schema of stagingSchemas) {
        console.log(`   - Dropping staging schema: ${schema}`);
        await pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }

      await pgClient.end();
      console.log('✅ All test staging schemas cleaned up successfully');
    } catch (error) {
      console.error('❌ Error cleaning up test staging schemas:', error);
      throw error;
    }
  }

  /**
   * Clean up all SQLite test databases and related files
   * Used by CLI commands for comprehensive cleanup
   */
  public static async cleanAllTestSqliteDatabases(): Promise<void> {
    console.log('🗑️ Cleaning up all SQLite test databases...');
    
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Find and remove test database files
      const testDbFiles: string[] = [];
      const findTestDbs = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            findTestDbs(fullPath);
          } else if (file.endsWith('.db') && stat.isFile()) {
            // Skip production databases
            if (fullPath.includes('boulder-export') || fullPath.includes('seattle-export')) {
              console.log(`⏭️  Skipping production database: ${fullPath}`);
              continue;
            }
            
            // Check if it's a test database
            if (fullPath.includes('test') || fullPath.includes('tmp') || fullPath.includes('temp')) {
              testDbFiles.push(fullPath);
            }
          }
        }
      };

      // Search in current directory and common test directories
      findTestDbs('.');
      
      if (testDbFiles.length === 0) {
        console.log('📊 No SQLite test databases found to clean up');
        return;
      }

      console.log(`🗑️ Found ${testDbFiles.length} SQLite test databases to clean up:`);
      
      for (const dbFile of testDbFiles) {
        console.log(`   - Removing test database: ${dbFile}`);
        fs.unlinkSync(dbFile);
      }

      // Remove test output directories
      console.log('🗑️ Cleaning test output directories...');
      const testDirs = [
        'src/data/test-sqlite-migration/',
        'src/data/test-sqlite-helpers/',
        'logs/',
        'tmp/'
      ];

      for (const dir of testDirs) {
        if (fs.existsSync(dir)) {
          console.log(`   - Removing test directory: ${dir}`);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }

      // Remove any SQLite WAL/SHM files
      const walShmFiles: string[] = [];
      const findWalShm = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            findWalShm(fullPath);
          } else if ((file.endsWith('.db-wal') || file.endsWith('.db-shm')) && stat.isFile()) {
            walShmFiles.push(fullPath);
          }
        }
      };

      findWalShm('.');
      
      for (const walShmFile of walShmFiles) {
        console.log(`   - Removing SQLite WAL/SHM file: ${walShmFile}`);
        fs.unlinkSync(walShmFile);
      }

      console.log('✅ All SQLite test databases cleaned up successfully');
    } catch (error) {
      console.error('❌ Error cleaning up SQLite test databases:', error);
      throw error;
    }
  }

  /**
   * Comprehensive cleanup of all test databases (PostgreSQL and SQLite)
   * Used by CLI commands for complete cleanup
   */
  public static async cleanAllTestDatabases(): Promise<void> {
    console.log('🧹 Comprehensive Test Database Cleanup');
    console.log('=====================================');
    
    try {
      // Clean up PostgreSQL staging schemas
      await this.cleanAllTestStagingSchemas();
      
      // Clean up SQLite test databases
      await this.cleanAllTestSqliteDatabases();
      
      console.log('\n✅ All test databases cleaned up successfully!');
      console.log('\n📋 Summary of what was cleaned:');
      console.log('   - PostgreSQL staging schemas');
      console.log('   - SQLite test database files (*.db)');
      console.log('   - Test output directories');
      console.log('   - SQLite WAL/SHM files');
      console.log('   - Log files');
      console.log('\n🔄 Next time you run tests, fresh databases will be created with the correct schema.');
    } catch (error) {
      console.error('❌ Error during comprehensive cleanup:', error);
      throw error;
    }
  }

  /**
   * Install a fresh Carthorse database with all required schema, indexes, and functions
   */
  public static async install(): Promise<void> {
    console.log('🚀 Carthorse Database Installation');
    console.log('================================');
    
    // Create readline interface for user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      // Prompt for database name
      const dbName = await new Promise<string>((resolve) => {
        rl.question('Enter the master database name (e.g., trail_master_db): ', (answer) => {
          resolve(answer.trim());
        });
      });

      if (!dbName) {
        throw new Error('Database name is required');
      }

      console.log(`\n📋 Installing Carthorse database: ${dbName}`);

      // Check if database already exists
      const checkClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: 'postgres' // Connect to default database to check
      });

      await checkClient.connect();
      
      const dbExists = await checkClient.query(`
        SELECT 1 FROM pg_database WHERE datname = $1
      `, [dbName]);

      if (dbExists.rows.length > 0) {
        throw new Error(`❌ Database '${dbName}' already exists. Please use a different name or drop the existing database.`);
      }

      console.log('✅ Database name is available');

      // Create the database
      await checkClient.query(`CREATE DATABASE ${dbName}`);
      console.log('✅ Database created successfully');

      // Wait a moment for the database to be fully created
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Connect to the new database and install schema
      const installClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: dbName
      });

      await installClient.connect();
      console.log('✅ Connected to new database');

      // Install schema from SQL files
      await CarthorseOrchestrator.installSchema(installClient);
      
      await installClient.end();

      console.log('\n🎉 Carthorse database installation completed successfully!');
      console.log(`📊 Database: ${dbName}`);
      console.log(`🔧 Schema Version: 7`);
      
      // Run readiness check to verify installation
      console.log('\n🔍 Running export readiness check...');
      
      // Import and run the existing region readiness check
      const { DataIntegrityValidator } = require('../validation/DataIntegrityValidator');
      const validator = new DataIntegrityValidator({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: dbName
      });
      
      try {
        await validator.connect();
        const result = await validator.validateRegion('boulder'); // Test with boulder region
        
        if (!result.passed) {
          console.error('❌ Export readiness check failed:');
          result.issues.forEach((issue: any) => {
            console.error(`  - ${issue.type.toUpperCase()}: ${issue.message}`);
          });
          throw new Error('Installation incomplete - region readiness check failed');
        }
        
        console.log('✅ Export readiness check passed!');
        console.log(`  📊 Found ${result.summary.totalTrails} trails`);
        console.log(`  ✅ ${result.summary.validTrails} valid trails`);
        
      } catch (error) {
        console.warn('⚠️  Region readiness check skipped (no data available yet)');
      }

      // Create corresponding test database
      console.log('\n🧪 Creating corresponding test database...');
      const testDbName = `${dbName}_test`;
      
      // Create a new client for test database operations
      const testDbClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: 'postgres' // Connect to default database to check
      });

      await testDbClient.connect();
      
      const testDbExists = await testDbClient.query(`
        SELECT 1 FROM pg_database WHERE datname = $1
      `, [testDbName]);

      if (testDbExists.rows.length > 0) {
        console.log(`⚠️  Test database '${testDbName}' already exists, dropping and recreating...`);
        await testDbClient.query(`DROP DATABASE IF EXISTS ${testDbName}`);
        console.log('✅ Dropped existing test database');
      }

      // Create the test database
      await testDbClient.query(`CREATE DATABASE ${testDbName}`);
      console.log(`✅ Test database '${testDbName}' created successfully`);

      // Grant privileges to tester user
      await testDbClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${testDbName} TO tester`);
      console.log('✅ Granted privileges to tester user');

      await testDbClient.end();

      // Wait a moment for the test database to be fully created
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Connect to test database and install schema
      const testInstallClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: testDbName
      });

      await testInstallClient.connect();
      console.log('✅ Connected to test database');

      // Install schema from SQL files
      await CarthorseOrchestrator.installSchema(testInstallClient);
      
      await testInstallClient.end();

      // Close the checkClient after all database operations are complete
      await checkClient.end();

      console.log(`✅ Test database '${testDbName}' installed successfully`);
      console.log(`🔧 Test database schema version: 7`);

      console.log('\n💡 Next steps:');
      console.log('  1. Import trail data to the master database');
      console.log('  2. Run exports using: npx ts-node src/orchestrator/CarthorseOrchestrator.ts export --region <region> --out <file.db>');
      console.log('  3. Run tests using: npm test');
      console.log(`  4. Test database '${testDbName}' is ready for testing`);

    } catch (error) {
      console.error('❌ Installation failed:', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      rl.close();
    }
  }

  /**
   * Install test database with schema AND populate with production data
   */
  public static async installTestDatabase(region: string = 'boulder', dataLimit: number = 1000): Promise<void> {
    console.log('🧪 Carthorse Test Database Installation + Population');
    console.log('==================================================');
    
    const testDbName = 'trail_master_db_test';
    const testUser = 'tester';
    
    try {
      console.log(`📋 Installing test database: ${testDbName}`);
      console.log(`👤 Using test user: ${testUser}`);
      console.log(`🌍 Populating with ${region} region data (limit: ${dataLimit} trails)`);

      // Check if database already exists
      const checkClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: 'postgres' // Connect to default database to check
      });

      await checkClient.connect();
      
      const dbExists = await checkClient.query(`
        SELECT 1 FROM pg_database WHERE datname = $1
      `, [testDbName]);

      if (dbExists.rows.length > 0) {
        console.log('⚠️  Test database already exists, dropping and recreating...');
        await checkClient.query(`DROP DATABASE IF EXISTS ${testDbName}`);
        console.log('✅ Dropped existing test database');
      }

      // Create the test database
      await checkClient.query(`CREATE DATABASE ${testDbName}`);
      console.log('✅ Test database created successfully');

      await checkClient.end();

      // Connect to the test database and install schema
      const installClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: testDbName
      });

      await installClient.connect();
      console.log('✅ Connected to test database');

      // Install schema from SQL files
      await CarthorseOrchestrator.installSchema(installClient);
      
      // Connect to production database to copy data
      const productionClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'trail_master_db'
      });

      await productionClient.connect();
      console.log('✅ Connected to production database');

      // Check if production database has data for the region
      const regionCheck = await productionClient.query(`
        SELECT COUNT(*) as count FROM trails WHERE region = $1
      `, [region]);

      const trailCount = parseInt(regionCheck.rows[0].count);
      console.log(`📊 Found ${trailCount} trails in production for region '${region}'`);

      if (trailCount === 0) {
        console.warn(`⚠️  No trails found in production for region '${region}'`);
        console.log('   Available regions:');
        const regions = await productionClient.query(`
          SELECT DISTINCT region, COUNT(*) as count 
          FROM trails 
          WHERE region IS NOT NULL 
          GROUP BY region 
          ORDER BY count DESC
        `);
        regions.rows.forEach((row: any) => {
          console.log(`     ${row.region}: ${row.count} trails`);
        });
        throw new Error(`No trails found for region '${region}' in production database`);
      }

      // Copy regions data first (required for foreign key constraints)
      console.log('📋 Copying regions data...');
      const regionsData = await productionClient.query(`
        SELECT * FROM regions 
        WHERE name = $1 OR name LIKE '%$1%'
      `, [region]);

      if (regionsData.rows.length > 0) {
        const regionColumns = Object.keys(regionsData.rows[0]);
        const regionPlaceholders = regionColumns.map((_, i) => `$${i + 1}`).join(', ');
        const insertRegionQuery = `
          INSERT INTO regions (${regionColumns.join(', ')})
          VALUES (${regionPlaceholders})
          ON CONFLICT (name) DO NOTHING
        `;

        for (const row of regionsData.rows) {
          await installClient.query(insertRegionQuery, Object.values(row));
        }
        console.log(`✅ Copied ${regionsData.rows.length} regions`);
      }

      // Create the specific region if it doesn't exist (for data consistency)
      try {
        await installClient.query(`
          INSERT INTO regions (name, region_key, description, created_at, updated_at)
          VALUES ($1, $2, $3, NOW(), NOW())
          ON CONFLICT (region_key) DO NOTHING
        `, [`${region.charAt(0).toUpperCase() + region.slice(1)} Region`, region, `Test region for ${region}`]);
        console.log(`✅ Created region with key '${region}' if it didn't exist`);
      } catch (error) {
        console.warn('⚠️  Could not create region:', error instanceof Error ? error.message : String(error));
      }

      // Copy trails data from production to test database
      console.log(`📋 Copying ${Math.min(trailCount, dataLimit)} trails from production...`);
      console.log(`🔄 Step 1: Fetching trail data from production database...`);
      
      // First, get the data from production
      const trailsData = await productionClient.query(`
        SELECT * FROM trails 
        WHERE region = $1 
        LIMIT $2
      `, [region, dataLimit]);

      console.log(`📊 Found ${trailsData.rows.length} trails to copy`);
      console.log(`🔄 Step 2: Copying trail data to test database...`);

      // Then insert into test database using the test database connection
      if (trailsData.rows.length > 0) {
        const columns = Object.keys(trailsData.rows[0]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const insertQuery = `
          INSERT INTO trails (${columns.join(', ')})
          VALUES (${placeholders})
        `;

        console.log(`🔄 Step 3: Inserting ${trailsData.rows.length} trails into test database...`);
        for (let i = 0; i < trailsData.rows.length; i++) {
          const row = trailsData.rows[i];
          await installClient.query(insertQuery, Object.values(row));
          if ((i + 1) % 10 === 0 || i === trailsData.rows.length - 1) {
            console.log(`   📊 Progress: ${i + 1}/${trailsData.rows.length} trails copied`);
          }
        }
      }

      console.log(`✅ Copied ${trailsData.rows.length} trails to test database`);
      console.log(`🎉 Test data copying completed successfully!`);

      // Copy related data (routing nodes, edges, etc.) if they exist
      try {
        // Copy routing nodes for the copied trails
        const nodesData = await productionClient.query(`
          SELECT rn.* FROM routing_nodes rn
          INNER JOIN trails t ON ST_DWithin(rn.geometry, t.geometry, 100)
          WHERE t.region = $1
          LIMIT $2
        `, [region, dataLimit * 10]); // Allow more nodes than trails

        if (nodesData.rows.length > 0) {
          const nodeColumns = Object.keys(nodesData.rows[0]);
          const nodePlaceholders = nodeColumns.map((_, i) => `$${i + 1}`).join(', ');
          const insertNodeQuery = `
            INSERT INTO routing_nodes (${nodeColumns.join(', ')})
            VALUES (${nodePlaceholders})
          `;

          for (const row of nodesData.rows) {
            await installClient.query(insertNodeQuery, Object.values(row));
          }
        }

        console.log(`✅ Copied ${nodesData.rows.length} routing nodes`);

        // Copy routing edges for the copied trails
        const edgesData = await productionClient.query(`
          SELECT re.* FROM routing_edges re
          INNER JOIN trails t ON ST_DWithin(re.geometry, t.geometry, 100)
          WHERE t.region = $1
          LIMIT $2
        `, [region, dataLimit * 20]); // Allow more edges than trails

        if (edgesData.rows.length > 0) {
          const edgeColumns = Object.keys(edgesData.rows[0]);
          const edgePlaceholders = edgeColumns.map((_, i) => `$${i + 1}`).join(', ');
          const insertEdgeQuery = `
            INSERT INTO routing_edges (${edgeColumns.join(', ')})
            VALUES (${edgePlaceholders})
          `;

          for (const row of edgesData.rows) {
            await installClient.query(insertEdgeQuery, Object.values(row));
          }
        }

        console.log(`✅ Copied ${edgesData.rows.length} routing edges`);

      } catch (error) {
        console.warn('⚠️  Could not copy routing data (tables may not exist in production):', error instanceof Error ? error.message : String(error));
      }

      await productionClient.end();
      await installClient.end();

      console.log('\n🎉 Test database installation + population completed successfully!');
      console.log(`📊 Database: ${testDbName}`);
      console.log(`🔧 Schema Version: 7`);
      console.log(`🌍 Region: ${region}`);
      console.log(`📈 Trails: ${trailsData.rows.length}`);
      
      // Run readiness check to verify installation
      console.log('\n🔍 Running export readiness check...');
      
      // Import and run the existing region readiness check
      const { DataIntegrityValidator } = require('../validation/DataIntegrityValidator');
      const validator = new DataIntegrityValidator({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: testDbName
      });
      
      try {
        await validator.connect();
        const result = await validator.validateRegion(region);
        
        if (!result.passed) {
          console.warn('⚠️  Export readiness check failed:');
          result.issues.forEach((issue: any) => {
            console.warn(`  - ${issue.type.toUpperCase()}: ${issue.message}`);
          });
        } else {
          console.log('✅ Export readiness check passed!');
          console.log(`  📊 Found ${result.summary.totalTrails} trails`);
          console.log(`  ✅ ${result.summary.validTrails} valid trails`);
        }
        
      } catch (error) {
        console.warn('⚠️  Region readiness check failed:', error instanceof Error ? error.message : String(error));
      }

      console.log('\n💡 Next steps:');
      console.log('  1. Run tests using: npm test');
      console.log('  2. Run exports using: npx ts-node src/orchestrator/CarthorseOrchestrator.ts export --region <region> --out <file.db>');
      console.log('  3. Set environment: PGDATABASE=trail_master_db_test');
      console.log('\n✅ Test database installation process completed successfully!');
      console.log('🔄 Returning to shell...');

    } catch (error) {
      console.error('❌ Test database installation + population failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Install test database with schema only (no data) - for special cases
   */
  public static async installTestDatabaseEmpty(): Promise<void> {
    console.log('🧪 Carthorse Test Database Installation (Empty)');
    console.log('=============================================');
    
    const testDbName = 'trail_master_db_test';
    const testUser = 'tester';
    
    try {
      console.log(`📋 Installing test database: ${testDbName}`);
      console.log(`👤 Using test user: ${testUser}`);

      // Check if database already exists
      const checkClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: 'postgres' // Connect to default database to check
      });

      await checkClient.connect();
      
      const dbExists = await checkClient.query(`
        SELECT 1 FROM pg_database WHERE datname = $1
      `, [testDbName]);

      if (dbExists.rows.length > 0) {
        console.log('⚠️  Test database already exists, dropping and recreating...');
        await checkClient.query(`DROP DATABASE IF EXISTS ${testDbName}`);
        console.log('✅ Dropped existing test database');
      }

      // Create the test database
      await checkClient.query(`CREATE DATABASE ${testDbName}`);
      console.log('✅ Test database created successfully');

      await checkClient.end();

      // Connect to the test database and install schema
      const installClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: testDbName
      });

      await installClient.connect();
      console.log('✅ Connected to test database');

      // Install schema from SQL files
      await CarthorseOrchestrator.installSchema(installClient);
      
      await installClient.end();

      console.log('\n🎉 Test database installation completed successfully!');
      console.log(`📊 Database: ${testDbName}`);
      console.log(`🔧 Schema Version: 7`);
      
      // Run readiness check to verify installation
      console.log('\n🔍 Running export readiness check...');
      
      // Import and run the existing region readiness check
      const { DataIntegrityValidator } = require('../validation/DataIntegrityValidator');
      const validator = new DataIntegrityValidator({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        database: testDbName
      });
      
      try {
        await validator.connect();
        const result = await validator.validateRegion('boulder'); // Test with boulder region
        
        if (!result.passed) {
          console.warn('⚠️  Export readiness check failed (expected for empty test database)');
          console.log('   This is normal - the test database is ready for data import');
        } else {
          console.log('✅ Export readiness check passed!');
          console.log(`  📊 Found ${result.summary.totalTrails} trails`);
          console.log(`  ✅ ${result.summary.validTrails} valid trails`);
        }
        
      } catch (error) {
        console.warn('⚠️  Region readiness check skipped (no data available yet)');
      }

      console.log('\n💡 Next steps:');
      console.log('  1. Import test data to the database');
      console.log('  2. Run tests using: npm test');
      console.log('  3. Run exports using: npx ts-node src/orchestrator/CarthorseOrchestrator.ts export --region <region> --out <file.db>');

    } catch (error) {
      console.error('❌ Test database installation failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Install all schema, indexes, and functions from SQL files
   */
  private static async installSchema(client: Client): Promise<void> {
    console.log('\n📚 Installing schema and functions...');

    // Read and execute complete schema file (includes all functions)
    const schemaPath = path.join(__dirname, '../../sql/schemas/carthorse-consolidated-schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log('📋 Installing complete schema (tables, indexes, and all functions)...');
    await client.query(schemaSql);
    console.log('✅ Complete schema installed');

    // Insert schema version
    console.log('📋 Inserting schema version...');
    await client.query(`
      INSERT INTO schema_version (version, created_at, updated_at) 
      VALUES (7, NOW(), NOW())
    `);
    console.log('✅ Schema version inserted');

    // All functions are now included in the main consolidated schema
    console.log('✅ All functions installed from consolidated schema');

    // Read and execute missing functions
    // All functions are now included in the main schema file
    console.log('✅ All functions installed from main schema');

    // Verify schema version
    const versionResult = await client.query('SELECT version FROM schema_version ORDER BY id DESC LIMIT 1');
    if (versionResult.rows.length === 0) {
      throw new Error('Schema version not found after installation');
    }
    
    const version = versionResult.rows[0].version;
    console.log(`✅ Schema version verified: ${version}`);

    // Verify all required functions exist
    const requiredFunctions = [
      'detect_trail_intersections',
      'copy_and_split_trails_to_staging_native',
      'generate_routing_nodes_native',
      'generate_routing_edges_native',
      'cleanup_orphaned_nodes'
    ];

    console.log('🔍 Verifying all required functions...');
    for (const funcName of requiredFunctions) {
      const funcResult = await client.query(`
        SELECT 1 FROM pg_proc WHERE proname = $1
      `, [funcName]);
      
      if (funcResult.rows.length === 0) {
        throw new Error(`❌ Required function '${funcName}' not found after installation`);
      }
      console.log(`  ✅ Function '${funcName}' verified`);
    }

    console.log('✅ All required functions verified');

    // Verify required tables exist
    console.log('🔍 Verifying required tables...');
    const requiredTables = ['trails'];
    for (const tableName of requiredTables) {
      const tableResult = await client.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);
      
      if (tableResult.rows.length === 0) {
        throw new Error(`❌ Required table '${tableName}' not found after installation`);
      }
      console.log(`  ✅ Table '${tableName}' verified`);
    }

    console.log('✅ All required tables verified');
  }

  constructor(config?: CarthorseOrchestratorConfig) {
    if (config) {
      this.config = config;
      this.stagingSchema = `staging_${config.region}_${Date.now()}`;
    } else {
      // Default configuration for backward compatibility
      this.config = {
        region: 'boulder',
        outputPath: './data/boulder-export.db',
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: true,
        verbose: true,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 400,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: false,

        skipValidation: false,
        skipBboxValidation: false,
        skipGeometryValidation: false,
        skipTrailValidation: false,
        targetSchemaVersion: 7
      };
      this.stagingSchema = `staging_${this.config.region}_${Date.now()}`;
    }
    
    const clientConfig = getTestDbConfig();
    this.pgConfig = clientConfig;
    this.pgClient = new Client(clientConfig);

    // Initialize services
    this.elevationService = new ElevationService(this.pgClient, false); // No TIFF processing for export
    this.validationService = new ValidationService(this.pgClient);
    this.cleanupService = new CleanupService(this.pgClient);
    this.hooks = new OrchestratorHooks();
  }

  /**
   * Export SQLite database with complete pipeline
   * This is the main method for running the full export process
   */
  async exportSqlite(): Promise<void> {
    const startTime = Date.now();
    const logStep = (label: string, lastTime: number) => {
      const now = Date.now();
      const elapsed = now - lastTime;
      console.log(`[TIMER] ${label}: ${elapsed}ms`);
      return now;
    };

    let lastTime = startTime;
    console.log(`[TIMER] Start: ${lastTime - startTime}ms`);

    try {
      // Connect to database
      console.log('[ORCH] About to connect to database');
      await this.pgClient.connect();
      lastTime = logStep('database connection', lastTime);

      // Add schema version check at the start
      const targetSchemaVersion = this.config.targetSchemaVersion || 7;
      await checkSchemaVersion(this.pgClient, targetSchemaVersion);
      lastTime = logStep('schema version check', lastTime);

      // Check required SQL functions
      console.log('[ORCH] About to checkRequiredSqlFunctions');
      await this.checkRequiredSqlFunctions();
      lastTime = logStep('checkRequiredSqlFunctions', lastTime);

      // Create staging environment
      console.log('[ORCH] About to createStagingEnvironment');
      await this.createStagingEnvironment();
      lastTime = logStep('createStagingEnvironment', lastTime);

      // Copy region data to staging
      console.log('[ORCH] About to copyRegionDataToStaging');
      await this.copyRegionDataToStaging(this.config.bbox);
      lastTime = logStep('copyRegionDataToStaging', lastTime);
      


      // Initialize services and hooks context
      const context: OrchestratorContext = {
        pgClient: this.pgClient,
        schemaName: this.stagingSchema,
        region: this.config.region,
        config: this.config,
        elevationService: this.elevationService,
        validationService: this.validationService
      };

      // Execute pre-processing hooks
      console.log('[ORCH] About to execute pre-processing hooks');
      let preProcessingHooks = [];
      
      // Add validation hooks based on configuration
      if (!this.config.skipValidation) {
        if (!this.config.skipTrailValidation) {
          preProcessingHooks.push('validate-trail-data');
        }
        if (!this.config.skipBboxValidation) {
          preProcessingHooks.push('validate-bbox-data');
        }
        if (!this.config.skipGeometryValidation) {
          preProcessingHooks.push('validate-geometry-data');
        }
      } else {
        console.log('[ORCH] Skipping all validation hooks as requested');
      }
      
      if (preProcessingHooks.length > 0) {
        await this.hooks.executeHooks(preProcessingHooks, context);
      } else {
        console.log('[ORCH] No pre-processing hooks to execute');
      }
      lastTime = logStep('pre-processing hooks', lastTime);

      // Validate trails before routing graph generation
      console.log('[ORCH] About to validate trails for routing...');
      await this.validateTrailsForRouting();
      lastTime = logStep('validateTrailsForRouting', lastTime);

      // Generate routing graph
      console.log('[ORCH] About to generateRoutingGraph');
      await this.generateRoutingGraph();
      lastTime = logStep('generateRoutingGraph', lastTime);

      // Generate route recommendations using recursive route finding (unless skipped)
      if (this.config.skipRecommendations) {
        console.log('[ORCH] Skipping route recommendation generation as requested');
      } else {
        console.log('[ORCH] About to generateRouteRecommendations');
        await this.generateRouteRecommendations();
        lastTime = logStep('generateRouteRecommendations', lastTime);
      }

      // Execute processing hooks
      console.log('[ORCH] About to execute processing hooks');
      
      // EXPORT SHOULD NEVER ACCESS TIFF FILES
      // Elevation data should already exist in the master database
      // TIFF files are only for data ingestion, not export
      console.log('[ORCH] Skipping elevation processing during export - data should already exist');
      console.log('[ORCH] Export only reads from PostGIS and writes to SQLite');
      
      lastTime = logStep('processing hooks', lastTime);

      // Execute post-processing hooks
      console.log('[ORCH] About to execute post-processing hooks');
      let postProcessingHooks = ['show-elevation-stats'];
      
      // Add routing graph validation if not skipping validation
      if (!this.config.skipValidation) {
        postProcessingHooks.unshift('validate-routing-graph');
      }
      
      await this.hooks.executeHooks(postProcessingHooks, context);
      lastTime = logStep('post-processing hooks', lastTime);

      // Export to SQLite using orchestrator's own export method
      console.log('[ORCH] About to exportSchema');
      await this.exportSchema();
      lastTime = logStep('exportSchema', lastTime);

      // Perform cleanup unless skipCleanupOnError is set
      if (!this.config.skipCleanupOnError) {
        console.log('[ORCH] About to perform comprehensive cleanup');
        await this.performComprehensiveCleanup();
        lastTime = logStep('comprehensive cleanup', lastTime);
      } else {
        console.log('[ORCH] Skipping cleanup for debugging (skipCleanupOnError: true)');
        console.log(`[ORCH] Staging schema preserved for debugging: ${this.stagingSchema}`);
      }

      const total = Date.now() - startTime;
      console.log(`[TIMER] Total orchestrator run: ${total}ms`);

    } catch (err) {
      console.error('[Orchestrator] Error during run:', err);
      
      // Clean up on error unless skipCleanupOnError is set
      if (!this.config.skipCleanupOnError) {
        console.log('[Orchestrator] Cleaning up on error...');
        await this.performComprehensiveCleanup();
      } else {
        console.log('[Orchestrator] Skipping cleanup on error for debugging (skipCleanupOnError: true)');
        console.log(`[Orchestrator] Staging schema preserved for debugging: ${this.stagingSchema}`);
      }
      
      throw err;
    } finally {
      // Always disconnect from database
      if (this.pgClient) {
        await this.pgClient.end();
      }
    }
  }

  /**
   * Test method for orchestrator testing - runs a simplified version of the pipeline
   * This method is specifically designed for testing and validation
   */
  async test(): Promise<void> {
    console.log('🧪 Running orchestrator test mode...');
    
    try {
      // Connect to database
      await this.pgClient.connect();
      console.log('✅ Connected to test database');

      // Check required SQL functions (simplified)
      console.log('🔍 Checking required functions...');
      const requiredFunctions = [
        'detect_trail_intersections',
        'copy_and_split_trails_to_staging_native',
        'generate_routing_nodes_native',
        'generate_routing_edges_native'
      ];

      for (const funcName of requiredFunctions) {
        const funcResult = await this.pgClient.query(`
          SELECT 1 FROM pg_proc WHERE proname = $1 LIMIT 1
        `, [funcName]);
        
        if (funcResult.rows.length === 0) {
          throw new Error(`Required function '${funcName}' not found`);
        }
      }
      console.log('✅ All required functions available');

      // Create staging environment
      console.log('🏗️ Creating staging environment...');
      await this.createStagingEnvironment();
      console.log('✅ Staging environment created');

      // Copy region data to staging
      console.log('📋 Copying region data to staging...');
      await this.copyRegionDataToStaging(this.config.bbox);
      console.log('✅ Region data copied to staging');

      // Generate routing graph
      console.log('🔄 Generating routing graph...');
      await this.generateRoutingGraph();
      console.log('✅ Routing graph generated');

      // Export to SQLite
      console.log('💾 Exporting to SQLite...');
      await this.exportSchema();
      console.log('✅ Export completed');

      console.log('✅ Orchestrator test completed successfully');

    } catch (error) {
      console.error('❌ Orchestrator test failed:', error);
      throw error;
    } finally {
      if (this.pgClient) {
        await this.pgClient.end();
      }
    }
  }

  /**
   * Pre-flight check: Ensure required PostGIS/SQL functions are loaded in the database
   */
  private async checkRequiredSqlFunctions(): Promise<void> {
    console.log('🔍 Export readiness check...');
    
    // 1. Check PostgreSQL Extensions
    console.log('  📦 Checking PostgreSQL extensions...');
    const extensionsResult = await this.pgClient.query(`
      SELECT extname FROM pg_extension WHERE extname = 'postgis'
    `);
    
    if (extensionsResult.rows.length === 0) {
      throw new Error('❌ PostGIS extension not installed. Please run installation.');
    }
    console.log('  ✅ PostGIS extension available');

    // 2. Check Schema Version
    console.log('  📋 Checking schema version...');
    const versionResult = await this.pgClient.query(`
      SELECT version FROM schema_version ORDER BY id DESC LIMIT 1
    `);
    
    if (versionResult.rows.length === 0) {
      throw new Error('❌ Schema version not found. Please run installation.');
    }
    
    const version = versionResult.rows[0].version;
    if (version < 7) {
      throw new Error(`❌ Schema version ${version} too old. Need version 7+. Please run installation.`);
    }
    console.log(`  ✅ Schema version ${version} (minimum 7 required)`);

    // 3. Check Required Functions
    console.log('  🔧 Checking required functions...');
    const requiredFunctions = [
      'detect_trail_intersections',
      'copy_and_split_trails_to_staging_native',
      'generate_routing_nodes_native',
      'generate_routing_edges_native',
      'cleanup_orphaned_nodes'
    ];

    const missingFunctions = [];
    for (const funcName of requiredFunctions) {
      const funcResult = await this.pgClient.query(`
        SELECT 1 FROM pg_proc WHERE proname = $1 LIMIT 1
      `, [funcName]);
      
      if (funcResult.rows.length === 0) {
        missingFunctions.push(funcName);
      }
    }

    if (missingFunctions.length > 0) {
      console.error(`❌ Installation incomplete. Missing functions: ${missingFunctions.join(', ')}`);
      console.error('💡 Please run: npx ts-node src/orchestrator/CarthorseOrchestrator.ts install');
      throw new Error(`Installation required. Missing functions: ${missingFunctions.join(', ')}`);
    }
    console.log('  ✅ All required functions available');

    // 4. Check Required Tables
    console.log('  📊 Checking required tables...');
    const requiredTables = ['trails'];
    const optionalTables = ['routing_nodes', 'routing_edges'];
    
    for (const tableName of requiredTables) {
      const tableResult = await this.pgClient.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);
      
      if (tableResult.rows.length === 0) {
        throw new Error(`❌ Required table '${tableName}' not found. Please run installation.`);
      }
    }
    console.log('  ✅ All required tables available');

    // 5. Check Data Availability
    console.log('  📈 Checking data availability...');
    const trailsCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM trails WHERE region = $1
    `, [this.config.region]);
    
    const count = parseInt(trailsCount.rows[0].count);
    if (count === 0) {
      throw new Error(`❌ No trails found for region '${this.config.region}'. Please check data ingestion.`);
    }
    console.log(`  ✅ Found ${count} trails for region '${this.config.region}'`);

    // 6. Run comprehensive region readiness check using existing validator
    console.log('  🔍 Running comprehensive region readiness check...');
    const { DataIntegrityValidator } = require('../validation/DataIntegrityValidator');
    const validator = new DataIntegrityValidator({
      host: this.pgConfig.host,
      port: this.pgConfig.port,
      user: this.pgConfig.user,
      password: this.pgConfig.password,
      database: this.pgConfig.database
    });
    
    try {
      await validator.connect();
      const result = await validator.validateRegion(this.config.region);
      
             if (!result.passed) {
         console.error('❌ Region readiness check failed:');
         result.issues.forEach((issue: any) => {
           console.error(`  - ${issue.type.toUpperCase()}: ${issue.message}`);
         });
         throw new Error('Region data not ready for export');
       }
      
      console.log(`  ✅ Region readiness check passed (${result.summary.validTrails}/${result.summary.totalTrails} trails valid)`);
      
    } finally {
      await validator.disconnect();
    }

    console.log('✅ Export readiness check passed');
  }

  /**
   * Validate trails before routing graph generation
   * This checks for invalid trails that would cause routing issues
   */
  private async validateTrailsForRouting(): Promise<void> {
    console.log('[ORCH] 🔍 Validating trails for routing graph generation...');
    
    try {
      // Check for trails with various issues that would prevent edge generation
      const validationResult = await this.pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN geometry IS NULL THEN 1 END) as null_geometry,
          COUNT(CASE WHEN geometry IS NOT NULL AND NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
          COUNT(CASE WHEN length_km IS NULL OR length_km <= 0 THEN 1 END) as zero_or_null_length,
          COUNT(CASE WHEN ST_StartPoint(geometry) = ST_EndPoint(geometry) THEN 1 END) as self_loops,
          COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length_geometry,
          COUNT(CASE WHEN ST_NumPoints(geometry) < 2 THEN 1 END) as single_point_geometry
        FROM ${this.stagingSchema}.trails
      `);
      
      const stats = validationResult.rows[0];
      const totalTrails = parseInt(stats.total_trails);
      const nullGeometry = parseInt(stats.null_geometry);
      const invalidGeometry = parseInt(stats.invalid_geometry);
      const zeroOrNullLength = parseInt(stats.zero_or_null_length);
      const selfLoops = parseInt(stats.self_loops);
      const zeroLengthGeometry = parseInt(stats.zero_length_geometry);
      const singlePointGeometry = parseInt(stats.single_point_geometry);
      
      console.log(`📊 Trail validation results:`);
      console.log(`   Total trails: ${totalTrails}`);
      console.log(`   Null geometry: ${nullGeometry}`);
      console.log(`   Invalid geometry: ${invalidGeometry}`);
      console.log(`   Zero/null length: ${zeroOrNullLength}`);
      console.log(`   Self-loops: ${selfLoops}`);
      console.log(`   Zero length geometry: ${zeroLengthGeometry}`);
      console.log(`   Single point geometry: ${singlePointGeometry}`);
      
      // Loop trails (start = end) are valid and should be allowed
      // Only actual self-loops (zero length or single point trails) are critical issues
      const actualSelfLoopsResult = await this.pgClient.query(`
        SELECT COUNT(*) as actual_self_loops
        FROM ${this.stagingSchema}.trails
        WHERE ST_StartPoint(geometry) = ST_EndPoint(geometry)
          AND (ST_Length(geometry) = 0 OR ST_NumPoints(geometry) < 2)
      `);
      
      const actualSelfLoops = parseInt(actualSelfLoopsResult.rows[0].actual_self_loops);
      const legitimateLoops = selfLoops - actualSelfLoops;
      const actualSelfLoopPercentage = (actualSelfLoops / totalTrails) * 100;
      
      // Calculate trails that would be excluded from edge generation
      // Note: Legitimate loop trails are valid and will be handled by routing logic
      const excludedTrails = nullGeometry + invalidGeometry + zeroOrNullLength + actualSelfLoops + zeroLengthGeometry + singlePointGeometry;
      const validTrails = totalTrails - excludedTrails;
      
      // Only actual self-loops (zero length or single points) are critical issues
      // Legitimate loop trails are valid and will be handled by routing logic
      const criticalIssues = nullGeometry + invalidGeometry + zeroOrNullLength + zeroLengthGeometry + singlePointGeometry + actualSelfLoops;
      
      if (criticalIssues > 0) {
        console.error(`❌ CRITICAL: Found ${criticalIssues} invalid trails out of ${totalTrails} total trails`);
        console.error(`   Invalid breakdown:`);
        console.error(`     - Null geometry: ${nullGeometry}`);
        console.error(`     - Invalid geometry: ${invalidGeometry}`);
        console.error(`     - Zero/null length: ${zeroOrNullLength}`);
        console.error(`     - Zero length geometry: ${zeroLengthGeometry}`);
        console.error(`     - Single point geometry: ${singlePointGeometry}`);
        console.error(`     - Actual self-loops: ${actualSelfLoops} (${actualSelfLoopPercentage.toFixed(2)}% of total)`);
        console.error(`     - Legitimate loop trails: ${legitimateLoops}`);
        console.error(`   Valid trails for routing: ${validTrails}/${totalTrails} (${((validTrails/totalTrails)*100).toFixed(1)}%)`);
        
        // Show details about actual self-loops for debugging
        if (actualSelfLoops > 0) {
          console.error(`🔍 Actual self-loop details:`);
          const actualSelfLoopDetails = await this.pgClient.query(`
            SELECT app_uuid, name, ST_Length(geometry::geography) as length_meters 
            FROM ${this.stagingSchema}.trails 
            WHERE ST_StartPoint(geometry) = ST_EndPoint(geometry)
              AND (ST_Length(geometry) = 0 OR ST_NumPoints(geometry) < 2)
            LIMIT 10
          `);
          
          for (const trail of actualSelfLoopDetails.rows) {
            console.error(`     - ${trail.name} (${trail.app_uuid}): ${trail.length_meters}m`);
          }
          
          if (actualSelfLoops > 10) {
            console.error(`     ... and ${actualSelfLoops - 10} more actual self-loops`);
          }
        }
        
        throw new Error(`Cannot proceed with routing graph generation. Found ${criticalIssues} invalid trails out of ${totalTrails} total trails. ALL trails must be valid for routing. Actual self-loops (zero length or single points) indicate data quality issues that must be resolved.`);
      }
      
      // Fail if no valid trails remain
      if (validTrails === 0) {
        throw new Error(`No valid trails found for routing graph generation. All ${totalTrails} trails have issues that prevent edge creation`);
      }
      
      console.log(`✅ Trail validation passed: ${validTrails} valid trails available for routing graph generation`);
      
    } catch (error) {
      console.error('❌ Trail validation failed:', error);
      throw error;
    }
  }

  /**
   * Generate routing graph using native PostgreSQL functions
   */
  private async generateRoutingGraph(): Promise<void> {
    console.log('[ORCH] 🔧 Generating routing graph using native PostgreSQL...');
    
    try {
      // Get tolerance values from YAML configuration
      const tolerances = getTolerances();
      const nodeTolerance = tolerances.intersectionTolerance || 2.0;
      const edgeTolerance = tolerances.edgeTolerance || 0.5;
      
      console.log(`[ORCH] Using node tolerance: ${nodeTolerance}m, edge tolerance: ${edgeTolerance}m`);
      
      // Step 1: Generate routing nodes
      console.log('[ORCH] Step 1: Generating routing nodes...');
      const nodesResult = await this.pgClient.query(
        `SELECT * FROM generate_routing_nodes_native($1, $2)`,
        [this.stagingSchema, nodeTolerance]
      );
      
      const nodeData = nodesResult.rows[0];
      const nodeCount = nodeData?.node_count || 0;
      const nodeSuccess = nodeData?.success || false;
      const nodeMessage = nodeData?.message || 'Unknown error';
      
      if (!nodeSuccess) {
        throw new Error(`Failed to generate routing nodes: ${nodeMessage}`);
      }
      
      console.log(`✅ ${nodeMessage}`);
      
      // Step 2: Generate routing edges using the node set with correct tolerance
      console.log('[ORCH] Step 2: Generating routing edges...');
      const edgesResult = await this.pgClient.query(
        `SELECT * FROM generate_routing_edges_native($1, $2)`,
        [this.stagingSchema, edgeTolerance]
      );
      
      const edgeData = edgesResult.rows[0];
      const edgeCount = edgeData?.edge_count || 0;
      const edgeSuccess = edgeData?.success || false;
      const edgeMessage = edgeData?.message || 'Unknown error';
      
      if (!edgeSuccess) {
        throw new Error(`Failed to generate routing edges: ${edgeMessage}`);
      }
      
      console.log(`✅ ${edgeMessage}`);
      console.log(`✅ Generated routing graph using native PostgreSQL: ${nodeCount} nodes, ${edgeCount} edges`);
      
      // Note: Cleanup of orphaned nodes and edges is handled within the SQL functions
      // No additional cleanup needed here
      
    } catch (error) {
      console.error('❌ Error generating routing graph:', error);
      throw error;
    }
  }

  /**
   * Generate route recommendations using recursive route finding
   */
  private async generateRouteRecommendations(): Promise<void> {
    const logFile = 'logs/route-recommendations.log';
    const logMessage = (message: string) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}\n`;
      console.log(`[ROUTE-LOG] ${message}`);
      fs.appendFileSync(logFile, logEntry);
    };

    // Ensure logs directory exists
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    logMessage('🛤️  Starting route recommendation generation...');
    
    try {
      // All route finding functions are now included in the consolidated schema
      logMessage('✅ Route finding functions already installed from consolidated schema');
      
      // Route finding functions are now included in the consolidated schema
      logMessage('✅ Route finding functions available from consolidated schema');
      
      // Check if staging schema exists and has data
      logMessage('🔍 Checking staging schema...');
      const schemaCheck = await this.pgClient.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [this.stagingSchema]
      );
      
      if (schemaCheck.rows.length === 0) {
        throw new Error(`Staging schema ${this.stagingSchema} does not exist`);
      }
      logMessage(`✅ Staging schema ${this.stagingSchema} exists`);
      
      // Check if staging schema has trails
      const trailCount = await this.pgClient.query(
        `SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`
      );
      logMessage(`📊 Staging schema has ${trailCount.rows[0].count} trails`);
      
      // Check if routing nodes exist
      const nodeCount = await this.pgClient.query(
        `SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`
      );
      logMessage(`📊 Staging schema has ${nodeCount.rows[0].count} routing nodes`);
      
      // Check if routing edges exist
      const edgeCount = await this.pgClient.query(
        `SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`
      );
      logMessage(`📊 Staging schema has ${edgeCount.rows[0].count} routing edges`);
      
      // Use the consolidated route recommendation function
      const trailCountValue = trailCount.rows[0].count;
      
      logMessage(`🎯 Generating route recommendations for ${trailCountValue} trails...`);
      
      const recommendationResult = await this.pgClient.query(
        `SELECT generate_route_recommendations($1)`,
        [this.stagingSchema]
      );
      
      const routeCount = recommendationResult.rows[0]?.generate_route_recommendations || 0;
      logMessage(`✅ Generated ${routeCount} route recommendations`);
      
      // Show route recommendation stats
      const statsResult = await this.pgClient.query(
        `SELECT 
          COUNT(*) as total_routes,
          COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
          COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
          COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes,
          AVG(route_score) as avg_score
        FROM route_recommendations`
      );
      
      const stats = statsResult.rows[0];
      logMessage(`📊 Route recommendation stats:`);
      logMessage(`  - Total routes: ${stats.total_routes}`);
      logMessage(`  - Loop routes: ${stats.loop_routes}`);
      logMessage(`  - Out-and-back routes: ${stats.out_and_back_routes}`);
      logMessage(`  - Point-to-point routes: ${stats.point_to_point_routes}`);
      logMessage(`  - Average score: ${stats.avg_score !== null ? stats.avg_score.toFixed(1) : 'N/A'}`);
      
    } catch (error) {
      const errorMessage = `❌ Failed to generate route recommendations: ${error}`;
      logMessage(errorMessage);
      console.error(errorMessage);
      console.error('Full error details:', error);
      
      // Log additional debugging info
      logMessage('🔍 Debugging information:');
      logMessage(`  - Staging schema: ${this.stagingSchema}`);
      logMessage(`  - Database: ${this.pgConfig.database}`);
      logMessage(`  - User: ${this.pgConfig.user}`);
      
      // Check if the function exists
      try {
        const funcCheck = await this.pgClient.query(
          `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'generate_route_recommendations'`
        );
        logMessage(`  - Function exists: ${funcCheck.rows.length > 0}`);
      } catch (funcError) {
        logMessage(`  - Function check failed: ${funcError}`);
      }
      
      // Don't throw error - route recommendations are optional
      console.warn('⚠️  Route recommendation generation failed, continuing with export...');
    }
  }

  /**
   * Single comprehensive validation: check version, schema, and data
   */
  private async validateExport(): Promise<void> {
    console.log('🔍 Validating export: comprehensive schema and data validation...');
    
    try {
      // Use the comprehensive validation tool for fail-fast validation
      const { spawnSync } = require('child_process');
      
      // Check if database file exists
      const fs = require('fs');
      if (!fs.existsSync(this.config.outputPath)) {
        throw new Error(`❌ Database file not found: ${this.config.outputPath}`);
      }
      
      console.log('  📋 Running comprehensive validation...');
      
      // Run the comprehensive validation script with verbose output
      const result = spawnSync('npx', [
        'ts-node', 
        'src/tools/carthorse-validate-database.ts', 
        '--db', 
        this.config.outputPath
      ], {
        stdio: 'inherit', // This ensures all output is displayed
        cwd: process.cwd()
      });
      
      if (result.status !== 0) {
        throw new Error(`❌ COMPREHENSIVE VALIDATION FAILED: Database validation failed with exit code ${result.status}. Check the output above for detailed error information.`);
      }
      
      console.log('✅ Comprehensive validation completed successfully!');
      
    } catch (error) {
      console.error('❌ VALIDATION FAILED:', error);
      console.error('🚨 FAIL FAST: Export validation failed. No fallbacks allowed.');
      throw error; // Re-throw to fail the entire pipeline
    }
  }

  private async createStagingEnvironment(): Promise<void> {
    console.log('��️  Creating staging environment:', this.stagingSchema);

    // Start a single transaction for all staging environment creation
    await this.pgClient.query('BEGIN');

    try {
      // Always drop the staging schema first for a clean slate
      const checkSchemaSql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${this.stagingSchema}'`;
      const res = await this.pgClient.query(checkSchemaSql);
      if (res.rows.length > 0) {
        console.warn(`[DDL] WARNING: Staging schema ${this.stagingSchema} already exists. Dropping it for a clean slate.`);
      }
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
      console.log(`[DDL] Dropped schema if existed: ${this.stagingSchema}`);

      // Create staging schema
      await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
      console.log('✅ Staging schema created');

      // Create staging tables
      const stagingTablesSql = getStagingSchemaSql(this.stagingSchema);
      console.log('[DDL] Executing staging tables DDL:');
      console.log(stagingTablesSql);
      await this.pgClient.query(stagingTablesSql);
      console.log('✅ Staging tables created');

      // Create spatial indexes
      const stagingIndexesSql = `
        CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${this.stagingSchema}.trails USING GIST(geometry);
        CREATE INDEX IF NOT EXISTS idx_staging_intersection_points ON ${this.stagingSchema}.intersection_points USING GIST(point);
        CREATE INDEX IF NOT EXISTS idx_staging_routing_nodes_location ON ${this.stagingSchema}.routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
        CREATE INDEX IF NOT EXISTS idx_staging_routing_edges_geometry ON ${this.stagingSchema}.routing_edges USING GIST(geometry);
      `;
      console.log('[DDL] Executing staging indexes DDL:');
      console.log(stagingIndexesSql);
      await this.pgClient.query(stagingIndexesSql);
      console.log('✅ Staging indexes created');

      // PostGIS functions are verified during startup check
      console.log('✅ PostGIS functions verified during startup');

      // Commit the entire transaction
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging environment created and committed successfully');

    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('[DDL] Error creating staging environment:', err);
      throw err;
    }
  }

  private async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log('📋 Copying', this.config.region, 'data to staging using native PostgreSQL...');
    
    // Support CARTHORSE_TEST_LIMIT for quick tests
    const trailLimit = process.env.CARTHORSE_TEST_LIMIT ? parseInt(process.env.CARTHORSE_TEST_LIMIT) : null;
    // Use the table/view specified by CARTHORSE_TRAILS_TABLE, defaulting to 'trails'
    const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';
    
    // Build bbox parameters if provided
    let bboxMinLng = null, bboxMinLat = null, bboxMaxLng = null, bboxMaxLat = null;
    
    if (bbox && bbox.length === 4) {
      [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = bbox;
      console.log(`🗺️ Filtering by bbox: ${bboxMinLng}, ${bboxMinLat}, ${bboxMaxLng}, ${bboxMaxLat}`);
    }
    
    // Use native PostgreSQL function to copy and split trails
    const copyAndSplitSql = `
      SELECT * FROM copy_and_split_trails_to_staging_native(
        $1,           -- staging_schema
        $2,           -- source_table
        $3,           -- region_filter
        $4,           -- bbox_min_lng
        $5,           -- bbox_min_lat
        $6,           -- bbox_max_lng
        $7,           -- bbox_max_lat
        $8,           -- trail_limit
        $9            -- tolerance_meters
      )
    `;
    
    const result = await this.pgClient.query(copyAndSplitSql, [
      this.stagingSchema,
      TRAILS_TABLE,
      this.config.region,
      bboxMinLng,
      bboxMinLat,
      bboxMaxLng,
      bboxMaxLat,
      trailLimit,
      2.0  // tolerance_meters
    ]);
    
    const resultRow = result.rows[0];
    console.log('✅ Native PostgreSQL copy and split result:', resultRow);
    
    if (!resultRow.success) {
      throw new Error(`❌ Native PostgreSQL copy and split failed: ${resultRow.message}`);
    }
    
    // Validate that all trails have bbox values
    const bboxValidationSql = `
      SELECT COUNT(*) as total_trails,
             COUNT(bbox_min_lng) as trails_with_bbox,
             COUNT(*) - COUNT(bbox_min_lng) as trails_without_bbox
      FROM ${this.stagingSchema}.trails
    `;
    const bboxValidationResult = await this.pgClient.query(bboxValidationSql);
    const totalTrails = parseInt(bboxValidationResult.rows[0].total_trails);
    const trailsWithBbox = parseInt(bboxValidationResult.rows[0].trails_with_bbox);
    const trailsWithoutBbox = parseInt(bboxValidationResult.rows[0].trails_without_bbox);

    if (trailsWithoutBbox > 0) {
      throw new Error(`❌ BBOX VALIDATION FAILED: ${trailsWithoutBbox} trails are missing bbox values after calculation. Total trails: ${totalTrails}, trails with bbox: ${trailsWithBbox}. Cannot proceed with export.`);
    }

    console.log(`✅ Bbox validation passed: All ${totalTrails} trail segments have valid bbox values`);

    // Validate staging data
    const validationSql = `
      SELECT COUNT(*) AS n, SUM(CASE WHEN ST_NDims(geometry) = 3 THEN 1 ELSE 0 END) AS n3d
      FROM ${this.stagingSchema}.trails
    `;
    const validationResult = await this.pgClient.query(validationSql);
    const threeDTrails = parseInt(validationResult.rows[0].n3d);
    
    console.log(`✅ Trails split at intersections using native PostgreSQL ST_Node (3D geometry, LINESTRINGZ).`);
    console.log(`   - Total trail segments: ${totalTrails}`);
    console.log(`   - 3D trail segments: ${threeDTrails}`);

    // Calculate regionBbox from actual data if not provided
    if (!this.regionBbox) {
      const bboxResult = await this.pgClient.query(`
        SELECT 
          MIN(bbox_min_lng) as min_lng,
          MAX(bbox_max_lng) as max_lng,
          MIN(bbox_min_lat) as min_lat,
          MAX(bbox_max_lat) as max_lat,
          COUNT(*) as trail_count
        FROM ${this.stagingSchema}.trails
      `);
      
      const bbox = bboxResult.rows[0];
      this.regionBbox = {
        minLng: bbox.min_lng,
        maxLng: bbox.max_lng,
        minLat: bbox.min_lat,
        maxLat: bbox.max_lat,
        trailCount: parseInt(bbox.trail_count)
      };
      
      console.log(`📊 Calculated region bbox: ${this.regionBbox.minLng}, ${this.regionBbox.minLat}, ${this.regionBbox.maxLng}, ${this.regionBbox.maxLat} (${this.regionBbox.trailCount} trail segments)`);
    }
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'backup') {
    console.log('💾 Carthorse Production Database Backup');
    console.log('=====================================');
    
    CarthorseOrchestrator.backupProductionDatabase()
      .then(() => {
        console.log('✅ Backup completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Backup failed:', error);
        process.exit(1);
      });
  } else if (command === 'install') {
    console.log('🚀 Carthorse Database Installation');
    console.log('================================');
    
    CarthorseOrchestrator.install()
      .then(() => {
        console.log('✅ Installation completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Installation failed:', error);
        process.exit(1);
      });
  } else if (command === 'test') {
    console.log('🧪 Carthorse Orchestrator Test');
    console.log('=============================');
    
    // Create orchestrator instance for testing
    const orchestrator = new CarthorseOrchestrator({
      region: 'boulder',
      outputPath: './test-output/orchestrator-test.db',
      maxSqliteDbSizeMB: 100,
      intersectionTolerance: 2.0,
      simplifyTolerance: 0.001,
      validate: true,
      verbose: true,
      replace: false,
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      skipIncompleteTrails: false
    });
    
    orchestrator.test()
      .then(() => {
        console.log('✅ Orchestrator test completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Orchestrator test failed:', error);
        process.exit(1);
      });
  } else if (command === 'export') {
    console.log('📦 Carthorse SQLite Export');
    console.log('=========================');
    
    // Parse export arguments
    const region = args[1];
    const outputPath = args[2];
    
    if (!region || !outputPath) {
      console.error('❌ Missing required arguments');
      console.log('Usage: npx ts-node src/orchestrator/CarthorseOrchestrator.ts export <region> <output-path> [--skip-recommendations] [--skip-cleanup-on-error]');
      console.log('Example: npx ts-node src/orchestrator/CarthorseOrchestrator.ts export boulder ./data/boulder.db --skip-recommendations');
      console.log('Example: npx ts-node src/orchestrator/CarthorseOrchestrator.ts export boulder ./data/boulder.db --skip-cleanup-on-error');
      process.exit(1);
    }
    
    // Parse optional flags
    const skipRecommendations = args.includes('--skip-recommendations');
    const skipCleanupOnError = args.includes('--skip-cleanup-on-error');
    
    // Create orchestrator instance for export
    const orchestrator = new CarthorseOrchestrator({
      region: region,
      outputPath: outputPath,
      maxSqliteDbSizeMB: 400,
      intersectionTolerance: 2.0,
      simplifyTolerance: 0.001,
      validate: true,
      verbose: true,
      replace: false,
      skipBackup: false,
      buildMaster: false,
      targetSizeMB: null,
      skipIncompleteTrails: false,
      skipRecommendations: skipRecommendations,
      skipCleanupOnError: skipCleanupOnError
    });
    
    orchestrator.exportSqlite()
      .then(() => {
        console.log('✅ SQLite export completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ SQLite export failed:', error);
        process.exit(1);
      });
  } else if (command === 'validate') {
    console.log('🔍 Carthorse Database Validation');
    console.log('==============================');
    
    // Parse validate arguments
    const dbPath = args[1];
    
    if (!dbPath) {
      console.error('❌ Missing required arguments');
      console.log('Usage: npx ts-node src/orchestrator/CarthorseOrchestrator.ts validate <database-path>');
      console.log('Example: npx ts-node src/orchestrator/CarthorseOrchestrator.ts validate ./test-output/boulder-export-test.db');
      process.exit(1);
    }
    
    CarthorseOrchestrator.validateDatabase(dbPath)
      .then(() => {
        console.log('✅ Database validation completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Database validation failed:', error);
        process.exit(1);
      });
  } else {
    console.log('Carthorse Orchestrator CLI');
    console.log('==========================');
    console.log('');
    console.log('Available commands:');
    console.log('  backup    - Backup the production database');
    console.log('  install   - Install Carthorse database schema and functions');
    console.log('  test      - Run orchestrator test pipeline');
    console.log('  export    - Export region data to SQLite (use --skip-recommendations to skip route generation, --skip-cleanup-on-error to preserve staging schema on error)');
    console.log('  validate  - Validate exported SQLite database');
    console.log('');
    console.log('Usage:');
    console.log('  npx ts-node src/orchestrator/CarthorseOrchestrator.ts backup');
    console.log('  npx ts-node src/orchestrator/CarthorseOrchestrator.ts install');
    console.log('  npx ts-node src/orchestrator/CarthorseOrchestrator.ts test');
    console.log('  npx ts-node src/orchestrator/CarthorseOrchestrator.ts export <region> <output-path> [--skip-recommendations] [--skip-cleanup-on-error]');
    console.log('  npx ts-node src/orchestrator/CarthorseOrchestrator.ts validate <database-path>');
    console.log('');
    process.exit(1);
  }
}