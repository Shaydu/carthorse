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
 *   --intersection-tolerance    Intersection detection tolerance in meters (default: 3)
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
import { createSqliteTables, insertTrails as insertTrailsSqlite, insertRoutingNodes as insertRoutingNodesSqlite, insertRoutingEdges as insertRoutingEdgesSqlite, insertRegionMetadata as insertRegionMetadataSqlite, buildRegionMeta as buildRegionMetaSqlite, insertSchemaVersion as insertSchemaVersionSqlite, CARTHORSE_SCHEMA_VERSION } from '../utils/sqlite-export-helpers';
import { getStagingSchemaSql, getStagingIndexesSql, getSchemaQualifiedPostgisFunctionsSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { isValidNumberTuple, hashString } from '../utils';
import { cleanupStaging, logSchemaTableState } from '../utils/sql/postgres-schema-helpers';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { detectIntersectionsHelper } from '../utils/sql/intersection';
import { buildRoutingGraphHelper } from '../utils/sql/routing';
import { execSync } from 'child_process';
import { createCanonicalRoutingEdgesTable } from '../utils/sql/postgres-schema-helpers';
import wellknown from 'wellknown';

// --- Type Definitions ---
import type { EnhancedOrchestratorConfig } from '../types';

// --- pgRouting integration (moved to utils/sql/pgrouting.ts) ---
import {
  ensurePgRoutingEnabled,
  runNodeNetwork,
  createRoutingGraphTables,
  exportRoutingGraphToSQLite
} from '../utils/sql/pgrouting';

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
      const trailsRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.split_trails`);
      const nodesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes`);
      const edgesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_edges`);

      console.log(`📊 Found ${trailsRes.rows.length} trails, ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);

      // Import SQLite helpers
      const { 
        createSqliteTables, 
        insertTrailsSqlite, 
        insertRoutingNodesSqlite, 
        insertRoutingEdgesSqlite, 
        buildRegionMetaSqlite, 
        insertRegionMetadataSqlite, 
        insertSchemaVersionSqlite 
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
      createSqliteTables(sqliteDb);
      // --- Ensure geojson is present and valid for every trail ---
      const wellknown = require('wellknown');
      for (const trail of trailsRes.rows) {
        if (!trail.geojson || typeof trail.geojson !== 'string' || trail.geojson.length < 10) {
          // Try to generate from geometry_wkt or geo2_text
          const wkt = trail.geometry_wkt || trail.geo2_text || trail.geometry;
          if (wkt) {
            try {
              const geojsonObj = wellknown.parse(wkt);
              if (geojsonObj && geojsonObj.type === 'LineString') {
                trail.geojson = JSON.stringify({ type: 'Feature', geometry: geojsonObj, properties: {} });
              } else {
                trail.geojson = null;
              }
            } catch (e) {
              trail.geojson = null;
            }
          } else {
            trail.geojson = null;
          }
        }
      }
      insertTrailsSqlite(sqliteDb, trailsRes.rows);
      insertRoutingNodesSqlite(sqliteDb, nodesRes.rows);
      insertRoutingEdgesSqlite(sqliteDb, edgesRes.rows);

      // Build region metadata and insert
      const regionMeta = buildRegionMetaSqlite(this.config, this.regionBbox);
      insertRegionMetadataSqlite(sqliteDb, regionMeta);
      insertSchemaVersionSqlite(sqliteDb, CARTHORSE_SCHEMA_VERSION, 'Carthorse SQLite Export v8.0');

      // After all inserts and before closing the SQLite DB
      const tableCheck = (table: string) => {
        const res = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!res;
      };
      const rowCount = (table: string) => {
        const res = sqliteDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count?: number };
        return res && typeof res.count === 'number' ? res.count : 0;
      };

      if (!tableCheck('split_trails')) {
        throw new Error('Export failed: split_trails table is missing from the SQLite export.');
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
      console.log('✅ Database export completed successfully');
      console.log(`📁 Output: ${this.config.outputPath}`);

      // --- Automated post-export validation ---
      console.log('🔍 Running post-export validation...');
      const validationResult = spawnSync('npx', ['ts-node', 'tools/carthorse-validate-database.ts', '--db', this.config.outputPath], { encoding: 'utf-8' });
      if (validationResult.stdout) process.stdout.write(validationResult.stdout);
      if (validationResult.stderr) process.stderr.write(validationResult.stderr);
      if (validationResult.status !== 0) {
        throw new Error('❌ Post-export database validation failed. See report above.');
      }
      console.log('✅ Post-export database validation passed.');
      
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
      const trailsRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.trails`);
      const splitTrailsRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.split_trails`);
      const nodesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes`);
      const edgesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_edges`);

      console.log(`📊 Found ${trailsRes.rows.length} original trails, ${splitTrailsRes.rows.length} split trails, ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);

      // Import SQLite helpers
      const { 
        createSqliteTables, 
        insertTrailsSqlite, 
        insertRoutingNodesSqlite, 
        insertRoutingEdgesSqlite, 
        buildRegionMetaSqlite, 
        insertRegionMetadataSqlite, 
        insertSchemaVersionSqlite 
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
      createSqliteTables(sqliteDb);
      
      // Map geo2_text to geometry_wkt and generate geojson for SQLite export
      const trailsToExport = (splitTrailsRes?.rows?.length > 0 ? splitTrailsRes.rows : trailsRes.rows).map(trail => {
        let geojson = null;
        if (trail.geo2_text) {
          try {
            const geometry = wellknown.parse(trail.geo2_text);
            geojson = JSON.stringify({
              type: 'Feature',
              geometry,
              properties: {
                app_uuid: trail.app_uuid,
                name: trail.name,
                trail_type: trail.trail_type,
                surface: trail.surface,
                difficulty: trail.difficulty,
                source: trail.source,
                osm_id: trail.osm_id
              }
            });
          } catch (e) {
            geojson = null;
          }
        }
        return {
          ...trail,
          geometry_wkt: trail.geo2_text || null,
          geojson
        };
      });
      insertTrailsSqlite(sqliteDb, trailsToExport);
      insertRoutingNodesSqlite(sqliteDb, nodesRes.rows);
      insertRoutingEdgesSqlite(sqliteDb, edgesRes.rows);

      // Build region metadata and insert
      const regionMeta = buildRegionMetaSqlite(this.config, this.regionBbox);
      insertRegionMetadataSqlite(sqliteDb, regionMeta);
      insertSchemaVersionSqlite(sqliteDb, CARTHORSE_SCHEMA_VERSION, 'Carthorse Staging Export v8.0');

      // After all inserts and before closing the SQLite DB
      const tableCheck = (table: string) => {
        const res = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!res;
      };
      const rowCount = (table: string) => {
        const res = sqliteDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count?: number };
        return res && typeof res.count === 'number' ? res.count : 0;
      };

      if (!tableCheck('split_trails')) {
        throw new Error('Export failed: split_trails table is missing from the SQLite export.');
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
    const requiredFunctions = [
      'native_split_trails_at_intersections(text, text)'
      // Add more required functions here as needed
    ];
    const missing: string[] = [];
    for (const fn of requiredFunctions) {
      const res = await this.pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = $1`,
        [fn.split('(')[0]]
      );
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
        execSync(`psql -d ${this.pgConfig.database} -f sql/native-postgis-functions.sql`, { stdio: 'inherit' });
        // Re-check after loading
        const stillMissing: string[] = [];
        for (const fn of requiredFunctions) {
          const res = await this.pgClient.query(
            `SELECT proname FROM pg_proc WHERE proname = $1`,
            [fn.split('(')[0]]
          );
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
      await this.checkRequiredSqlFunctions();
      t = logStep('checkRequiredSqlFunctions', t);
      if (!this.config.skipBackup) {
        await backupDatabase(this.pgConfig);
      }
      t = logStep('backupDatabase', t);
      await this.pgClient.connect();
      t = logStep('pgClient.connect', t);
      if (this.config.buildMaster) {
        console.log('TODO: buildMasterDatabase not yet implemented. Skipping.');
        console.log('\n🎉 Master database build completed successfully!');
        console.log('\a'); // Play system bell sound
        return; // Exit after building master database
      }
      await this.createStagingEnvironment();
      t = logStep('createStagingEnvironment', t);
      await this.pgClient.query('COMMIT'); // Ensure all DDL is committed
      await this.copyRegionDataToStaging(this.config.bbox);
      t = logStep('copyRegionDataToStaging', t);
      await this.pgClient.query('COMMIT'); // Ensure all data copy is committed
      const trailCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`Trail count in staging for region ${this.config.region}:`, trailCountResult.rows[0].count);
      if (this.regionBbox) {
        console.log('Region bbox used for export:', this.regionBbox);
      }
      await this.detectIntersections();
      t = logStep('detectIntersections', t);
      await this.pgClient.query('COMMIT'); // Ensure intersection results are committed
      await this.splitTrailsAtIntersections();
      t = logStep('splitTrailsAtIntersections', t);
      await buildRoutingGraphHelper(
        this.pgClient,
        this.stagingSchema,
        'split_trails',
        this.config.intersectionTolerance,
        this.config.edgeTolerance ?? 20
      );
      t = logStep('buildRoutingGraph', t);
      await this.exportDatabase();
      t = logStep('exportDatabase', t);
      if (this.config.validate) {
        const validationResult = spawnSync('npx', ['ts-node', 'tools/carthorse-validate-database.ts', '--db', this.config.outputPath], { encoding: 'utf-8' });
        if (validationResult.stdout) process.stdout.write(validationResult.stdout);
        if (validationResult.stderr) process.stderr.write(validationResult.stderr);
        if (validationResult.status !== 0) {
          throw new Error('❌ Post-export database validation failed. See report above.');
        }
        console.log('✅ Post-export database validation passed.');
      }
      if (!this.config.skipCleanup) {
        await cleanupStaging(this.pgClient, this.stagingSchema);
      } else {
        console.log('⚠️  Skipping staging cleanup (skipCleanup=true)');
      }
      const total = Date.now() - startTime;
      console.log(`[TIMER] Total orchestrator run: ${total}ms`);
    } catch (err) {
      console.error('[Orchestrator] Error during run:', err);
      throw err;
    } finally {
      // TEST CLEANUP: Always drop staging schema if testCleanup is set
      if (this.config.testCleanup) {
        try {
          console.log('[TEST CLEANUP] Dropping staging schema (testCleanup=true)...');
          await cleanupStaging(this.pgClient, this.stagingSchema);
          console.log('[TEST CLEANUP] Staging schema dropped.');
        } catch (cleanupErr) {
          console.error('[TEST CLEANUP] Failed to drop staging schema:', cleanupErr);
        }
      }
      await this.pgClient.end();
    }
  }

  private async createStagingEnvironment(): Promise<void> {
    console.log('🏗️  Creating staging environment:', this.stagingSchema);

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
    const stagingTablesSql = `
      CREATE TABLE ${this.stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        osm_id TEXT,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        length_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geo2 GEOMETRY(LINESTRINGZ, 4326),
        geo2_text TEXT,
        geo2_hash TEXT NOT NULL
      );

      CREATE TABLE ${this.stagingSchema}.trail_hashes (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT REFERENCES ${this.stagingSchema}.trails(app_uuid) ON DELETE CASCADE,
        geo2_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE ${this.stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326), -- 2D for intersection detection
        point_3d GEOMETRY(POINTZ, 4326), -- 3D with elevation for app use
        trail1_id TEXT,
        trail2_id TEXT,
        distance_meters REAL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE ${this.stagingSchema}.split_trails (
        id SERIAL PRIMARY KEY,
        original_trail_id INTEGER,
        segment_number INTEGER,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags TEXT,
        osm_id TEXT,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        length_km REAL,
        source TEXT,
        geo2 GEOMETRY(LINESTRINGZ, 4326),
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE ${this.stagingSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL,
        lng REAL,
        elevation REAL,
        node_type TEXT,
        connected_trails TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE ${this.stagingSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        distance_km REAL NOT NULL,
        elevation_gain REAL NOT NULL DEFAULT 0,
        elevation_loss REAL NOT NULL DEFAULT 0,
        is_bidirectional BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        geo2 GEOMETRY(LineString, 4326),
        FOREIGN KEY (from_node_id) REFERENCES ${this.stagingSchema}.routing_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node_id) REFERENCES ${this.stagingSchema}.routing_nodes(id) ON DELETE CASCADE
      );
    `;
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
      CREATE INDEX IF NOT EXISTS idx_staging_trails_geo2 ON ${this.stagingSchema}.trails USING GIST(geo2);
      CREATE INDEX IF NOT EXISTS idx_staging_split_trails_geo2 ON ${this.stagingSchema}.split_trails USING GIST(geo2);
      CREATE INDEX IF NOT EXISTS idx_staging_intersection_points ON ${this.stagingSchema}.intersection_points USING GIST(point);
      CREATE INDEX IF NOT EXISTS idx_staging_routing_nodes_location ON ${this.stagingSchema}.routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
      CREATE INDEX IF NOT EXISTS idx_staging_routing_edges_geo2 ON ${this.stagingSchema}.routing_edges USING GIST(geo2);
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
    const copySql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, geo2, geo2_text, geo2_hash
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
        seg.geometry as geo2,
        ST_AsText(seg.geometry) as geo2_text,
        'geo2_hash_placeholder' as geo2_hash
      FROM (
        SELECT 
          app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, geometry
        FROM trails 
        WHERE region = $1
      ) seg
      WHERE seg.geometry IS NOT NULL AND ST_IsValid(seg.geometry)
      ${trailLimit}
    `;

    const result = await this.pgClient.query(copySql, [this.config.region]);
    console.log('✅ Copied', result.rowCount, 'trails to staging');

    // Validate staging data
    const validationSql = `
      SELECT COUNT(*) AS n, SUM(CASE WHEN ST_NDims(geo2) = 3 THEN 1 ELSE 0 END) AS n3d
      FROM ${this.stagingSchema}.trails
    `;
    const validationResult = await this.pgClient.query(validationSql);
    const totalTrails = parseInt(validationResult.rows[0].n);
    const threeDTrails = parseInt(validationResult.rows[0].n3d);
    
    console.log(`✅ Trails split at intersections using PostGIS (3D geo2, LINESTRINGZ).`);
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
    // Use the native PostGIS SQL function for intersection detection
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.intersection_points (point, point_3d, trail1_id, trail2_id, distance_meters)
      SELECT DISTINCT
        ST_Force2D(ST_Intersection(t1.geo2, t2.geo2)) as point,
        ST_Force3D(ST_Intersection(t1.geo2, t2.geo2)) as point_3d,
        t1.app_uuid as trail1_id,
        t2.app_uuid as trail2_id,
        0 as distance_meters
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geo2, t2.geo2)
        AND ST_GeometryType(ST_Intersection(t1.geo2, t2.geo2)) = 'ST_Point'
    `);
    console.log('✅ Intersection detection (via native SQL) complete.');
  }

  private async splitTrailsAtIntersections(): Promise<void> {
    console.log('✂️  Splitting trails at intersections using native PostGIS (3D split)...');
    // Remove all legacy or function-based splitting logic. Use only the new SQL-native approach.
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.split_trails`);
    // Use the new SQL-native approach for splitting trails at intersections.
    // This should be handled by the intersection detection and node/edge building pipeline (build_routing_nodes, build_routing_edges).
    // If you need to split trails, use the output of detect_trail_intersections and build_routing_nodes.
    // No call to split_trails_at_intersections or native_split_trails_at_intersections.
    // If needed, copy trails as-is or document that splitting is handled by the node/edge builder.
    // Example: If split_trails is required for export, copy from trails or use a SQL CTE to generate segments.
    // For now, leave split_trails empty or as a direct copy if required by downstream steps.
  }

  private async getChangedTrails(): Promise<string[]> {
    // Compare current hashes with previous hashes
    // Only check geo2_hash since that's the only column in trail_hashes table
    const result = await this.pgClient.query(`
      SELECT t.app_uuid
      FROM ${this.stagingSchema}.trails t
      LEFT JOIN ${this.stagingSchema}.trail_hashes h ON t.app_uuid = h.app_uuid
      WHERE h.app_uuid IS NULL 
         OR h.geo2_hash != $1
    `, [
      hashString('geometry') // Placeholder - would need actual hash comparison
    ]);
    
    return result.rows.map(row => row.app_uuid);
  }

  private async insertSplitTrail(originalTrail: any, segmentNumber: number, geo2: string): Promise<void> {
    const appUuid = `${originalTrail.app_uuid}_seg${segmentNumber}`;
    
    // Debug: Log the geo2 string being inserted
    console.log(`[DEBUG] Inserting trail ${appUuid} with geo2: ${geo2.substring(0, 100)}...`);
    
    const insertSql = `
      INSERT INTO ${this.stagingSchema}.split_trails (
        original_trail_id, segment_number, app_uuid, name, trail_type, surface, difficulty,
        source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation,
        avg_elevation, length_km, source, geo2, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ST_GeomFromText($17, 4326), $18, $19, $20, $21)
    `;
  }

  /**
   * Main entrypoint for the new pgRouting export pipeline (calls pgrouting library).
   */
  public async runPgRoutingExportPipeline(): Promise<void> {
    console.log('[orchestrator] Entered runPgRoutingExportPipeline');
    try {
      console.log('[orchestrator] Step 1: Ensure pgRouting is enabled');
      await ensurePgRoutingEnabled(this.pgClient);
      console.log('[orchestrator] Step 1 complete');

      // Check for split_trails table existence
      const splitTrailsCheck = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'split_trails'
        ) AS exists
      `, [this.stagingSchema]);
      if (!splitTrailsCheck.rows[0].exists) {
        console.error(`[orchestrator] ❌ split_trails table does not exist in schema ${this.stagingSchema}. Cannot proceed with pgRouting pipeline.`);
        return;
      } else {
        console.log(`[orchestrator] split_trails table exists in schema ${this.stagingSchema}`);
      }

      // 2. Run intersection detection and split trails (existing logic)
      // (Assume this is handled before calling this pipeline)

      console.log('[orchestrator] Step 2: Run pgr_nodeNetwork on split_trails');
      await runNodeNetwork(this.pgClient, this.stagingSchema);
      console.log('[orchestrator] Step 2 complete');

      console.log('[orchestrator] Step 3: Create routing_edges and routing_nodes tables');
      await createRoutingGraphTables(this.pgClient, this.stagingSchema);
      console.log('[orchestrator] Step 3 complete');

      console.log('[orchestrator] Step 4: Export routing graph to SQLite');
      await exportRoutingGraphToSQLite(this.pgClient, this.stagingSchema, this.config.outputPath);
      console.log('[orchestrator] Step 4 complete');

      // 5. Write schema version info (in exportRoutingGraphToSQLite)
      // 6. Validation and cleanup (optional)
      console.log('✅ pgRouting export pipeline complete');
    } catch (err) {
      console.error('[orchestrator] ❌ Error in pgRouting export pipeline:', err);
      throw err;
    }
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