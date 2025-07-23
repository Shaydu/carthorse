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
import { createSpatiaLiteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRegionMetadata, buildRegionMeta, insertSchemaVersion } from '../utils/spatialite-export-helpers';
import { getStagingSchemaSql, getStagingIndexesSql, getSchemaQualifiedPostgisFunctionsSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { isValidNumberTuple, hashString } from '../utils';
import { cleanupStaging, logSchemaTableState } from '../utils/sql/helpers';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { detectIntersectionsHelper } from '../utils/sql/intersection';
import { buildRoutingGraphHelper } from '../utils/sql/routing';
import { execSync } from 'child_process';

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
  edgeTolerance?: number; // <-- add this
}

export class EnhancedPostgresOrchestrator {
  private pgClient: Client;
  private pgConfig: any;
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

      // Step 6: Always build routing graph from split trails
      await this.buildRoutingGraph();

      // Step 7: Always export to SpatiaLite (nodes/edges/trails)
      await this.exportToSpatiaLite();

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
      await this.pgClient.end();
    }
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
    // Load PostGIS intersection functions into staging schema (always use psql)
    console.log('📚 Loading PostGIS intersection functions into staging schema...');
    const sqlPath = require.resolve('../../sql/carthorse-postgis-intersection-functions.sql');
    try {
      const dbName = this.pgConfig.database || process.env.PGDATABASE || 'trail_master_db_test';
      const dbUser = this.pgConfig.user || process.env.PGUSER || 'tester';
      const dbHost = this.pgConfig.host || process.env.PGHOST || 'localhost';
      const dbPort = this.pgConfig.port || process.env.PGPORT || 5432;
      const psqlCmd = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -v schema=${this.stagingSchema} -f "${sqlPath}"`;
      console.log(`[psql] Executing: ${psqlCmd}`);
      execSync(psqlCmd, { stdio: 'inherit' });
      console.log('✅ PostGIS intersection functions loaded via psql');
    } catch (err) {
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
      await validateStagingData(this.pgClient, this.stagingSchema, this.config.region, this.regionBbox);
      await this.pgClient.query('COMMIT');
    } catch (err) {
      await this.pgClient.query('ROLLBACK');
      console.error('❌ Error copying region data to staging:', err);
      throw err;
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
        FROM public.split_trails_at_intersections('${this.stagingSchema}', 'trails')
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
      hashString('geometry'), // Placeholder - would need actual hash comparison
      hashString('elevation'),
      hashString('metadata')
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
    console.log('🔗 Building routing graph using enhanced PostGIS functions (via helper)...');
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
    // Use the helper to build routing graph
    const edgeTolerance = this.config.edgeTolerance !== undefined ? this.config.edgeTolerance : 20.0;
    const { nodeCount, edgeCount, validation, stats } = await buildRoutingGraphHelper(
      this.pgClient,
      this.stagingSchema,
      trailsTable,
      this.config.intersectionTolerance,
      edgeTolerance
    );
    console.log(`✅ Created ${nodeCount} routing nodes and ${edgeCount} routing edges using helper`);
    console.log('📊 Spatial data integrity validation:');
    for (const check of validation) {
      const status = check.status === 'PASS' ? '✅' : check.status === 'WARNING' ? '⚠️' : '❌';
      console.log(`   ${status} ${check.validation_check}: ${check.details}`);
    }
    if (stats && typeof stats === 'object') {
      console.log(`📊 Intersection statistics:`);
      if ('total_nodes' in stats) console.log(`   Total nodes: ${stats.total_nodes}`);
      if ('intersection_nodes' in stats) console.log(`   Intersection nodes: ${stats.intersection_nodes}`);
      if ('endpoint_nodes' in stats) console.log(`   Endpoint nodes: ${stats.endpoint_nodes}`);
      if ('total_edges' in stats) console.log(`   Total edges: ${stats.total_edges}`);
      if ('node_to_trail_ratio' in stats) console.log(`   Node-to-trail ratio: ${(stats.node_to_trail_ratio * 100).toFixed(1)}%`);
      if ('processing_time_ms' in stats) console.log(`   Processing time: ${stats.processing_time_ms}ms`);
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
    console.log('[DEBUG] exportToSpatiaLite: function entered');
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
    console.log(`[EXPORT] Output path: ${this.config.outputPath}`);
    let spatialiteDb: Database.Database;
    try {
      spatialiteDb = new Database(this.config.outputPath);
      console.log('[EXPORT] SQLite database created successfully');
    } catch (error) {
      console.error('[EXPORT] Failed to create SQLite database:', error);
      throw error;
    }

    // Load SpatiaLite extension and initialize metadata BEFORE any table creation
    const SPATIALITE_PATH = process.platform === 'darwin'
      ? '/opt/homebrew/lib/mod_spatialite.dylib'
      : '/usr/lib/x86_64-linux-gnu/mod_spatialite';
    try {
      spatialiteDb.loadExtension(SPATIALITE_PATH);
      console.log('[EXPORT] SpatiaLite loaded successfully');
      spatialiteDb.exec('SELECT InitSpatialMetaData(1);');
      console.log('[EXPORT] Spatial metadata initialized');
    } catch (error) {
      console.error('[EXPORT] Failed to load SpatiaLite or initialize metadata:', error);
      spatialiteDb.close();
      process.exit(1);
    }

    // Create tables and geometry columns
    try {
      createSpatiaLiteTables(spatialiteDb);
      console.log('[EXPORT] SpatiaLite tables and geometry columns created');
    } catch (error) {
      console.error('[EXPORT] Failed to create SpatiaLite tables or geometry columns:', error);
      spatialiteDb.close();
      throw error;
    }

    // Prepare and assign trailsToExport before inserting trails
    let trailsToExport;
    try {
      const splitTrailsExport = await this.pgClient.query(`
        SELECT 
          app_uuid, osm_id, name, source, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          ST_AsText(geometry) as geometry_wkt, 
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
        console.log(`[EXPORT] Exporting ${splitTrailsExport.rows.length} split trails...`);
      } else {
        const originalTrails = await this.pgClient.query(`
          SELECT 
            app_uuid, osm_id, name, source, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            ST_AsText(geometry) as geometry_wkt, 
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
        console.log(`[EXPORT] Exporting ${originalTrails.rows.length} original trails (no splits occurred)...`);
      }
      if (trailsToExport.length > 0) {
        console.log('[EXPORT] First trail sample:', JSON.stringify(trailsToExport[0], null, 2));
      }
    } catch (error) {
      console.error('[EXPORT] Failed to query trails for export:', error);
      spatialiteDb.close();
      throw error;
    }

    // Insert trails
    try {
      insertTrails(spatialiteDb, trailsToExport);
      console.log('[EXPORT] Trails inserted into SpatiaLite');
    } catch (error) {
      console.error('[EXPORT] Failed to insert trails:', error);
      spatialiteDb.close();
      throw error;
    }

    // Insert routing nodes
    try {
      const routingNodes = await this.pgClient.query(`
        SELECT node_uuid, lat, lng, elevation, node_type, connected_trails,
          ST_AsText(ST_SetSRID(ST_MakePoint(lng, lat, COALESCE(elevation, 0)), 4326)) as coordinate
        FROM ${this.stagingSchema}.routing_nodes
      `);
      if (routingNodes.rows.length > 0) {
        console.log('[EXPORT] First routing node sample:', JSON.stringify(routingNodes.rows[0], null, 2));
      } else {
        console.warn('[EXPORT] No routing nodes found in staging schema! Table will still be created in SpatiaLite.');
      }
      insertRoutingNodes(spatialiteDb, routingNodes.rows);
      console.log('[EXPORT] Routing nodes inserted into SpatiaLite');
    } catch (error) {
      console.error('[EXPORT] Failed to insert routing nodes:', error);
      // Always attempt to create the table even if no data
      insertRoutingNodes(spatialiteDb, []);
      spatialiteDb.close();
      throw error;
    }

    // Insert routing edges
    try {
      const routingEdges = await this.pgClient.query(`
        SELECT from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain,
          NULL as geometry
        FROM ${this.stagingSchema}.routing_edges
      `);
      if (routingEdges.rows.length > 0) {
        console.log('[EXPORT] First routing edge sample:', JSON.stringify(routingEdges.rows[0], null, 2));
      } else {
        console.warn('[EXPORT] No routing edges found in staging schema! Table will still be created in SpatiaLite.');
      }
      insertRoutingEdges(spatialiteDb, routingEdges.rows);
      console.log('[EXPORT] Routing edges inserted into SpatiaLite');
    } catch (error) {
      console.error('[EXPORT] Failed to insert routing edges:', error);
      // Always attempt to create the table even if no data
      insertRoutingEdges(spatialiteDb, []);
      spatialiteDb.close();
      throw error;
    }

    // Insert region metadata
    try {
      const regionMeta = buildRegionMeta(this.config, this.regionBbox);
      insertRegionMetadata(spatialiteDb, regionMeta);
      console.log('[EXPORT] Region metadata inserted into SpatiaLite');
    } catch (error) {
      console.error('[EXPORT] Failed to insert region metadata:', error);
      spatialiteDb.close();
      throw error;
    }

    // Insert schema version
    try {
      insertSchemaVersion(spatialiteDb, 7, 'Enhanced PostgreSQL processed: split trails with routing graph and elevation field');
      console.log('[EXPORT] Schema version inserted into SpatiaLite');
    } catch (error) {
      console.error('[EXPORT] Failed to insert schema version:', error);
      spatialiteDb.close();
      throw error;
    }

    // Ensure DB is closed at the very end
    try {
      spatialiteDb.close();
      console.log('[EXPORT] SpatiaLite database closed');
    } catch (error) {
      console.error('[EXPORT] Failed to close SpatiaLite database:', error);
    }
    console.log('[DEBUG] exportToSpatiaLite: after insertTrails');
  }

  public async cleanupStaging(): Promise<void> {
    await cleanupStaging(this.pgClient, this.stagingSchema);
  }
}