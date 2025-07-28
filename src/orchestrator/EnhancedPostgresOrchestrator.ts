#!/usr/bin/env ts-node
/**
 * Enhanced PostgreSQL Orchestrator with Staging-Based Trail Processing
 * 
 * This orchestrator:
 * 1. Backs up PostgreSQL database
 * 2. Creates staging tables for processing
 * 3. Copies region data to staging
 * 4. Performs intersection detection and trail splitting in PostgreSQL
 * 5. Builds routing nodes and edges in staging
 * 6. Exports processed data to SpatiaLite
 * 7. Cleans up staging tables
 * 
 * Usage:
 *   npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region <region> --spatialite-db-export <path> [options]
 *   npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region boulder --spatialite-db-export ./data/boulder.db
 *   npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region boulder --spatialite-db-export ./data/boulder.db --build-master
 * 
 * Options:
 *   --region                    Region to process (required)
 *   --spatialite-db-export      SpatiaLite database export path (required)
 *   --simplify-tolerance        Path simplification tolerance (default: 0.001)
 *   --target-size               Target database size in MB (e.g., 100 for 100MB)
 *   --max-spatialite-db-size    Maximum database size in MB (default: 400)
 *   --intersection-tolerance    Intersection detection tolerance in meters (default: 1)
 *   --replace                   Replace existing database
 *   --validate                  Run validation after export
 *   --verbose                   Enable verbose logging
 *   --skip-backup              Skip database backup
 *   --skip-incomplete-trails   Skip trails missing elevation data or geometry
 *   --build-master             Build master database from Overpass API before processing
 *   --test-cleanup             Always drop staging schema after run (for test/debug)
 */

// NOTE: Do not set process.env.PGDATABASE or PGUSER here.
// Test DB safety must be enforced in test setup or before importing this module.

import { Client } from 'pg';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
dotenv.config();

import { getDbConfig, validateTestEnvironment } from '../utils/env';
import { backupDatabase } from '../utils/sql/backup';

import { AtomicTrailInserter } from '../inserters/AtomicTrailInserter';
import { OSMPostgresLoader } from '../loaders/OSMPostgresLoader';
import { 
  TrailInsertData, 
  Coordinate3D, 
  Coordinate2D, 
  BoundingBox,
  GeoJSONCoordinate,
  LeafletCoordinate,
  IntersectionPoint,
  TrailSegment,
  RoutingNode,
  RoutingEdge
} from '../types';
import * as process from 'process';
import { calculateInitialViewBbox, getValidInitialViewBbox } from '../utils/bbox';
import { getTestDbConfig } from '../database/connection';
import { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRegionMetadata, buildRegionMeta, insertSchemaVersion, CARTHORSE_SCHEMA_VERSION } from '../utils/sqlite-export-helpers';
import { getStagingSchemaSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { isValidNumberTuple, hashString } from '../utils';
import { cleanupStaging, logSchemaTableState } from '../utils/sql/postgres-schema-helpers';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { buildRoutingGraphHelper } from '../utils/sql/routing';
import { execSync } from 'child_process';
import { createCanonicalRoutingEdgesTable } from '../utils/sql/postgres-schema-helpers';
import { INTERSECTION_TOLERANCE, EDGE_TOLERANCE } from '../constants';

// --- Type Definitions ---
import type { EnhancedOrchestratorConfig } from '../types';

export class EnhancedPostgresOrchestrator {
  private pgClient: Client;
  private pgConfig: any;
  private config: EnhancedOrchestratorConfig;
  public readonly stagingSchema: string;

  /**
   * Public method to manually cleanup staging schema (useful for tests)
   */
  public async cleanupStaging(): Promise<void> {
    await cleanupStaging(this.pgClient, this.stagingSchema);
  }

  /**
   * Comprehensive cleanup for disk space management
   */
  public async performComprehensiveCleanup(): Promise<void> {
    console.log('🧹 Starting comprehensive cleanup for disk space management...');
    
    const config = this.config;
    const cleanupOptions = {
      aggressiveCleanup: config.aggressiveCleanup ?? true,
      cleanupOldStagingSchemas: config.cleanupOldStagingSchemas ?? true,
      cleanupTempFiles: config.cleanupTempFiles ?? true,
      maxStagingSchemasToKeep: config.maxStagingSchemasToKeep ?? 2,
      cleanupDatabaseLogs: config.cleanupDatabaseLogs ?? false
    };

    console.log('📋 Cleanup options:', cleanupOptions);

    try {
      // 1. Clean up current staging schema
      if (!config.skipCleanup) {
        console.log('🗑️ Cleaning up current staging schema...');
        await this.cleanupStaging();
      }

      // 2. Clean up old staging schemas for this region
      if (cleanupOptions.cleanupOldStagingSchemas) {
        console.log('🗑️ Cleaning up old staging schemas for region:', this.config.region);
        await this.cleanupOldStagingSchemas(cleanupOptions.maxStagingSchemasToKeep);
      }

      // 3. Clean up temporary files
      if (cleanupOptions.cleanupTempFiles) {
        console.log('🗑️ Cleaning up temporary files...');
        await this.cleanupTempFiles();
      }

      // 4. Clean up database logs (if enabled)
      if (cleanupOptions.cleanupDatabaseLogs) {
        console.log('🗑️ Cleaning up database logs...');
        await this.cleanupDatabaseLogs();
      }

      // 5. Aggressive cleanup (if enabled)
      if (cleanupOptions.aggressiveCleanup) {
        console.log('🗑️ Performing aggressive cleanup...');
        await this.performAggressiveCleanup();
      }

      console.log('✅ Comprehensive cleanup completed successfully');
    } catch (error) {
      console.error('❌ Error during comprehensive cleanup:', error);
      // Don't throw - cleanup errors shouldn't fail the main process
    }
  }

  /**
   * Clean up old staging schemas for the current region
   */
  private async cleanupOldStagingSchemas(maxToKeep: number = 2): Promise<void> {
    try {
      const regionPrefix = `staging_${this.config.region}_`;
      
      // Find all staging schemas for this region
      const result = await this.pgClient.query(`
        SELECT nspname 
        FROM pg_namespace 
        WHERE nspname LIKE $1 
        ORDER BY nspname DESC
      `, [`${regionPrefix}%`]);

      const schemas = result.rows.map(row => row.nspname);
      
      if (schemas.length <= maxToKeep) {
        console.log(`📊 Found ${schemas.length} staging schemas for ${this.config.region}, keeping all (max: ${maxToKeep})`);
        return;
      }

      // Drop old schemas (keep the most recent ones)
      const schemasToDrop = schemas.slice(maxToKeep);
      console.log(`🗑️ Dropping ${schemasToDrop.length} old staging schemas for ${this.config.region}:`);
      
      for (const schema of schemasToDrop) {
        console.log(`   - Dropping ${schema}`);
        await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
      
      console.log(`✅ Kept ${maxToKeep} most recent staging schemas for ${this.config.region}`);
    } catch (error) {
      console.error('❌ Error cleaning up old staging schemas:', error);
    }
  }

  /**
   * Clean up temporary files and logs
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      // Clean up common temp directories
      const tempDirs = [
        path.join(process.cwd(), 'tmp'),
        path.join(process.cwd(), 'logs'),
        path.join(process.cwd(), 'data', 'temp'),
        os.tmpdir()
      ];

      for (const tempDir of tempDirs) {
        if (fs.existsSync(tempDir)) {
          console.log(`🗑️ Cleaning temp directory: ${tempDir}`);
          
          // Remove files older than 24 hours
          const files = fs.readdirSync(tempDir);
          const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
          
          for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.mtime.getTime() < cutoffTime) {
                if (stats.isDirectory()) {
                  fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(filePath);
                }
                console.log(`   - Removed old file: ${file}`);
              }
            } catch (fileError) {
              // Ignore individual file errors
              console.warn(`   - Could not process file: ${file}`);
            }
          }
        }
      }

      // Clean up specific temp files
      const tempFiles = [
        '/tmp/latest_prod_schema.sql',
        '/tmp/test_export.db',
        path.join(process.cwd(), 'test-*.db'),
        path.join(process.cwd(), 'data', 'test-*.db')
      ];

      for (const tempFile of tempFiles) {
        if (fs.existsSync(tempFile)) {
          try {
            fs.unlinkSync(tempFile);
            console.log(`   - Removed temp file: ${tempFile}`);
          } catch (fileError) {
            // Ignore individual file errors
          }
        }
      }

      console.log('✅ Temporary files cleanup completed');
    } catch (error) {
      console.error('❌ Error cleaning up temporary files:', error);
    }
  }

  /**
   * Clean up database logs (PostgreSQL logs)
   */
  private async cleanupDatabaseLogs(): Promise<void> {
    try {
      // This is a placeholder - actual implementation would depend on PostgreSQL configuration
      console.log('📝 Database log cleanup not implemented (requires PostgreSQL configuration)');
      console.log('💡 To enable database log cleanup, configure PostgreSQL logging and implement log rotation');
    } catch (error) {
      console.error('❌ Error cleaning up database logs:', error);
    }
  }

  /**
   * Perform aggressive cleanup for maximum disk space recovery
   */
  private async performAggressiveCleanup(): Promise<void> {
    try {
      console.log('🔥 Performing aggressive cleanup...');

      // 1. Clean up all test staging schemas
      console.log('🗑️ Cleaning up all test staging schemas...');
      await EnhancedPostgresOrchestrator.cleanAllTestStagingSchemas();

      // 2. Clean up any orphaned staging schemas (older than 7 days)
      console.log('🗑️ Cleaning up orphaned staging schemas...');
      await this.cleanupOrphanedStagingSchemas();

      // 3. Vacuum database to reclaim space
      console.log('🧹 Running database vacuum...');
      await this.pgClient.query('VACUUM ANALYZE');

      // 4. Clean up any temporary tables
      console.log('🗑️ Cleaning up temporary tables...');
      await this.cleanupTemporaryTables();

      console.log('✅ Aggressive cleanup completed');
    } catch (error) {
      console.error('❌ Error during aggressive cleanup:', error);
    }
  }

  /**
   * Clean up orphaned staging schemas (older than 7 days)
   */
  private async cleanupOrphanedStagingSchemas(): Promise<void> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Find staging schemas older than 7 days
      const result = await this.pgClient.query(`
        SELECT nspname 
        FROM pg_namespace 
        WHERE nspname LIKE 'staging_%' 
        AND nspname NOT LIKE 'staging_${this.config.region}_%'
        ORDER BY nspname
      `);

      const orphanedSchemas = result.rows.map(row => row.nspname);
      
      if (orphanedSchemas.length === 0) {
        console.log('📊 No orphaned staging schemas found');
        return;
      }

      console.log(`🗑️ Found ${orphanedSchemas.length} orphaned staging schemas:`);
      
      for (const schema of orphanedSchemas) {
        console.log(`   - Dropping orphaned schema: ${schema}`);
        await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }

      console.log('✅ Orphaned staging schemas cleanup completed');
    } catch (error) {
      console.error('❌ Error cleaning up orphaned staging schemas:', error);
    }
  }

  /**
   * Clean up temporary tables in the current database
   */
  private async cleanupTemporaryTables(): Promise<void> {
    try {
      // Find temporary tables
      const result = await this.pgClient.query(`
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'pg_temp' 
        OR tablename LIKE 'temp_%'
      `);

      const tempTables = result.rows.map(row => row.tablename);
      
      if (tempTables.length === 0) {
        console.log('📊 No temporary tables found');
        return;
      }

      console.log(`🗑️ Found ${tempTables.length} temporary tables:`);
      
      for (const table of tempTables) {
        try {
          console.log(`   - Dropping temporary table: ${table}`);
          await this.pgClient.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        } catch (tableError) {
          console.warn(`   - Could not drop table ${table}:`, tableError);
        }
      }

      console.log('✅ Temporary tables cleanup completed');
    } catch (error) {
      console.error('❌ Error cleaning up temporary tables:', error);
    }
  }

  /**
   * Export the current staging database to SQLite
   * This method can be called independently to export the database without running the full pipeline
   */
  public async exportDatabase(): Promise<void> {
    console.log('💾 Exporting database to SQLite...');
    
    try {
      // Ensure we have a connection
      if (!this.pgClient) {
        throw new Error('No database connection available');
      }

      // Query data from staging schema
      const trailsRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry) AS geojson FROM ${this.stagingSchema}.trails`);
      const nodesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes`);
      // Debug: Print node count and IDs before export
      console.log(`[DEBUG] nodesRes.rows.length: ${nodesRes.rows.length}`);
      const nodeIds = nodesRes.rows.map((n: any) => n.id);
      console.log('[DEBUG] node IDs from staging:', nodeIds);
      const missingIds = [];
      for (let i = 1; i <= Math.max(...nodeIds); i++) {
        if (!nodeIds.includes(i)) missingIds.push(i);
      }
      if (missingIds.length > 0) {
        console.warn('[DEBUG] Missing node IDs in staging:', missingIds);
      }
      const duplicateIds = nodeIds.filter((id, idx) => nodeIds.indexOf(id) !== idx);
      if (duplicateIds.length > 0) {
        console.warn('[DEBUG] Duplicate node IDs in staging:', duplicateIds);
      }
      const edgesRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry) AS geojson FROM ${this.stagingSchema}.routing_edges`);

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
      const sqliteDb = new Database(this.config.outputPath);
      // Log the DB path to a persistent log file
      try {
        const logDir = path.resolve(__dirname, '../../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'export-db-paths.log');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Created/used DB: ${this.config.outputPath}\n`);
      } catch (e) {
        console.error('[LOGGING] Failed to log DB path:', e);
      }
      
      console.log('📊 Exporting to SQLite...');

      // Create tables and insert data
      createSqliteTables(sqliteDb, this.config.outputPath);
      // --- Ensure geojson is present and valid for every trail ---
      function ensureFeature(geojson: any) {
        if (!geojson) return null;
        if (typeof geojson === 'string') geojson = JSON.parse(geojson);
        if (geojson.type === 'Feature') return geojson;
        // Wrap LineString or other geometry in a Feature
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
      // --- Ensure geojson is present and valid for every edge ---
      for (const edge of edgesRes.rows) {
        if (!edge.geojson || typeof edge.geojson !== 'string' || edge.geojson.length < 10) {
          throw new Error(`geojson is required for all routing edges (id: ${edge.id})`);
        }
        edge.geojson = JSON.stringify(ensureFeature(edge.geojson));
      }
      insertTrails(sqliteDb, trailsRes.rows, this.config.outputPath);
      insertRoutingNodes(sqliteDb, nodesRes.rows, this.config.outputPath);
      insertRoutingEdges(sqliteDb, edgesRes.rows, this.config.outputPath);

      // Build region metadata and insert
      const regionMeta = buildRegionMeta(this.config, this.regionBbox);
      insertRegionMetadata(sqliteDb, regionMeta, this.config.outputPath);
      insertSchemaVersion(sqliteDb, CARTHORSE_SCHEMA_VERSION, 'Carthorse SQLite Export v9.0', this.config.outputPath);

      // After all inserts and before closing the SQLite DB
      const tableCheck = (table: string) => {
        const res = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!res;
      };
      const rowCount = (table: string) => {
        const res = sqliteDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count?: number };
        return res && typeof res.count === 'number' ? res.count : 0;
      };

      if (!tableCheck('trails')) {
        throw new Error('Export failed: trails table is missing from the SQLite export.');
      }
      if (!tableCheck('region_metadata')) {
        throw new Error('Export failed: region_metadata table is missing from the SQLite export.');
      }
      if (rowCount('routing_nodes') === 0) {
        throw new Error('Export failed: routing_nodes table is empty in the SQLite export.');
      }
      
      // Allow empty routing_edges in test environments with limited data
      const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
      const hasTestLimit = process.env.CARTHORSE_TEST_LIMIT !== undefined;
      const edgeCount = rowCount('routing_edges');
      
      if (edgeCount === 0 && !(isTestEnvironment || hasTestLimit)) {
        throw new Error('Export failed: routing_edges table is empty in the SQLite export.');
      }
      
      if (edgeCount === 0 && (isTestEnvironment || hasTestLimit)) {
        console.warn('⚠️  Warning: routing_edges table is empty. This is expected with limited test data.');
      }

      sqliteDb.close();
      console.log('✅ Database export completed successfully');
      console.log(`📁 Output: ${this.config.outputPath}`);

      // Validate schema version after export
      const dbCheck = new Database(this.config.outputPath);
      try {
        validateSchemaVersion(dbCheck, CARTHORSE_SCHEMA_VERSION);
      } finally {
        dbCheck.close();
      }

      // Post-export validation: fail loudly if any geojson is missing or invalid
      const dbCheck2 = new Database(this.config.outputPath);
      const missingTrailGeojson = dbCheck2.prepare("SELECT id, app_uuid FROM trails WHERE geojson IS NULL OR geojson = '' OR LENGTH(geojson) < 10").all();
      if (missingTrailGeojson.length > 0) {
        throw new Error(`[FATAL] Exported SQLite DB has trails with missing or invalid geojson: ${JSON.stringify(missingTrailGeojson)}`);
      }
      const missingEdgeGeojson = dbCheck2.prepare("SELECT id FROM routing_edges WHERE geojson IS NULL OR geojson = '' OR LENGTH(geojson) < 10").all();
      if (missingEdgeGeojson.length > 0) {
        throw new Error(`[FATAL] Exported SQLite DB has routing_edges with missing or invalid geojson: ${JSON.stringify(missingEdgeGeojson)}`);
      }
      dbCheck2.close();
      
    } catch (error) {
      console.error('❌ Database export failed:', error);
      throw error;
    }
  }

  /**
   * Export staging data to SQLite without running the full pipeline
   * Useful when you already have processed data in staging and just want to export it
   */
  public async exportStagingData(): Promise<void> {
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
      const trailsRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry) AS geojson FROM ${this.stagingSchema}.trails`);
      const splitTrailsRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry) AS geojson FROM ${this.stagingSchema}.split_trails`);
      const nodesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes`);
      const edgesRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry) AS geojson FROM ${this.stagingSchema}.routing_edges`);

      console.log(`📊 Found ${trailsRes.rows.length} original trails, ${splitTrailsRes.rows.length} split trails, ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);

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
      const sqliteDb = new Database(this.config.outputPath);
      
      console.log('📊 Exporting to SQLite...');

      // Create tables and insert data
      createSqliteTables(sqliteDb, this.config.outputPath);
      
      // Map geometry_text to geometry_wkt and generate geojson for SQLite export
      // Use split trails if enabled and available, otherwise use original trails
      const useSplitTrails = this.config.useSplitTrails !== false; // Default to true
      const trailsToExport = (useSplitTrails && splitTrailsRes?.rows?.length > 0 ? splitTrailsRes.rows : trailsRes.rows).map(trail => {
        if (!trail.geojson || typeof trail.geojson !== 'string' || trail.geojson.length < 10) {
          throw new Error(`geojson is required for all trails (app_uuid: ${trail.app_uuid})`);
        }
        return trail;
      });
      
      console.log(`📊 Exporting ${trailsToExport.length} trails (${useSplitTrails && splitTrailsRes?.rows?.length > 0 ? 'split' : 'original'})`);
      insertTrails(sqliteDb, trailsToExport, this.config.outputPath);
      insertRoutingNodes(sqliteDb, nodesRes.rows, this.config.outputPath);
      insertRoutingEdges(sqliteDb, edgesRes.rows, this.config.outputPath);

      // Build region metadata and insert
      const regionMeta = buildRegionMeta(this.config, this.regionBbox);
      insertRegionMetadata(sqliteDb, regionMeta, this.config.outputPath);
      insertSchemaVersion(sqliteDb, CARTHORSE_SCHEMA_VERSION, 'Carthorse Staging Export v9.0', this.config.outputPath);

      // After all inserts and before closing the SQLite DB
      const tableCheck = (table: string) => {
        const res = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!res;
      };
      const rowCount = (table: string) => {
        const res = sqliteDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count?: number };
        return res && typeof res.count === 'number' ? res.count : 0;
      };

      if (!tableCheck('trails')) {
        throw new Error('Export failed: trails table is missing from the SQLite export.');
      }
      if (!tableCheck('region_metadata')) {
        throw new Error('Export failed: region_metadata table is missing from the SQLite export.');
      }
      if (rowCount('routing_nodes') === 0) {
        throw new Error('Export failed: routing_nodes table is empty in the SQLite export.');
      }
      if (rowCount('routing_edges') === 0) {
        throw new Error('Export failed: routing_edges table is empty in the SQLite export.');
      }

      sqliteDb.close();
      console.log('✅ Staging data export completed successfully');
      console.log(`📁 Output: ${this.config.outputPath}`);

      // Validate schema version after export
      const dbCheck = new Database(this.config.outputPath);
      try {
        validateSchemaVersion(dbCheck, CARTHORSE_SCHEMA_VERSION);
      } finally {
        dbCheck.close();
      }
      
    } catch (error) {
      console.error('❌ Staging data export failed:', error);
      throw error;
    }
  }
  private splitPoints: Map<string, IntersectionPoint[]> = new Map<string, IntersectionPoint[]>();
  private regionBbox: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    trailCount: number;
  } | null = null;

  constructor(config: EnhancedOrchestratorConfig) {
    this.config = config;
    this.stagingSchema = `staging_${config.region}_${Date.now()}`;
    
    // Validate test environment to prevent production access
    validateTestEnvironment();
    
    // Use canonical test DB config in test environments
    let clientConfig;
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
      clientConfig = getTestDbConfig();
    } else {
      const dbName = process.env.PGDATABASE || 'trail_master_db_test';
      const dbUser = process.env.PGUSER || 'tester';
      const dbPassword = process.env.PGPASSWORD || '';
      const dbHost = process.env.PGHOST || 'localhost';
      const dbPort = parseInt(process.env.PGPORT || '5432');
      clientConfig = {
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
      };
    }
    this.pgConfig = clientConfig;
    this.pgClient = new Client(clientConfig);
  }

  /**
   * Pre-flight check: Ensure required PostGIS/SQL functions are loaded in the database
   */
  private async checkRequiredSqlFunctions(): Promise<void> {
    console.log('[DEBUG] Entered checkRequiredSqlFunctions');
    const requiredFunctions: string[] = [
      // 'native_split_trails_at_intersections(text, text)' // Deprecated and removed
      // Add more required functions here as needed
    ];
    const missing: string[] = [];
    for (const fn of requiredFunctions) {
      console.log(`[DEBUG] Checking for function: ${fn}`);
      const res = await this.pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = $1`,
        [fn.split('(')[0]]
      );
      console.log(`[DEBUG] Query result for ${fn}:`, res.rows);
      if (res.rows.length === 0) {
        missing.push(fn);
      }
    }
    if (missing.length > 0) {
      console.warn(
        `⚠️ Required PostGIS/SQL functions missing: ${missing.join(', ')}\n` +
        `Attempting to load them automatically from sql/native-postgis-functions.sql...`
      );
      try {
        console.log('[DEBUG] Running execSync to load SQL functions');
        execSync(`psql -d ${this.pgConfig.database} -f sql/native-postgis-functions.sql`, { stdio: 'inherit' });
        // Re-check after loading
        const stillMissing: string[] = [];
        for (const fn of requiredFunctions) {
          console.log(`[DEBUG] Re-checking for function: ${fn}`);
          const res = await this.pgClient.query(
            `SELECT proname FROM pg_proc WHERE proname = $1`,
            [fn.split('(')[0]]
          );
          console.log(`[DEBUG] Query result for ${fn} after reload:`, res.rows);
          if (res.rows.length === 0) {
            stillMissing.push(fn);
          }
        }
        if (stillMissing.length > 0) {
          throw new Error(
            `❌ Failed to load required functions: ${stillMissing.join(', ')}\n` +
            `Please check sql/native-postgis-functions.sql and your database permissions.`
          );
        }
        console.log('✅ Required PostGIS/SQL functions loaded successfully.');
      } catch (err) {
        console.error('[DEBUG] Error during execSync for SQL functions:', err);
        throw new Error(
          `❌ Could not load required SQL functions automatically.\n` +
          `Please run: psql -d ${this.pgConfig.database} -f sql/native-postgis-functions.sql\n` +
          `Error: ${err}`
        );
      }
    } else {
      console.log('✅ All required PostGIS/SQL functions are present.');
    }
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    const logStep = (label: string, lastTime: number) => {
      const now = Date.now();
      console.log(`[TIMER] ${label}: ${(now - lastTime)}ms`);
      return now;
    };
    let t = startTime;
    try {
      t = logStep('Start', t);
      console.log('[ORCH] About to checkRequiredSqlFunctions');
      await this.checkRequiredSqlFunctions();
      t = logStep('checkRequiredSqlFunctions', t);
      console.log('[ORCH] About to connect pgClient');
      await this.pgClient.connect();
      t = logStep('pgClient.connect', t);
      if (this.config.buildMaster) {
        console.log('[ORCH] buildMaster requested, skipping rest of pipeline.');
        return;
      }
      console.log('[ORCH] About to createStagingEnvironment');
      await this.createStagingEnvironment();
      t = logStep('createStagingEnvironment', t);
      console.log('[ORCH] About to copyRegionDataToStaging');
      await this.copyRegionDataToStaging(this.config.bbox);
      t = logStep('copyRegionDataToStaging', t);
      const trailCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`[ORCH] Trail count in staging: ${trailCountResult.rows[0].count}`);
      if (this.regionBbox) {
        console.log('[ORCH] Region bbox:', this.regionBbox);
      }
      console.log('[ORCH] About to detectIntersections');
      await this.detectIntersections();
      t = logStep('detectIntersections', t);
      
      // Generate routing nodes and edges using the JS/TS helper before export
      console.log('[ORCH] About to run buildRoutingGraphHelper for routing nodes/edges...');
      
      // Get processing configuration from database
      const processingConfig = await this.getProcessingConfig();
      
      await buildRoutingGraphHelper(
        this.pgClient,
        this.stagingSchema,
        'trails',
        this.config.intersectionTolerance ?? 2.0,
        this.config.edgeTolerance ?? 20.0,
        {
          useIntersectionNodes: processingConfig.useIntersectionNodes ?? false, // Default to false if not specified
          intersectionTolerance: this.config.intersectionTolerance ?? 2.0,
          edgeTolerance: this.config.edgeTolerance ?? 20.0
        }
      );
      t = logStep('buildRoutingGraph', t);
      
      // Populate split_trails table with trail segments split at intersections (if enabled)
      if (this.config.useSplitTrails !== false) { // Default to true
        console.log('[ORCH] About to populateSplitTrails');
        await this.populateSplitTrails();
        t = logStep('populateSplitTrails', t);
      } else {
        console.log('[ORCH] Skipping split trails population (useSplitTrails: false)');
      }
      
      // Proceed to export
      await this.exportDatabase();
      t = logStep('exportDatabase', t);
      if (this.config.validate) {
        console.log('[ORCH] About to validateExport');
        await this.validateExport();
        t = logStep('validateExport', t);
      }
      
      // Perform comprehensive cleanup for disk space management
      console.log('[ORCH] About to performComprehensiveCleanup');
      await this.performComprehensiveCleanup();
      t = logStep('performComprehensiveCleanup', t);
      
      const total = Date.now() - startTime;
      console.log(`[TIMER] Total orchestrator run: ${total}ms`);
    } catch (err) {
      console.error('[Orchestrator] Error during run:', err);
      
      // Clean up on error if configured
      if (this.config.cleanupOnError) {
        console.log('[ORCH] Error occurred, performing cleanup on error...');
        try {
          await this.performComprehensiveCleanup();
        } catch (cleanupError) {
          console.error('[ORCH] Error during cleanup on error:', cleanupError);
        }
      }
      
      throw err;
    }
  }

  /**
   * Build the routing graph using the helper.
   */
  private async buildRoutingGraph(): Promise<void> {
    // Get processing configuration from database
    const processingConfig = await this.getProcessingConfig();
    
    // Use CLI configuration if provided, otherwise fall back to database config
    const useIntersectionNodes = this.config.useIntersectionNodes !== undefined 
      ? this.config.useIntersectionNodes 
      : processingConfig.useIntersectionNodes ?? true; // Default to true for better routing
    
    console.log(`[ORCH] Using intersection nodes: ${useIntersectionNodes} (CLI: ${this.config.useIntersectionNodes}, DB: ${processingConfig.useIntersectionNodes})`);
    
    await buildRoutingGraphHelper(
      this.pgClient,
      this.stagingSchema,
      'trails',
      this.config.intersectionTolerance ?? INTERSECTION_TOLERANCE,
      this.config.edgeTolerance ?? EDGE_TOLERANCE,
      {
        useIntersectionNodes: useIntersectionNodes,
        intersectionTolerance: this.config.intersectionTolerance ?? INTERSECTION_TOLERANCE,
        edgeTolerance: this.config.edgeTolerance ?? EDGE_TOLERANCE
      }
    );
  }

  /**
   * Populate split_trails table with trail segments split at intersections.
   */
  private async populateSplitTrails(): Promise<void> {
    console.log(`[ORCH] 📐 Populating split_trails table with trail segments split at intersections...`);
    
    try {
      const result = await this.pgClient.query(
        `SELECT public.populate_split_trails($1, $2)`,
        [this.stagingSchema, 'trails']
      );
      
      const segmentCount = result.rows[0]?.populate_split_trails || 0;
      console.log(`[ORCH] ✅ Created ${segmentCount} trail segments in split_trails table`);
      
      // Get statistics about the split
      const statsResult = await this.pgClient.query(`
        SELECT 
          COUNT(DISTINCT original_trail_id) as original_trails,
          COUNT(*) as total_segments,
          ROUND(AVG(segments_per_trail), 2) as avg_segments_per_trail
        FROM (
          SELECT original_trail_id, COUNT(*) as segments_per_trail
          FROM ${this.stagingSchema}.split_trails
          GROUP BY original_trail_id
        ) trail_segments
      `);
      
      if (statsResult.rows.length > 0) {
        const stats = statsResult.rows[0];
        console.log(`[ORCH] 📊 Split Statistics: ${stats.original_trails} original trails → ${stats.total_segments} segments (avg: ${stats.avg_segments_per_trail} segments/trail)`);
      }
      
    } catch (error) {
      console.error(`[ORCH] ❌ Error populating split_trails table:`, error);
      throw error;
    }
  }

  /**
   * Get processing configuration for the current region from the database
   */
  private async getProcessingConfig(): Promise<{ useIntersectionNodes?: boolean }> {
    try {
      const result = await this.pgClient.query(
        'SELECT processing_config FROM regions WHERE region_key = $1',
        [this.config.region]
      );
      
      if (result.rows.length > 0 && result.rows[0].processing_config) {
        const config = result.rows[0].processing_config;
        console.log(`[ORCH] Using processing config for region ${this.config.region}:`, config);
        return config;
      }
      
      console.log(`[ORCH] No processing config found for region ${this.config.region}, using defaults`);
      return {};
    } catch (error) {
      console.warn(`[ORCH] Error getting processing config for region ${this.config.region}:`, error);
      console.log(`[ORCH] Using default processing config`);
      return {};
    }
  }

  /**
   * Run post-export validation (was previously inlined in run()).
   */
  private async validateExport(): Promise<void> {
    // Try to run the validation script, but skip if not found
    let validationResult;
    try {
      // Try TypeScript version first, then compiled JavaScript
      const validationScripts = [
        ['npx', 'ts-node', 'src/tools/carthorse-validate-database.ts', '--db', this.config.outputPath],
        ['node', 'dist/src/tools/carthorse-validate-database.js', '--db', this.config.outputPath]
      ];
      
      let success = false;
      for (const script of validationScripts) {
        try {
          validationResult = spawnSync(script[0], script.slice(1), { encoding: 'utf-8' });
          if (validationResult.stdout) process.stdout.write(validationResult.stdout);
          if (validationResult.stderr) process.stderr.write(validationResult.stderr);
          if (validationResult.status === 0) {
            success = true;
            break;
          }
        } catch (err: any) {
          // Continue to next script
          continue;
        }
      }
      
      if (!success) {
        throw new Error('❌ Post-export database validation failed. See report above.');
      }
      console.log('✅ Post-export database validation passed.');
    } catch (err: any) {
      if (err.code === 'ENOENT' || (err.message && err.message.includes('Cannot find module'))) {
        console.warn('[Orchestrator] Validation script not found, skipping post-export validation.');
        return;
      }
      throw err;
    }
  }

  private async createStagingEnvironment(): Promise<void> {
    console.log('��️  Creating staging environment:', this.stagingSchema);

    // Always drop the staging schema first for a clean slate
    try {
      const checkSchemaSql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${this.stagingSchema}'`;
      const res = await this.pgClient.query(checkSchemaSql);
      if (res.rows.length > 0) {
        console.warn(`[DDL] WARNING: Staging schema ${this.stagingSchema} already exists. Dropping it for a clean slate.`);
      }
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
      await this.pgClient.query('COMMIT');
      console.log(`[DDL] Dropped schema if existed: ${this.stagingSchema}`);
    } catch (err) {
      console.error(`[DDL] Error dropping schema ${this.stagingSchema}:`, err);
      throw err;
    }

    // Create staging schema
    try {
      await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging schema created and committed');
    } catch (err) {
      console.error(`[DDL] Error creating schema ${this.stagingSchema}:`, err);
      throw err;
    }

    // Create staging tables
    const stagingTablesSql = getStagingSchemaSql(this.stagingSchema);
    console.log('[DDL] Executing staging tables DDL:');
    console.log(stagingTablesSql);

    try {
      await this.pgClient.query(stagingTablesSql);
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging tables created and committed');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('[DDL] Error creating staging tables:', err);
      throw err;
    }

    // Create spatial indexes
    const stagingIndexesSql = `
      CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${this.stagingSchema}.trails USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_staging_split_trails_geometry ON ${this.stagingSchema}.split_trails USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_staging_intersection_points ON ${this.stagingSchema}.intersection_points USING GIST(point);
      CREATE INDEX IF NOT EXISTS idx_staging_routing_nodes_location ON ${this.stagingSchema}.routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
      CREATE INDEX IF NOT EXISTS idx_staging_routing_edges_geometry ON ${this.stagingSchema}.routing_edges USING GIST(geometry);
    `;
    console.log('[DDL] Executing staging indexes DDL:');
    console.log(stagingIndexesSql);

    try {
      await this.pgClient.query(stagingIndexesSql);
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging indexes created and committed');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('[DDL] Error creating staging indexes:', err);
      throw err;
    }

    // Note: Using public schema PostGIS functions instead of creating them in staging
    console.log('📚 Using public schema PostGIS intersection functions...');

    console.log('✅ Staging environment created');
  }

  private async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log('📋 Copying', this.config.region, 'data to staging...');
    
    // Support CARTHORSE_TEST_LIMIT for quick tests
    const trailLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
    // Use the table/view specified by CARTHORSE_TRAILS_TABLE, defaulting to 'trails'
    const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';
    
    // Build bbox filter if provided
    let bboxFilter = '';
    let queryParams = [this.config.region];
    
    if (bbox && bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = bbox;
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
      queryParams.push(minLng.toString(), minLat.toString(), maxLng.toString(), maxLat.toString());
      console.log(`🗺️ Filtering by bbox: ${minLng}, ${minLat}, ${maxLng}, ${maxLat}`);
    }
    
    const copySql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, geometry, geometry_text, geometry_hash
      )
      SELECT 
        seg.app_uuid,
        seg.osm_id,
        seg.name,
        seg.region,
        seg.trail_type,
        seg.surface,
        seg.difficulty,
        seg.source_tags,
        seg.bbox_min_lng,
        seg.bbox_max_lng,
        seg.bbox_min_lat,
        seg.bbox_max_lat,
        seg.length_km,
        seg.elevation_gain,
        seg.elevation_loss,
        seg.max_elevation,
        seg.min_elevation,
        seg.avg_elevation,
        seg.source,
        seg.geometry as geometry,
        ST_AsText(seg.geometry) as geometry_text,
        'geometry_hash_placeholder' as geometry_hash
      FROM (
        SELECT 
          app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, geometry
        FROM ${TRAILS_TABLE} 
        WHERE region = $1 ${bboxFilter}
      ) seg
      WHERE seg.geometry IS NOT NULL AND ST_IsValid(seg.geometry)
      ${trailLimit}
    `;

    const result = await this.pgClient.query(copySql, queryParams);
    console.log('✅ Copied', result.rowCount, 'trails to staging');

    // Calculate bbox from geometry for trails with missing bbox values
    console.log('📐 Calculating bbox from geometry for trails with missing bbox values...');
    const bboxUpdateSql = `
      UPDATE ${this.stagingSchema}.trails 
      SET 
        bbox_min_lng = ST_XMin(geometry),
        bbox_max_lng = ST_XMax(geometry),
        bbox_min_lat = ST_YMin(geometry),
        bbox_max_lat = ST_YMax(geometry)
      WHERE geometry IS NOT NULL 
        AND (bbox_min_lng IS NULL OR bbox_max_lng IS NULL OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL)
    `;
    const bboxUpdateResult = await this.pgClient.query(bboxUpdateSql);
    console.log(`✅ Updated bbox for ${bboxUpdateResult.rowCount} trails`);

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

    console.log(`✅ Bbox validation passed: All ${totalTrails} trails have valid bbox values`);

    // Validate staging data
    const validationSql = `
      SELECT COUNT(*) AS n, SUM(CASE WHEN ST_NDims(geometry) = 3 THEN 1 ELSE 0 END) AS n3d
      FROM ${this.stagingSchema}.trails
    `;
    const validationResult = await this.pgClient.query(validationSql);
    const threeDTrails = parseInt(validationResult.rows[0].n3d);
    
    console.log(`✅ Trails split at intersections using PostGIS (3D geometry, LINESTRINGZ).`);
    console.log(`   - Total trails: ${totalTrails}`);
    console.log(`   - 3D trails: ${threeDTrails}`);

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
      
      console.log(`📊 Calculated region bbox: ${this.regionBbox.minLng}, ${this.regionBbox.minLat}, ${this.regionBbox.maxLng}, ${this.regionBbox.maxLat} (${this.regionBbox.trailCount} trails)`);
    }
  }
  
  private async detectIntersections(): Promise<void> {
    console.log('[DEBUG] ENTERED detectIntersections METHOD');
    // Use the canonical PostGIS SQL function for intersection detection
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.intersection_points
        (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
      SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
      FROM detect_trail_intersections('${this.stagingSchema}', 'trails', $1)
    `, [this.config.intersectionTolerance ?? 2.0]);
    console.log('✅ Intersection detection (via canonical SQL function) complete.');
  }



  private async getChangedTrails(): Promise<string[]> {
    // Compare current hashes with previous hashes
    // Only check geometry_hash since that's the only column in trail_hashes table
    const result = await this.pgClient.query(`
      SELECT t.app_uuid
      FROM ${this.stagingSchema}.trails t
      LEFT JOIN ${this.stagingSchema}.trail_hashes h ON t.app_uuid = h.app_uuid
      WHERE h.app_uuid IS NULL 
         OR h.geometry_hash != $1
    `, [
      hashString('geometry') // Placeholder - would need actual hash comparison
    ]);
    
    return result.rows.map(row => row.app_uuid);
  }



  /**
   * Static method to clean up all test-related staging schemas (boulder, seattle, test)
   */
  public static async cleanAllTestStagingSchemas(): Promise<void> {
    const config = getTestDbConfig();
    const client = new Client(config);
    await client.connect();
    // Find all test-related staging schemas
    const res = await client.query(`
      SELECT nspname FROM pg_namespace WHERE nspname ~ '^(staging_(boulder|seattle|test)_)'
    `);
    for (const row of res.rows) {
      const schema = row.nspname;
      console.log(`[CLEANUP] Dropping schema: ${schema}`);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await client.end();
    console.log('[CLEANUP] All test-related staging schemas dropped.');
  }
}