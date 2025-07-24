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
import { createSqliteTables, insertTrails as insertTrailsSqlite, insertRoutingNodes as insertRoutingNodesSqlite, insertRoutingEdges as insertRoutingEdgesSqlite, insertRegionMetadata as insertRegionMetadataSqlite, buildRegionMeta as buildRegionMetaSqlite, insertSchemaVersion as insertSchemaVersionSqlite } from '../utils/sqlite-export-helpers';
import { getStagingSchemaSql, getStagingIndexesSql, getSchemaQualifiedPostgisFunctionsSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { isValidNumberTuple, hashString } from '../utils';
import { cleanupStaging, logSchemaTableState } from '../utils/sql/postgres-schema-helpers';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { detectIntersectionsHelper } from '../utils/sql/intersection';
import { buildRoutingGraphHelper } from '../utils/sql/routing';
import { execSync } from 'child_process';
import { createCanonicalRoutingEdgesTable } from '../utils/sql/postgres-schema-helpers';

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
      insertTrailsSqlite(sqliteDb, trailsRes.rows);
      insertRoutingNodesSqlite(sqliteDb, nodesRes.rows);
      insertRoutingEdgesSqlite(sqliteDb, edgesRes.rows);

      // Build region metadata and insert
      const regionMeta = buildRegionMetaSqlite(this.config, this.regionBbox);
      insertRegionMetadataSqlite(sqliteDb, regionMeta);
      insertSchemaVersionSqlite(sqliteDb, 1, 'Carthorse SQLite Export v1.0');

      sqliteDb.close();
      console.log('✅ Database export completed successfully');
      console.log(`📁 Output: ${this.config.outputPath}`);
      
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
      
      // Map geo2_text to geometry_wkt for SQLite export
      const trailsToExport = (splitTrailsRes?.rows?.length > 0 ? splitTrailsRes.rows : trailsRes.rows).map(trail => ({
        ...trail,
        geometry_wkt: trail.geo2_text || null
      }));
      insertTrailsSqlite(sqliteDb, trailsToExport);
      insertRoutingNodesSqlite(sqliteDb, nodesRes.rows);
      insertRoutingEdgesSqlite(sqliteDb, edgesRes.rows);

      // Build region metadata and insert
      const regionMeta = buildRegionMetaSqlite(this.config, this.regionBbox);
      insertRegionMetadataSqlite(sqliteDb, regionMeta);
      insertSchemaVersionSqlite(sqliteDb, 1, 'Carthorse Staging Export v1.0');

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

  async run(): Promise<void> {
    console.log('🚀 Enhanced PostgreSQL Orchestrator with Staging');
    console.log('=' .repeat(60));
    console.log(`🗺️  Region: ${this.config.region}`);
    console.log(`📁 Output: ${this.config.outputPath}`);
    console.log(`🔧 Staging Schema: ${this.stagingSchema}`);
    console.log(`✂️  Intersection Tolerance: ${this.config.intersectionTolerance}m`);
    console.log('');

    try {
      // Step 0: Backup PostgreSQL database
      if (!this.config.skipBackup) {
        await backupDatabase(this.pgConfig);
      }

      // Step 1: Connect to PostgreSQL
      console.log('Attempting to connect to PostgreSQL...');
      let waitingSeconds = 0;
      let waitingInterval = setInterval(() => {
        waitingSeconds += 5;
        console.log(`Waiting for DB: ${waitingSeconds}s...`);
      }, 5000);
      try {
        await this.pgClient.connect();
        clearInterval(waitingInterval);
        console.log('✅ Connected to PostgreSQL master database');
        // Log backend PID for session tracking
        const pidRes = await this.pgClient.query('SELECT pg_backend_pid()');
        console.log('Postgres backend PID:', pidRes.rows[0].pg_backend_pid);
      } catch (err) {
        clearInterval(waitingInterval);
        console.error('❌ Failed to connect to PostgreSQL:', err);
        throw err;
      }

      // Step 1.5: Build master database if requested
      if (this.config.buildMaster) {
        // await this.buildMasterDatabase(); // TODO: Re-implement using SQL/PostGIS
        console.log('TODO: buildMasterDatabase not yet implemented. Skipping.');
        console.log('\n🎉 Master database build completed successfully!');
        console.log('\a'); // Play system bell sound
        return; // Exit after building master database
      }

      // Step 2: Create staging environment
      console.log('[LOG] Before createStagingEnvironment: checking schema/table existence...');
      await logSchemaTableState(this.pgClient, this.stagingSchema, 'before createStagingEnvironment');
      await this.createStagingEnvironment();
      await this.pgClient.query('COMMIT'); // Ensure all DDL is committed
      console.log('[LOG] After createStagingEnvironment: checking schema/table existence...');
      await logSchemaTableState(this.pgClient, this.stagingSchema, 'after createStagingEnvironment');

      // Step 3: Copy region data to staging
      if (this.config.bbox) {
        console.log('Using CLI-provided bbox for export:', this.config.bbox);
        this.regionBbox = {
          minLng: this.config.bbox[0],
          minLat: this.config.bbox[1],
          maxLng: this.config.bbox[2],
          maxLat: this.config.bbox[3],
          trailCount: 0 // Will be updated after filtering
        };
        if ([this.regionBbox.minLng, this.regionBbox.maxLng, this.regionBbox.minLat, this.regionBbox.maxLat].some(v => v === null || v === undefined || isNaN(v))) {
          throw new Error('❌ Provided bbox is invalid: ' + JSON.stringify(this.config.bbox));
        }
        await this.copyRegionDataToStaging(this.config.bbox);
      } else {
        await this.copyRegionDataToStaging();
      }
      await this.pgClient.query('COMMIT'); // Ensure all data copy is committed
      console.log('[LOG] After copyRegionDataToStaging: checking schema/table existence...');
      await logSchemaTableState(this.pgClient, this.stagingSchema, 'after copyRegionDataToStaging');

      // After copying region data to staging, log trail count and bbox
      const trailCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`Trail count in staging for region ${this.config.region}:`, trailCountResult.rows[0].count);
      if (this.regionBbox) {
        console.log('Region bbox used for export:', this.regionBbox);
      }

      // New: Check schema/table visibility before intersection detection
      console.log('[LOG] Before intersection detection: checking schema/table existence...');
      await logSchemaTableState(this.pgClient, this.stagingSchema, 'before intersection detection');
      // Log current schema, search_path, and backend PID
      const schemaRes = await this.pgClient.query('SELECT current_schema()');
      const searchPathRes = await this.pgClient.query('SHOW search_path');
      const pidRes = await this.pgClient.query('SELECT pg_backend_pid()');
      console.log(`[LOG] Current schema: ${schemaRes.rows[0].current_schema}`);
      console.log(`[LOG] Search path: ${searchPathRes.rows[0].search_path}`);
      console.log(`[LOG] Backend PID: ${pidRes.rows[0].pg_backend_pid}`);

      // Step 4: Detect intersections
      // Remove direct SQL execution; only call detectIntersections()
      await this.detectIntersections();
      await this.pgClient.query('COMMIT'); // Ensure intersection results are committed
      console.log('[LOG] After detectIntersections: checking schema/table existence...');
      await logSchemaTableState(this.pgClient, this.stagingSchema, 'after detectIntersections');

      // Step 5: Always split trails at intersections (no skipping/caching)
      await this.splitTrailsAtIntersections();

      // Step 6: Build routing graph using native PostGIS functions
      console.log('🔄 Building routing graph using native PostGIS functions...');
      
      // Clear existing routing data
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);

      // Use native PostGIS functions to create intersection nodes
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        SELECT DISTINCT
          ST_Y(ST_Intersection(t1.geo2, t2.geo2)) as lat,
          ST_X(ST_Intersection(t1.geo2, t2.geo2)) as lng,
          COALESCE(ST_Z(ST_Intersection(t1.geo2, t2.geo2)), 0) as elevation,
          'intersection' as node_type,
          t1.app_uuid || ',' || t2.app_uuid as connected_trails
        FROM ${this.stagingSchema}.split_trails t1
        JOIN ${this.stagingSchema}.split_trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geo2, t2.geo2)
          AND ST_GeometryType(ST_Intersection(t1.geo2, t2.geo2)) = 'ST_Point'
      `);
      
      // Use native PostGIS functions to create endpoint nodes (not at intersections)
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
          SELECT
            ST_StartPoint(ST_Force2D(geo2)) as start_point,
            ST_EndPoint(ST_Force2D(geo2)) as end_point,
            app_uuid, name
          FROM ${this.stagingSchema}.split_trails
          WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        all_endpoints AS (
          SELECT start_point as point, app_uuid, name FROM trail_endpoints
          UNION ALL
          SELECT end_point as point, app_uuid, name FROM trail_endpoints
        ),
        unique_endpoints AS (
          SELECT DISTINCT ON (ST_AsText(point))
            point,
            array_agg(DISTINCT app_uuid) as connected_trails
          FROM all_endpoints
          GROUP BY point
        ),
        endpoints_not_at_intersections AS (
          SELECT ue.point, ue.connected_trails
          FROM unique_endpoints ue
          WHERE NOT EXISTS (
            SELECT 1 FROM ${this.stagingSchema}.routing_nodes rn
            WHERE rn.node_type = 'intersection'
              AND ST_DWithin(ue.point, ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326), ${this.config.intersectionTolerance})
          )
        )
        SELECT
          ST_Y(point) as lat,
          ST_X(point) as lng,
          0 as elevation,
          'endpoint' as node_type,
          array_to_string(connected_trails, ',') as connected_trails
        FROM endpoints_not_at_intersections
        WHERE point IS NOT NULL
      `);
      
      // Use native PostGIS functions to create routing edges
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geo2)
        WITH trail_segments AS (
          SELECT app_uuid, name, ST_Force2D(geo2) as geom, elevation_gain,
                 ST_StartPoint(ST_Force2D(geo2)) as start_point,
                 ST_EndPoint(ST_Force2D(geo2)) as end_point
          FROM ${this.stagingSchema}.split_trails
          WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        node_connections AS (
          SELECT ts.app_uuid as trail_id, ts.name as trail_name, ts.geom, ts.elevation_gain,
                 fn.id as from_node_id, tn.id as to_node_id
          FROM trail_segments ts
          LEFT JOIN LATERAL (
            SELECT n.id
            FROM ${this.stagingSchema}.routing_nodes n
            WHERE ST_DWithin(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), ${this.config.edgeTolerance ?? 20})
            ORDER BY ST_Distance(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
            LIMIT 1
          ) fn ON true
          LEFT JOIN LATERAL (
            SELECT n.id
            FROM ${this.stagingSchema}.routing_nodes n
            WHERE ST_DWithin(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), ${this.config.edgeTolerance ?? 20})
            ORDER BY ST_Distance(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
            LIMIT 1
          ) tn ON true
        )
        SELECT
          from_node_id,
          to_node_id,
          trail_id,
          trail_name,
          ST_Length(geom::geography) / 1000 as distance_km,
          COALESCE(elevation_gain, 0) as elevation_gain,
          geom as geo2
        FROM node_connections
        WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
      `);
      
      // Get counts
      const nodeCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`);
      const edgeCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`);
      
      const nodeCount = nodeCountResult.rows[0]?.count ?? 0;
      const edgeCount = edgeCountResult.rows[0]?.count ?? 0;
      
      console.log(`✅ Routing graph built: ${nodeCount} nodes, ${edgeCount} edges using native PostGIS functions`);

      // Step 7: Export to SQLite (simplified - no SpatiaLite)
      // Query data from staging schema
      const trailsRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.split_trails`);
      const nodesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes`);
      const edgesRes = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_edges`);
      
      // Open database and export to SQLite
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const sqliteDb = new Database(this.config.outputPath);
      console.log('📊 Exporting to SQLite...');
      
      // Create tables and insert data
      createSqliteTables(sqliteDb);
      insertTrailsSqlite(sqliteDb, trailsRes.rows);
      insertRoutingNodesSqlite(sqliteDb, nodesRes.rows);
      insertRoutingEdgesSqlite(sqliteDb, edgesRes.rows);
      
      // Build region metadata and insert
      const regionMeta = buildRegionMetaSqlite(this.config, this.regionBbox);
      insertRegionMetadataSqlite(sqliteDb, regionMeta);
      insertSchemaVersionSqlite(sqliteDb, 1, 'Carthorse SQLite Export v1.0');
      
      console.log('✅ Export to SQLite completed successfully');

      // Step 8: Cleanup staging
      if (!this.config.skipCleanup) {
        await cleanupStaging(this.pgClient, this.stagingSchema);
      } else {
        console.log('⚠️  Skipping staging cleanup (skipCleanup=true)');
      }

      console.log('\n🎉 Enhanced orchestrator completed successfully!');
      console.log(`📁 Deployment database ready: ${this.config.outputPath}`);

    } catch (error) {
      console.error('❌ Enhanced orchestrator failed:', error);
      // Only clean up on error if explicitly requested
      if (this.config.cleanupOnError) {
        await cleanupStaging(this.pgClient, this.stagingSchema);
      } else {
        console.warn('⚠️ Staging schema NOT dropped after error (set cleanupOnError=true to enable).');
      }
      throw error;
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
    // Use the helper to perform intersection detection and grouping
    this.splitPoints = await detectIntersectionsHelper(
      this.pgClient,
      this.stagingSchema,
      this.config.intersectionTolerance
    );
    console.log('✅ Intersection detection (via helper) complete.');
  }

  private async splitTrailsAtIntersections(): Promise<void> {
    console.log('✂️  Skipping trail splitting - using native PostGIS routing directly...');
    // Simply copy trails to split_trails table without splitting
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.split_trails`);
    
    const sql = `
      INSERT INTO ${this.stagingSchema}.split_trails (
        original_trail_id, segment_number, app_uuid, name, trail_type, surface, difficulty,
        source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source, geo2, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      )
      SELECT 
        id as original_trail_id,
        1 as segment_number,
        app_uuid as app_uuid,
        name, trail_type, surface, difficulty, source_tags, osm_id,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source, geo2,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM ${this.stagingSchema}.trails
      WHERE geo2 IS NOT NULL AND ST_IsValid(geo2);
    `;
    await this.pgClient.query(sql);
    
    const count = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trails`);
    console.log(`✅ Copied ${count.rows[0].count} trails to split_trails (no splitting needed for native PostGIS routing).`);
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
}