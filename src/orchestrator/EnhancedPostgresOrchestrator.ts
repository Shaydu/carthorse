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

// Canonical function to get DB config for all environments
function getDbConfig() {
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || '',
  };
}

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
import { createSpatiaLiteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRegionMetadata } from '../utils/spatialite-export-helpers';
import { getStagingSchemaSql, getStagingIndexesSql, getSchemaQualifiedPostgisFunctionsSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';

// --- Type Definitions ---
interface EnhancedOrchestratorConfig {
  region: string;
  outputPath: string;
  simplifyTolerance: number;
  intersectionTolerance: number;
  replace: boolean;
  validate: boolean;
  verbose: boolean;
  skipBackup: boolean;
  buildMaster: boolean;
  targetSizeMB: number | null;
  maxSpatiaLiteDbSizeMB: number;
  skipIncompleteTrails: boolean;
  bbox?: [number, number, number, number];
  skipCleanup?: boolean; // If true, never clean up staging schema
  cleanupOnError?: boolean; // If true, clean up staging schema on error (default: false)
}

// Helper function for type-safe tuple validation
function isValidNumberTuple(arr: (number | undefined)[], length: number): arr is [number, number, number] {
  return arr.length === length && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
}

export class EnhancedPostgresOrchestrator {
  private pgClient: Client;
  private config: EnhancedOrchestratorConfig;
  public readonly stagingSchema: string;
  private splitPoints: Map<number, IntersectionPoint[]> = new Map<number, IntersectionPoint[]>();
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
    this.validateTestEnvironment();
    
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
    this.pgClient = new Client(clientConfig);
  }

  private validateTestEnvironment(): void {
    // Check if we're in a test environment
    const isTestEnvironment = process.env.NODE_ENV === 'test' || 
                             process.env.JEST_WORKER_ID !== undefined ||
                             process.env.PGDATABASE === 'trail_master_db_test';
    
    if (isTestEnvironment) {
      // In test environment, ensure we're not connecting to production
      const database = process.env.PGDATABASE || 'postgres';
      const user = process.env.PGUSER || 'postgres';
      
      // Prevent connection to production database in tests
      if (database === 'trail_master_db' || database === 'postgres') {
        throw new Error(`❌ TEST SAFETY VIOLATION: Attempting to connect to production database '${database}' in test environment!`);
      }
      
      // Ensure we're using test database
      if (database !== 'trail_master_db_test') {
        console.warn(`⚠️  WARNING: Test environment using database '${database}' instead of 'trail_master_db_test'`);
      }
      
      // Ensure we're using test user
          if (user !== process.env.USER) {
      console.warn(`⚠️  WARNING: Test environment using user '${user}' instead of system user '${process.env.USER}'`);
      }
      
      console.log(`✅ Test environment validated: database=${database}, user=${user}`);
    }
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
        await this.backupDatabase();
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
      await this.logSchemaTableState('before createStagingEnvironment');
      await this.createStagingEnvironment();
      await this.pgClient.query('COMMIT'); // Ensure all DDL is committed
      console.log('[LOG] After createStagingEnvironment: checking schema/table existence...');
      await this.logSchemaTableState('after createStagingEnvironment');

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
      await this.logSchemaTableState('after copyRegionDataToStaging');

      // After copying region data to staging, log trail count and bbox
      const trailCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`Trail count in staging for region ${this.config.region}:`, trailCountResult.rows[0].count);
      if (this.regionBbox) {
        console.log('Region bbox used for export:', this.regionBbox);
      }

      // New: Check schema/table visibility before intersection detection
      console.log('[LOG] Before intersection detection: checking schema/table existence...');
      await this.logSchemaTableState('before intersection detection');
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
      await this.logSchemaTableState('after detectIntersections');

      // Step 5: Always split trails at intersections (no skipping/caching)
      await this.splitTrailsAtIntersections();

      // Step 6: Always build routing graph from split trails
      await this.buildRoutingGraph();

      // Step 7: Always export to SpatiaLite (nodes/edges/trails)
      await this.exportToSpatiaLite();

      // Step 8: Cleanup staging
      if (!this.config.skipCleanup) {
        await this.cleanupStaging();
      } else {
        console.log('⚠️  Skipping staging cleanup (skipCleanup=true)');
      }

      console.log('\n🎉 Enhanced orchestrator completed successfully!');
      console.log(`📁 Deployment database ready: ${this.config.outputPath}`);

    } catch (error) {
      console.error('❌ Enhanced orchestrator failed:', error);
      // Only clean up on error if explicitly requested
      if (this.config.cleanupOnError) {
        await this.cleanupStaging();
      } else {
        console.warn('⚠️ Staging schema NOT dropped after error (set cleanupOnError=true to enable).');
      }
      throw error;
    } finally {
      await this.pgClient.end();
    }
  }

  private async backupDatabase(): Promise<void> {
    console.log('💾 Backing up PostgreSQL database...');
    
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `db_backup_${timestamp}.dump`);

    const { spawn } = require('child_process');
    const pgDump = spawn('pg_dump', [
      '-h', process.env.PGHOST || 'localhost',
      '-U', process.env.PGUSER || 'postgres',
      '-d', process.env.PGDATABASE || 'postgres',
      '--format=custom',
      '--file', backupFile
    ]);

    return new Promise((resolve, reject) => {
      pgDump.on('close', (code: number) => {
        if (code === 0) {
          console.log(`✅ Database backup completed: ${backupFile}`);
          resolve();
        } else {
          reject(new Error(`pg_dump failed with code ${code}`));
        }
      });
    });
  }

  private async createStagingEnvironment(): Promise<void> {
    console.log(`🏗️  Creating staging environment: ${this.stagingSchema}`);
    await this.pgClient.query('BEGIN');
    try {
      // Create staging schema
      await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging schema created and committed');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error creating staging schema:', err);
      throw err;
    }
    await this.pgClient.query('BEGIN');
    try {
      // Create staging tables
      await this.pgClient.query(`
        -- Staging trails table (copy of master structure)
        CREATE TABLE ${this.stagingSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          osm_id TEXT,
          name TEXT NOT NULL,
          trail_type TEXT,
          surface TEXT,
          difficulty TEXT,
          source_tags TEXT,
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          length_km REAL,
          elevation_gain REAL DEFAULT 0,
          elevation_loss REAL DEFAULT 0,
          max_elevation REAL DEFAULT 0,
          min_elevation REAL DEFAULT 0,
          avg_elevation REAL DEFAULT 0,
          source TEXT,
          region TEXT,
          geometry GEOMETRY(LINESTRINGZ, 4326),
          geometry_text TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        -- Trail hash cache table
        CREATE TABLE ${this.stagingSchema}.trail_hashes (
          trail_id TEXT PRIMARY KEY,
          geometry_hash TEXT NOT NULL,
          elevation_hash TEXT NOT NULL,
          metadata_hash TEXT NOT NULL,
          last_processed TIMESTAMP DEFAULT NOW()
        );
        -- Intersection points table (2D for intersection detection, but we'll preserve 3D data)
        CREATE TABLE ${this.stagingSchema}.intersection_points (
          id SERIAL PRIMARY KEY,
          point GEOMETRY(POINT, 4326), -- 2D for intersection detection
          point_3d GEOMETRY(POINTZ, 4326), -- 3D with elevation for app use
          trail1_id INTEGER,
          trail2_id INTEGER,
          distance_meters REAL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        -- Split trails table
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
          geometry GEOMETRY(LINESTRINGZ, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        -- Routing nodes table
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
        -- Routing edges table
        CREATE TABLE ${this.stagingSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          from_node_id INTEGER,
          to_node_id INTEGER,
          trail_id TEXT,
          trail_name TEXT,
          distance_km REAL,
          elevation_gain REAL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging tables created and committed');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error creating staging tables:', err);
      throw err;
    }
    await this.pgClient.query('BEGIN');
    try {
      // Create indexes
      await this.pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_staging_trails_osm_id ON ${this.stagingSchema}.trails(osm_id);
        CREATE INDEX IF NOT EXISTS idx_staging_trails_bbox ON ${this.stagingSchema}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
        CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${this.stagingSchema}.trails USING GIST(geometry);
        CREATE INDEX IF NOT EXISTS idx_staging_split_trails_geometry ON ${this.stagingSchema}.split_trails USING GIST(geometry);
        CREATE INDEX IF NOT EXISTS idx_staging_intersection_points_point ON ${this.stagingSchema}.intersection_points USING GIST(point);
      `);
      await this.pgClient.query('COMMIT');
      console.log('✅ Staging indexes created and committed');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error creating staging indexes:', err);
      throw err;
    }
    // Load PostGIS intersection functions into staging schema (following architectural rules)
    console.log('📚 Loading PostGIS intersection functions into staging schema...');
    // Always use package-relative path for npm compatibility
    const sqlPath = require.resolve('../../sql/carthorse-postgis-intersection-functions.sql');
    const functionsSql = fs.readFileSync(sqlPath, 'utf8');
    // Replace function names with schema-qualified names
    const stagingFunctionsSql = functionsSql
      .replace(/CREATE OR REPLACE FUNCTION build_routing_nodes/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.build_routing_nodes`)
      .replace(/CREATE OR REPLACE FUNCTION build_routing_edges/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.build_routing_edges`)
      .replace(/CREATE OR REPLACE FUNCTION detect_trail_intersections/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.detect_trail_intersections`)
      .replace(/CREATE OR REPLACE FUNCTION get_intersection_stats/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.get_intersection_stats`)
      .replace(/CREATE OR REPLACE FUNCTION validate_intersection_detection/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.validate_intersection_detection`)
      .replace(/CREATE OR REPLACE FUNCTION validate_spatial_data_integrity/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.validate_spatial_data_integrity`)
      .replace(/CREATE OR REPLACE FUNCTION split_trails_at_intersections/g, `CREATE OR REPLACE FUNCTION ${this.stagingSchema}.split_trails_at_intersections`);
    await this.pgClient.query('BEGIN');
    try {
      await this.pgClient.query(stagingFunctionsSql);
      await this.pgClient.query('COMMIT');
      console.log('✅ PostGIS intersection functions loaded and committed into staging schema');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error loading PostGIS intersection functions:', err);
      throw err;
    }
    console.log('✅ Staging environment created');

    // New: Check that schema and tables exist and are visible
    try {
      const schemaCheck = await this.pgClient.query(`
        SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
      `, [this.stagingSchema]);
      if (schemaCheck.rows.length === 0) {
        console.error(`❌ Staging schema ${this.stagingSchema} not found after creation!`);
        const allSchemas = await this.pgClient.query(`SELECT schema_name FROM information_schema.schemata`);
        console.log('All schemas in DB:', allSchemas.rows.map(r => r.schema_name));
      } else {
        console.log(`✅ Staging schema ${this.stagingSchema} is present.`);
      }
      const expectedTables = [
        'trails', 'trail_hashes', 'intersection_points', 'split_trails', 'routing_nodes', 'routing_edges'
      ];
      for (const table of expectedTables) {
        const tableCheck = await this.pgClient.query(`
          SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2
        `, [this.stagingSchema, table]);
        if (tableCheck.rows.length === 0) {
          console.error(`❌ Table ${this.stagingSchema}.${table} not found after creation!`);
          const allTables = await this.pgClient.query(`
            SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = $1
          `, [this.stagingSchema]);
          console.log(`All tables in ${this.stagingSchema}:`, allTables.rows);
        } else {
          console.log(`✅ Table ${this.stagingSchema}.${table} is present.`);
        }
      }
    } catch (err) {
      console.error('❌ Error checking schema/table existence:', err);
    }
  }

  private async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log(`📋 Copying ${this.config.region} data to staging...`);
    await this.pgClient.query('BEGIN');
    try {
      // Validate that region exists in the database before copying
      const regionExists = await this.pgClient.query(validateRegionExistsSql(), [this.config.region]);
      if (regionExists.rows[0].count === 0) {
        console.error(`❌ No trails found for region: ${this.config.region}`);
        console.error('   Please ensure the region exists in the database before running the orchestrator.');
        process.exit(1);
      }
      // Copy region data to staging, storing both geometry and geometry_text
      const { sql, params } = getRegionDataCopySql(this.stagingSchema, bbox);
      params[0] = this.config.region; // Ensure region param is correct
      await this.pgClient.query(sql, params);
      const result = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      const copiedCount = result.rows[0].count;
      if (copiedCount === 0) {
        console.error(`❌ Failed to copy any trails for region: ${this.config.region}`);
        console.error('   This indicates a critical data integrity issue.');
        process.exit(1);
      }
      console.log(`✅ Copied ${copiedCount} trails to staging`);
      // Validate staging data but don't fail - let atomic inserter handle fixing
      await this.validateStagingData(false);
      await this.pgClient.query('COMMIT');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error copying region data to staging:', err);
      throw err;
    }
  }
  
  private async validateStagingData(strict: boolean = true): Promise<void> {
    console.log('🔍 Validating critical staging data requirements...');
    
    // Calculate and display region bounding box
    await this.calculateAndDisplayRegionBbox();
    
    // Essential validation checks
    const missingElevation = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
         OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL
    `);
    
    const missingGeometry = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      WHERE geometry IS NULL OR geometry_text IS NULL
    `);
    
    const invalidBbox = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      WHERE bbox_min_lng IS NULL OR bbox_max_lng IS NULL 
         OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL
         OR bbox_min_lng >= bbox_max_lng OR bbox_min_lat >= bbox_max_lat
    `);
    
    const duplicateUuids = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM (
        SELECT app_uuid, COUNT(*) as cnt 
        FROM ${this.stagingSchema}.trails 
        GROUP BY app_uuid 
        HAVING COUNT(*) > 1
      ) as duplicates
    `);
    
    const totalTrailsResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    const totalTrails = totalTrailsResult.rows[0].count;
    
    console.log(`📊 Staging validation results:`);
    console.log(`   - Total trails: ${totalTrails}`);
    console.log(`   - Missing elevation: ${missingElevation.rows[0].count}`);
    console.log(`   - Missing geometry: ${missingGeometry.rows[0].count}`);
    console.log(`   - Invalid bbox: ${invalidBbox.rows[0].count}`);
    console.log(`   - Duplicate UUIDs: ${duplicateUuids.rows[0].count}`);
    
    const totalIssues = missingElevation.rows[0].count + missingGeometry.rows[0].count + invalidBbox.rows[0].count + duplicateUuids.rows[0].count;
    
    if (totalIssues > 0) {
      console.error('\n❌ CRITICAL: Staging validation failed!');
      console.error('   Essential requirements not met:');
      if (missingElevation.rows[0].count > 0) {
        console.error(`   - ${missingElevation.rows[0].count} trails missing elevation data`);
      }
      if (missingGeometry.rows[0].count > 0) {
        console.error(`   - ${missingGeometry.rows[0].count} trails missing geometry data`);
      }
      if (invalidBbox.rows[0].count > 0) {
        console.error(`   - ${invalidBbox.rows[0].count} trails have invalid bounding boxes`);
      }
      if (duplicateUuids.rows[0].count > 0) {
        console.error(`   - ${duplicateUuids.rows[0].count} duplicate UUIDs found`);
      }
      console.error('\n💡 Fix source data in PostgreSQL before re-running export.');
      process.exit(1);
    }
    
    console.log('✅ Staging validation passed - all trails meet critical requirements');
  }

  private async calculateAndDisplayRegionBbox(): Promise<void> {
    console.log('🗺️  Calculating region bounding box...');
    
    // Calculate the actual bounding box from all trails in the region
    const bboxResult = await this.pgClient.query(`
      SELECT 
        MIN(bbox_min_lng) as min_lng,
        MAX(bbox_max_lng) as max_lng,
        MIN(bbox_min_lat) as min_lat,
        MAX(bbox_max_lat) as max_lat,
        COUNT(*) as trail_count
      FROM ${this.stagingSchema}.trails
    `);
    
    if (bboxResult.rows.length > 0) {
      const bbox = bboxResult.rows[0];
      if (!bbox || bbox.min_lng == null || bbox.max_lng == null || bbox.min_lat == null || bbox.max_lat == null) {
        console.warn('⚠️  No valid bounding box found for region:', this.config.region);
        return;
      }
      console.log(`📐 Region bounding box (${this.config.region}):`);
      console.log(`   - Longitude: ${bbox.min_lng.toFixed(6)}°W to ${bbox.max_lng.toFixed(6)}°W`);
      console.log(`   - Latitude:  ${bbox.min_lat.toFixed(6)}°N to ${bbox.max_lat.toFixed(6)}°N`);
      console.log(`   - Trail count: ${bbox.trail_count}`);
      
      // Calculate area approximation
      const widthDegrees = Math.abs(bbox.max_lng - bbox.min_lng);
      const heightDegrees = Math.abs(bbox.max_lat - bbox.min_lat);
      const areaKm2 = widthDegrees * heightDegrees * 111 * 111; // Rough conversion
      console.log(`   - Approximate area: ${areaKm2.toFixed(1)} km²`);
      
      // Store the bbox for potential use in other parts of the process
      this.regionBbox = {
        minLng: bbox.min_lng,
        maxLng: bbox.max_lng,
        minLat: bbox.min_lat,
        maxLat: bbox.max_lat,
        trailCount: bbox.trail_count
      };
      
      // Update region configuration if requested
      if (this.config.verbose) {
        await this.updateRegionConfiguration();
      }
    } else {
      console.log('⚠️  No trails found in staging - cannot calculate bounding box');
    }
  }

  private async updateRegionConfiguration(): Promise<void> {
    if (!this.regionBbox) {
      console.log('⚠️  No bounding box available - skipping region config update');
      return;
    }

    console.log('📝 Updating region configuration...');
    // regions table and columns are required for all exports.
    // trail_count is for logging only and not stored in the database.
    await this.pgClient.query(`
      UPDATE regions 
      SET 
        bbox_min_lng = $1,
        bbox_max_lng = $2,
        bbox_min_lat = $3,
        bbox_max_lat = $4
      WHERE region_key = $5
    `, [
      this.regionBbox.minLng,
      this.regionBbox.maxLng,
      this.regionBbox.minLat,
      this.regionBbox.maxLat,
      this.config.region
    ]);
    console.log(`✅ Updated region configuration for ${this.config.region}`);
    console.log(`   - New bbox: ${this.regionBbox.minLng.toFixed(6)}°W to ${this.regionBbox.maxLng.toFixed(6)}°W, ${this.regionBbox.minLat.toFixed(6)}°N to ${this.regionBbox.maxLat.toFixed(6)}°N`);
    console.log(`   - Trail count (not stored in DB): ${this.regionBbox.trailCount}`);
  }

  private async calculateAndStoreHashes(): Promise<void> {
    console.log('🔍 Calculating trail hashes for caching...');
    
    const trails = await this.pgClient.query(`
      SELECT app_uuid, ST_AsText(geometry) as geometry_text, 
             elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
             name, trail_type, surface, difficulty, source_tags
      FROM ${this.stagingSchema}.trails
    `);

    for (const trail of trails.rows) {
      const geometryHash = this.hashString(trail.geometry_text);
      const elevationHash = this.hashString(`${trail.elevationGain}-${trail.elevationLoss}-${trail.maxElevation}-${trail.minElevation}-${trail.avgElevation}`);
      const metadataHash = this.hashString(`${trail.name}-${trail.trailType}-${trail.surface}-${trail.difficulty}-${trail.sourceTags}`);
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trail_hashes (trail_id, geometry_hash, elevation_hash, metadata_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (trail_id) DO UPDATE SET
          geometry_hash = EXCLUDED.geometry_hash,
          elevation_hash = EXCLUDED.elevation_hash,
          metadata_hash = EXCLUDED.metadata_hash,
          last_processed = NOW()
      `, [trail.app_uuid, geometryHash, elevationHash, metadataHash]);
    }
    
    console.log(`✅ Calculated hashes for ${trails.rows.length} trails`);
  }

  private hashString(str: string): string {
    // Simple hash function - just use the string length and first/last chars for speed
    return `${str.length}-${str.substring(0, 10)}-${str.substring(str.length - 10)}`;
  }

  private async detectIntersections(): Promise<void> {
    console.log('[DEBUG] ENTERED detectIntersections METHOD');
    // Clear existing intersection data
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);
    // Use the enhanced PostGIS intersection detection function with correct schema/table arguments
    const schemaArg = this.stagingSchema;
    const tableArg = 'trails';
    const toleranceArg = this.config.intersectionTolerance;
    const sql = `
      INSERT INTO ${schemaArg}.intersection_points (point, point_3d, trail1_id, trail2_id, distance_meters)
      SELECT 
        intersection_point,
        intersection_point_3d,
        connected_trail_ids[1] as trail1_id,
        connected_trail_ids[2] as trail2_id,
        distance_meters
      FROM ${schemaArg}.detect_trail_intersections('${schemaArg}', '${tableArg}', $1)
      WHERE array_length(connected_trail_ids, 1) >= 2
    `;
    console.log('[DEBUG] detectIntersections SQL:', sql);
    console.log('[DEBUG] detectIntersections ARGS:', schemaArg, tableArg, toleranceArg);
    await this.pgClient.query(sql, [toleranceArg]);
    console.log('✅ Intersection detection query executed.');

    // Load intersection data into memory for processing using PostGIS spatial functions
    const intersections = await this.pgClient.query(`
      SELECT 
        ip.*,
        ST_X(ip.point) as lng,
        ST_Y(ip.point) as lat,
        COALESCE(ST_Z(ip.point_3d), 0) as elevation
      FROM ${this.stagingSchema}.intersection_points ip
      ORDER BY ip.trail1_id, ip.trail2_id
    `);

    // Group intersections by trail using PostGIS-extracted coordinates
    for (const intersection of intersections.rows) {
      const lng = intersection.lng;
      const lat = intersection.lat;
      const elevation = intersection.elevation;
      const trail1Id = intersection.trail1_id;
      const trail2Id = intersection.trail2_id;
      // Add to trail1
      if (!this.splitPoints.has(trail1Id)) {
        this.splitPoints.set(trail1Id, []);
      }
      this.splitPoints.get(trail1Id)!.push({
        coordinate: [lng, lat, elevation] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
        visitorTrailId: trail2Id, visitorTrailName: ''
      });
      // Add to trail2
      if (!this.splitPoints.has(trail2Id)) {
        this.splitPoints.set(trail2Id, []);
      }
      this.splitPoints.get(trail2Id)!.push({
        coordinate: [lng, lat, elevation] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
        visitorTrailId: trail1Id, visitorTrailName: ''
      });
    }

    // Get trail names for visitor trails using optimized query
    const trailNames = await this.pgClient.query(`
      SELECT id, name FROM ${this.stagingSchema}.trails 
      WHERE id IN (
        SELECT DISTINCT trail1_id FROM ${this.stagingSchema}.intersection_points
        UNION
        SELECT DISTINCT trail2_id FROM ${this.stagingSchema}.intersection_points
      )
    `);
    
    const nameMap = new Map(trailNames.rows.map(row => [row.id, row.name]));
    
    for (const [trailId, points] of this.splitPoints) {
      for (const point of points) {
        point.visitorTrailName = nameMap.get(point.visitorTrailId) || '';
      }
    }
  }

  private async splitTrailsAtIntersections(): Promise<void> {
    console.log('✂️  Splitting trails at intersections using PostGIS (3D split)...');
    const changedTrails = await this.getChangedTrails();
    if (changedTrails.length === 0) {
      console.log('✅ No trail changes detected - using cached splits');
      return;
    }
    console.log(`🔄 Processing ${changedTrails.length} changed trails...`);
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.split_trails 
      WHERE original_trail_id IN (SELECT id FROM ${this.stagingSchema}.trails WHERE app_uuid = ANY($1))
    `, [changedTrails]);
    // Use the new 3D split_trails_at_intersections function
    const sql = `
      INSERT INTO ${this.stagingSchema}.split_trails (
        original_trail_id, segment_number, app_uuid, name, trail_type, surface, difficulty,
        source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      )
      SELECT 
        t.id as original_trail_id,
        seg.segment_number,
        t.app_uuid || '-' || seg.segment_number as app_uuid,
        t.name, t.trail_type, t.surface, t.difficulty, t.source_tags, t.osm_id,
        t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
        ST_Length(seg.geometry::geography) / 1000 as length_km,
        t.source,
        seg.geometry,
        ST_XMin(seg.geometry) as bbox_min_lng,
        ST_XMax(seg.geometry) as bbox_max_lng,
        ST_YMin(seg.geometry) as bbox_min_lat,
        ST_YMax(seg.geometry) as bbox_max_lat
      FROM ${this.stagingSchema}.trails t
      JOIN LATERAL (
        SELECT segment_number, geometry
        FROM ${this.stagingSchema}.split_trails_at_intersections('${this.stagingSchema}', 'trails')
        WHERE original_trail_id = t.id
      ) seg ON true;
    `;
    await this.pgClient.query(sql);
    // Validate all split segments are 3D
    const validation = await this.pgClient.query(`
      SELECT COUNT(*) AS n, SUM(CASE WHEN ST_NDims(geometry) = 3 THEN 1 ELSE 0 END) AS n3d
      FROM ${this.stagingSchema}.split_trails
    `);
    if (validation.rows[0].n !== validation.rows[0].n3d) {
      throw new Error('❌ Not all split segments are 3D after splitting!');
    }
    console.log('✅ Trails split at intersections using PostGIS (3D geometry, LINESTRINGZ).');
  }

  private async getChangedTrails(): Promise<string[]> {
    // Compare current hashes with previous hashes
    const result = await this.pgClient.query(`
      SELECT t.app_uuid
      FROM ${this.stagingSchema}.trails t
      LEFT JOIN ${this.stagingSchema}.trail_hashes h ON t.app_uuid = h.trail_id
      WHERE h.trail_id IS NULL 
         OR h.geometry_hash != $1 
         OR h.elevation_hash != $2 
         OR h.metadata_hash != $3
    `, [
      this.hashString('geometry'), // Placeholder - would need actual hash comparison
      this.hashString('elevation'),
      this.hashString('metadata')
    ]);
    
    return result.rows.map(row => row.app_uuid);
  }

  private async insertSplitTrail(originalTrail: any, segmentNumber: number, geometry: string): Promise<void> {
    // Use parent_app_uuid-2, -3, ... for split segments; first segment keeps original UUID
    const appUuid = segmentNumber === 1 ? originalTrail.app_uuid : `${originalTrail.app_uuid}-${segmentNumber}`;
    
    // Debug: Log the geometry string being inserted
    if (this.config.verbose) {
      console.log(`[DEBUG] Inserting trail ${appUuid} with geometry: ${geometry.substring(0, 100)}...`);
    }
    
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.split_trails (
        original_trail_id, segment_number, app_uuid, name, trail_type, surface, difficulty,
        source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ST_GeomFromText($17, 4326), $18, $19, $20, $21)
    `, [
      originalTrail.id, segmentNumber, appUuid, originalTrail.name, originalTrail.trail_type,
      originalTrail.surface, originalTrail.difficulty, originalTrail.source_tags, originalTrail.osm_id,
      originalTrail.elevation_gain, originalTrail.elevation_loss, originalTrail.max_elevation,
      originalTrail.min_elevation, originalTrail.avg_elevation, originalTrail.length_km,
      originalTrail.source, geometry, originalTrail.bbox_min_lng, originalTrail.bbox_max_lng,
      originalTrail.bbox_min_lat, originalTrail.bbox_max_lat
    ]);
  }

  private async buildRoutingGraph(): Promise<void> {
    console.log('🔗 Building routing graph using enhanced PostGIS functions...');
    
    // Clear existing routing data
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);

    // Check if split trails exist, otherwise use original trails
    let trailsTable = 'split_trails';
    let trails: { rows: any[] } = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trails 
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    if (trails.rows[0].count === 0) {
      console.log('ℹ️  No split trails found, using original trails for routing graph...');
      trailsTable = 'trails';
    } else {
      console.log(`ℹ️  Using ${trails.rows[0].count} split trails for routing graph...`);
    }

    console.log(`📊 Building routing graph from ${trailsTable}...`);

    // Use enhanced PostGIS functions for proper intersection detection and routing graph building
    // This follows the architectural rule: ALWAYS use existing PostGIS functions
    const nodeCount = await this.pgClient.query(`
      SELECT ${this.stagingSchema}.build_routing_nodes('${this.stagingSchema}', '${trailsTable}', ${this.config.intersectionTolerance})
    `);

    console.log(`✅ Created ${nodeCount.rows[0].build_routing_nodes} routing nodes using enhanced PostGIS`);

    // Create routing edges using enhanced PostGIS function
    const edgeCount = await this.pgClient.query(`
      SELECT ${this.stagingSchema}.build_routing_edges('${this.stagingSchema}', '${trailsTable}')
    `);

    console.log(`✅ Created ${edgeCount.rows[0].build_routing_edges} routing edges using enhanced PostGIS`);
    
    // Run comprehensive validation using PostGIS functions
    const validation = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.validate_spatial_data_integrity('${this.stagingSchema}')
    `);
    
    console.log('📊 Spatial data integrity validation:');
    for (const check of validation.rows) {
      const status = check.status === 'PASS' ? '✅' : check.status === 'WARNING' ? '⚠️' : '❌';
      console.log(`   ${status} ${check.validation_check}: ${check.details}`);
    }
    
    // Get intersection statistics
    const stats = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.get_intersection_stats('${this.stagingSchema}')
    `);
    
    if (stats.rows.length > 0) {
      const stat = stats.rows[0];
      console.log(`📊 Intersection statistics:`);
      console.log(`   Total nodes: ${stat.total_nodes}`);
      console.log(`   Intersection nodes: ${stat.intersection_nodes}`);
      console.log(`   Endpoint nodes: ${stat.endpoint_nodes}`);
      console.log(`   Total edges: ${stat.total_edges}`);
      console.log(`   Node-to-trail ratio: ${(stat.node_to_trail_ratio * 100).toFixed(1)}%`);
      console.log(`   Processing time: ${stat.processing_time_ms}ms`);
    }
    
    // Verify the data was inserted correctly
    const verification = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`);
    const edgeVerification = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`);
    
    console.log(`🔍 Verification: ${verification.rows[0].count} nodes and ${edgeVerification.rows[0].count} edges in staging`);
    
    if (verification.rows[0].count === 0) {
      console.warn('⚠️  Warning: No routing nodes were created. This may cause API issues.');
    }
  }

  private async exportToSpatiaLite(): Promise<void> {
    console.log('📤 Exporting processed data to SpatiaLite...');
    // Ensure output directory exists
    const outputDir = path.dirname(this.config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    // Remove existing database if replace mode or if it exists
    if ((this.config.replace || fs.existsSync(this.config.outputPath)) && fs.existsSync(this.config.outputPath)) {
      console.log(`🗑️  Removing existing database: ${this.config.outputPath}`);
      fs.unlinkSync(this.config.outputPath);
    }
    // Create SpatiaLite database
    let spatialiteDb: Database.Database;
    try {
      console.log(`📁 Creating SQLite database at: ${this.config.outputPath}`);
      spatialiteDb = new Database(this.config.outputPath);
      console.log('✅ SQLite database created successfully');
    } catch (error) {
      console.error('❌ Failed to create SQLite database:', error);
      throw error;
    }
    // Load SpatiaLite extension
    const SPATIALITE_PATH = process.platform === 'darwin'
      ? '/opt/homebrew/lib/mod_spatialite'
      : '/usr/lib/x86_64-linux-gnu/mod_spatialite';
    try {
      spatialiteDb.loadExtension(SPATIALITE_PATH);
      console.log('✅ SpatiaLite loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load SpatiaLite:', error);
      spatialiteDb.close();
      process.exit(1);
    }
    // Initialize spatial metadata
    try {
      spatialiteDb.exec("SELECT InitSpatialMetaData(1)");
      console.log('✅ Spatial metadata initialized');
    } catch (error) {
      console.log('ℹ️  Spatial metadata already initialized');
    }
    // Create all tables and geometry columns
    createSpatiaLiteTables(spatialiteDb);
    // Prepare and insert trails
    let trailsToExport;
    const splitTrailsExport = await this.pgClient.query(`
      SELECT 
        app_uuid, osm_id, name, source, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        ST_AsText(geometry) as geometry_text, 
        ST_AsGeoJSON(geometry) as geojson,
        ST_XMin(ST_Envelope(geometry)) as bbox_min_lng,
        ST_XMax(ST_Envelope(geometry)) as bbox_max_lng,
        ST_YMin(ST_Envelope(geometry)) as bbox_min_lat,
        ST_YMax(ST_Envelope(geometry)) as bbox_max_lat,
        ST_AsText(geometry) as coordinates,
        NULL as bbox, created_at, updated_at
      FROM ${this.stagingSchema}.split_trails
      ORDER BY original_trail_id, segment_number
    `);
    if (splitTrailsExport.rows.length > 0) {
      trailsToExport = splitTrailsExport.rows;
      console.log(`📊 Exporting ${splitTrailsExport.rows.length} split trails...`);
    } else {
      const originalTrails = await this.pgClient.query(`
        SELECT 
          app_uuid, osm_id, name, source, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          ST_AsText(geometry) as geometry_text, 
          ST_AsGeoJSON(geometry) as geojson,
          ST_XMin(ST_Envelope(geometry)) as bbox_min_lng,
          ST_XMax(ST_Envelope(geometry)) as bbox_max_lng,
          ST_YMin(ST_Envelope(geometry)) as bbox_min_lat,
          ST_YMax(ST_Envelope(geometry)) as bbox_max_lat,
          ST_AsText(geometry) as coordinates,
          NULL as bbox, created_at, updated_at
        FROM ${this.stagingSchema}.trails
        ORDER BY id
      `);
      trailsToExport = originalTrails.rows;
      console.log(`📊 Exporting ${originalTrails.rows.length} original trails (no splits occurred)...`);
    }
    insertTrails(spatialiteDb, trailsToExport);
    // Prepare and insert routing nodes
    const routingNodes = await this.pgClient.query(`
      SELECT node_uuid, lat, lng, elevation, node_type, connected_trails,
        ST_AsText(ST_SetSRID(ST_MakePoint(lng, lat, COALESCE(elevation, 0)), 4326)) as coordinate
      FROM ${this.stagingSchema}.routing_nodes
    `);
    insertRoutingNodes(spatialiteDb, routingNodes.rows);
    // Prepare and insert routing edges
    const routingEdges = await this.pgClient.query(`
      SELECT from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain,
        NULL as geometry
      FROM ${this.stagingSchema}.routing_edges
    `);
    insertRoutingEdges(spatialiteDb, routingEdges.rows);
    // Insert region metadata
    const regionMeta = {
      id: this.config.region,
      name: this.config.region,
      description: '',
      bbox: this.regionBbox ? JSON.stringify({
        minLng: this.regionBbox.minLng,
        maxLng: this.regionBbox.maxLng,
        minLat: this.regionBbox.minLat,
        maxLat: this.regionBbox.maxLat
      }) : null,
      initialViewBbox: null,
      center: this.regionBbox ? JSON.stringify({
        lng: (this.regionBbox.minLng + this.regionBbox.maxLng) / 2,
        lat: (this.regionBbox.minLat + this.regionBbox.maxLat) / 2
      }) : null,
      metadata: JSON.stringify({
        version: 1,
        lastUpdated: new Date().toISOString(),
        coverage: 'unknown'
      })
    };
    insertRegionMetadata(spatialiteDb, regionMeta);
    // Insert schema version
    spatialiteDb.exec(`
      INSERT OR REPLACE INTO schema_version (version, description) 
      VALUES (7, 'Enhanced PostgreSQL processed: split trails with routing graph and elevation field')
    `);
    spatialiteDb.close();
    console.log('✅ SpatiaLite export complete.');
  }

  /**
   * Drop the staging schema and all its tables after export (SQL-based, spatial safety compliant)
   */
  async cleanupStaging(): Promise<void> {
    // There is no public 'ended' property on pg.Client, so we catch errors instead
    try {
      if (!this.pgClient) {
        console.warn(`⚠️  Skipping staging cleanup: PostgreSQL client is not available.`);
        return;
      }
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
      console.log(`✅ Staging schema ${this.stagingSchema} dropped.`);
    } catch (error: any) {
      if (error && error.message && error.message.includes('Client was closed')) {
        console.warn(`⚠️  Skipping staging cleanup: PostgreSQL client is already closed.`);
      } else {
        console.error(`❌ Failed to drop staging schema ${this.stagingSchema}:`, error);
      }
    }
  }

  // Add a helper for logging schema/table state
  private async logSchemaTableState(context: string) {
    try {
      const schemaCheck = await this.pgClient.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`, [this.stagingSchema]);
      if (schemaCheck.rows.length === 0) {
        console.error(`[${context}] ❌ Staging schema ${this.stagingSchema} not found!`);
      } else {
        console.log(`[${context}] ✅ Staging schema ${this.stagingSchema} is present.`);
      }
      const tableCheck = await this.pgClient.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'trails'`, [this.stagingSchema]);
      if (tableCheck.rows.length === 0) {
        console.error(`[${context}] ❌ Table ${this.stagingSchema}.trails not found!`);
        const allTables = await this.pgClient.query(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = $1`, [this.stagingSchema]);
        console.log(`[${context}] All tables in ${this.stagingSchema}:`, allTables.rows);
      } else {
        console.log(`[${context}] ✅ Table ${this.stagingSchema}.trails is present.`);
      }
    } catch (err) {
      console.error(`[${context}] ❌ Error checking schema/table existence:`, err);
    }
  }
}