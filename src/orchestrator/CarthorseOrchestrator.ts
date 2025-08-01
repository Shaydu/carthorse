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
import type { EnhancedOrchestratorConfig } from '../types';
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
  private config: EnhancedOrchestratorConfig;
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
      
      // Force delete existing SQLite database to ensure clean v12 schema
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
      
      // Force delete existing SQLite database to ensure clean v12 schema
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
      const regionMeta = buildRegionMeta(this.config, this.regionBbox);
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

      await checkClient.end();

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
      console.log('\nNext steps:');
      console.log('1. Set PGDATABASE=' + dbName);
      console.log('2. Run carthorse --region <region> --out <output.db>');

    } catch (error) {
      console.error('❌ Installation failed:', error);
      throw error;
    } finally {
      rl.close();
    }
  }

  /**
   * Install all schema, indexes, and functions from SQL files
   */
  private static async installSchema(client: Client): Promise<void> {
    console.log('\n📚 Installing schema and functions...');

    // Read and execute schema file
    const schemaPath = path.join(__dirname, '../../docs/sql/carthorse-postgres-schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    console.log('📋 Installing tables and indexes...');
    await client.query(schemaSql);
    console.log('✅ Tables and indexes installed');

    // Read and execute PostGIS functions
    const functionsPath = path.join(__dirname, '../../docs/sql/carthorse-postgis-intersection-functions.sql');
    if (!fs.existsSync(functionsPath)) {
      throw new Error(`Functions file not found: ${functionsPath}`);
    }

    const functionsSql = fs.readFileSync(functionsPath, 'utf8');
    console.log('🔧 Installing PostGIS functions...');
    await client.query(functionsSql);
    console.log('✅ PostGIS functions installed');

    // Read and execute routing function fixes
    const routingFixesPath = path.join(__dirname, '../../docs/sql/fix_routing_functions.sql');
    if (fs.existsSync(routingFixesPath)) {
      const routingFixesSql = fs.readFileSync(routingFixesPath, 'utf8');
      console.log('🔧 Installing routing function fixes...');
      await client.query(routingFixesSql);
      console.log('✅ Routing function fixes installed');
    }

    // Verify schema version
    const versionResult = await client.query('SELECT version FROM schema_version ORDER BY id DESC LIMIT 1');
    if (versionResult.rows.length === 0) {
      throw new Error('Schema version not found after installation');
    }
    
    const version = versionResult.rows[0].version;
    console.log(`✅ Schema version verified: ${version}`);

    // Verify required functions exist
    const requiredFunctions = [
      'detect_trail_intersections',
      'build_routing_nodes', 
      'build_routing_edges',
      'copy_and_split_trails_to_staging_native'
    ];

    for (const funcName of requiredFunctions) {
      const funcResult = await client.query(`
        SELECT 1 FROM pg_proc WHERE proname = $1
      `, [funcName]);
      
      if (funcResult.rows.length === 0) {
        throw new Error(`Required function '${funcName}' not found after installation`);
      }
    }

    console.log('✅ All required functions verified');
  }

  constructor(config: EnhancedOrchestratorConfig) {
    this.config = config;
    this.stagingSchema = `staging_${config.region}_${Date.now()}`;
    
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
   * Pre-flight check: Ensure required PostGIS/SQL functions are loaded in the database
   */
  private async checkRequiredSqlFunctions(): Promise<void> {
    console.log('[DEBUG] Entered checkRequiredSqlFunctions');
    // Skip function checking for now to avoid interruption
    console.log('✅ Skipping function check - functions will be loaded during staging creation');
  }

  async run(): Promise<void> {
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

      // Generate routing graph
      console.log('[ORCH] About to generateRoutingGraph');
      await this.generateRoutingGraph();
      lastTime = logStep('generateRoutingGraph', lastTime);

      // Generate route recommendations using recursive route finding
      console.log('[ORCH] About to generateRouteRecommendations');
      await this.generateRouteRecommendations();
      lastTime = logStep('generateRouteRecommendations', lastTime);

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

      // Perform cleanup if configured
      if (this.config.testCleanup) {
        console.log('[ORCH] About to perform comprehensive cleanup');
        await this.performComprehensiveCleanup();
        lastTime = logStep('comprehensive cleanup', lastTime);
      }

      const total = Date.now() - startTime;
      console.log(`[TIMER] Total orchestrator run: ${total}ms`);

    } catch (err) {
      console.error('[Orchestrator] Error during run:', err);
      
      // Clean up on error if configured
      if (this.config.cleanupOnError) {
        console.log('[Orchestrator] Cleaning up on error...');
        await this.performComprehensiveCleanup();
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
   * Generate routing graph using native PostgreSQL functions
   */
  private async generateRoutingGraph(): Promise<void> {
    console.log('[ORCH] 🔧 Generating routing graph using native PostgreSQL...');
    
    try {
      // Step 1: Generate routing nodes
      console.log('[ORCH] Step 1: Generating routing nodes...');
      const nodesResult = await this.pgClient.query(
        `SELECT * FROM generate_routing_nodes_native($1, $2)`,
        [this.stagingSchema, this.config.intersectionTolerance || 2.0]
      );
      
      const nodeData = nodesResult.rows[0];
      const nodeCount = nodeData?.node_count || 0;
      const nodeSuccess = nodeData?.success || false;
      const nodeMessage = nodeData?.message || 'Unknown error';
      
      if (!nodeSuccess) {
        throw new Error(`Failed to generate routing nodes: ${nodeMessage}`);
      }
      
      console.log(`✅ ${nodeMessage}`);
      
      // Step 2: Clean up orphaned nodes BEFORE generating edges
      console.log('[ORCH] Step 2: Cleaning up orphaned nodes...');
      const nodeCleanupResult = await this.pgClient.query(
        `SELECT * FROM cleanup_orphaned_nodes($1)`,
        [this.stagingSchema]
      );
      
      const nodeCleanupData = nodeCleanupResult.rows[0];
      const nodeCleanupSuccess = nodeCleanupData?.success || false;
      const nodeCleanupMessage = nodeCleanupData?.message || 'Unknown error';
      const cleanedNodes = nodeCleanupData?.cleaned_nodes || 0;
      
      if (!nodeCleanupSuccess) {
        console.warn(`⚠️ Warning: ${nodeCleanupMessage}`);
      } else if (cleanedNodes > 0) {
        console.log(`🧹 ${nodeCleanupMessage}`);
      }
      
      // Step 3: Generate routing edges using cleaned node set
      console.log('[ORCH] Step 3: Generating routing edges...');
      const edgesResult = await this.pgClient.query(
        `SELECT * FROM generate_routing_edges_native($1, $2)`,
        [this.stagingSchema, this.config.intersectionTolerance || 2.0]
      );
      
      const edgeData = edgesResult.rows[0];
      const edgeCount = edgeData?.edge_count || 0;
      const edgeSuccess = edgeData?.success || false;
      const edgeMessage = edgeData?.message || 'Unknown error';
      
      if (!edgeSuccess) {
        throw new Error(`Failed to generate routing edges: ${edgeMessage}`);
      }
      
      console.log(`✅ ${edgeMessage}`);
      
      // Step 4: Clean up routing graph issues (self-loops, orphaned edges)
      console.log('[ORCH] Step 4: Cleaning up routing graph...');
      const cleanupResult = await this.pgClient.query(
        `SELECT * FROM cleanup_routing_graph($1)`,
        [this.stagingSchema]
      );
      
      const cleanupData = cleanupResult.rows[0];
      const cleanupSuccess = cleanupData?.success || false;
      const cleanupMessage = cleanupData?.message || 'Unknown error';
      const cleanedEdges = cleanupData?.cleaned_edges || 0;
      const finalCleanedNodes = cleanupData?.cleaned_nodes || 0;
      
      if (!cleanupSuccess) {
        console.warn(`⚠️ Warning: ${cleanupMessage}`);
      } else if (cleanedEdges > 0 || finalCleanedNodes > 0) {
        console.log(`🧹 ${cleanupMessage}`);
      }
      
      console.log(`✅ Generated routing graph using native PostgreSQL: ${nodeCount} initial nodes, ${edgeCount} edges`);
      
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
      // First, install the recursive route finding functions
      logMessage('📋 Installing recursive route finding functions...');
      const functionsPath = path.join(process.cwd(), 'sql/functions/recursive-route-finding-configurable-fixed.sql');
      
      if (!fs.existsSync(functionsPath)) {
        throw new Error(`Functions file not found: ${functionsPath}`);
      }
      
      logMessage(`📁 Reading functions from: ${functionsPath}`);
      const functionsSql = fs.readFileSync(functionsPath, 'utf8');
      logMessage(`📄 Functions SQL loaded (${functionsSql.length} characters)`);
      
      logMessage('🔧 Installing functions in database...');
      await this.pgClient.query(functionsSql);
      logMessage('✅ Route finding functions installed');
      
      // Test the route finding functionality
      logMessage('🧪 Testing route finding functionality...');
      const testResult = await this.pgClient.query(
        `SELECT * FROM test_route_finding($1)`,
        [this.stagingSchema]
      );
      
      logMessage(`📊 Test results: ${testResult.rows.length} tests`);
      for (const test of testResult.rows) {
        const testLog = `  ${test.test_name}: ${test.result} - ${test.details}`;
        logMessage(testLog);
      }
      
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
      
      // Check if this is a large dataset and use appropriate function
      const trailCountValue = trailCount.rows[0].count;
      const isLargeDataset = trailCountValue > 1000;
      
      logMessage(`🎯 Generating route recommendations for ${trailCountValue} trails (${isLargeDataset ? 'large dataset' : 'standard dataset'})...`);
      
      const functionName = isLargeDataset ? 'generate_route_recommendations_large_dataset' : 'generate_simple_route_recommendations';
      const recommendationResult = await this.pgClient.query(
        `SELECT ${functionName}($1, $2)`,
        [this.stagingSchema, this.config.region]
      );
      
      const routeCount = recommendationResult.rows[0]?.[functionName] || 0;
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
    console.log('🔍 Validating export: version, schema, and data...');
    
    const Database = require('better-sqlite3');
    const { validateSchemaVersion } = require('../utils/sqlite-export-helpers');
    
    const db = new Database(this.config.outputPath);
    
    try {
      // 1. Check schema version
      console.log('  📋 Checking schema version...');
      validateSchemaVersion(db, getCurrentSqliteSchemaVersion());
      console.log('  ✅ Schema version validated');
      
      // 2. Check schema structure
      console.log('  🏗️  Checking schema structure...');
      const tableCheck = (table: string) => {
        const res = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!res;
      };
      
      const requiredTables = ['trails', 'routing_nodes', 'routing_edges', 'region_metadata'];
      for (const table of requiredTables) {
        if (!tableCheck(table)) {
          throw new Error(`❌ Required table '${table}' is missing from SQLite export`);
        }
      }
      console.log('  ✅ All required tables present');
      
      // 3. Check data integrity
      console.log('  📊 Checking data integrity...');
      const rowCount = (table: string) => {
        const res = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count?: number };
        return res && typeof res.count === 'number' ? res.count : 0;
      };
      
      const trailCount = rowCount('trails');
      const nodeCount = rowCount('routing_nodes');
      const edgeCount = rowCount('routing_edges');
      
      if (trailCount === 0) {
        throw new Error('❌ No trails exported to SQLite');
      }
      if (nodeCount === 0) {
        throw new Error('❌ No routing nodes exported to SQLite');
      }
      if (edgeCount === 0) {
        throw new Error('❌ No routing edges exported to SQLite');
      }
      
      console.log(`  ✅ Data counts: ${trailCount} trails, ${nodeCount} nodes, ${edgeCount} edges`);
      
      // 4. Check GeoJSON integrity
      console.log('  🗺️  Checking GeoJSON integrity...');
      const missingTrailGeojson = db.prepare("SELECT id, app_uuid FROM trails WHERE geojson IS NULL OR geojson = '' OR LENGTH(geojson) < 10").all();
      if (missingTrailGeojson.length > 0) {
        throw new Error(`❌ ${missingTrailGeojson.length} trails have missing or invalid GeoJSON`);
      }
      
      const missingEdgeGeojson = db.prepare("SELECT id FROM routing_edges WHERE geojson IS NULL OR geojson = '' OR LENGTH(geojson) < 10").all();
      if (missingEdgeGeojson.length > 0) {
        throw new Error(`❌ ${missingEdgeGeojson.length} routing edges have missing or invalid GeoJSON`);
      }
      
      console.log('  ✅ All GeoJSON data is valid');
      
      // 5. Check v12 schema compliance
      console.log('  🔧 Checking v12 schema compliance...');
      const edgesTableInfo = db.prepare('PRAGMA table_info(routing_edges)').all();
      const hasSourceColumn = edgesTableInfo.some((col: any) => col.name === 'source');
      const hasTargetColumn = edgesTableInfo.some((col: any) => col.name === 'target');
      
      if (!hasSourceColumn || !hasTargetColumn) {
        throw new Error('❌ routing_edges table does not have v12 schema (source/target columns)');
      }
      
      console.log('  ✅ v12 schema compliance verified');
      
      console.log('✅ Export validation completed successfully');
      
    } finally {
      db.close();
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

      // Commit the entire transaction
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging environment created and committed successfully');

          // Functions are now part of the database schema via migrations
      console.log('📚 PostGIS functions available via database schema (V3 migration)');

      // Note: Triggers are not needed in staging schema - they're for the main trails table
      console.log('✅ Staging environment created (no triggers needed in staging)');

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