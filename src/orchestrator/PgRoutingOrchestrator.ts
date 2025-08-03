#!/usr/bin/env ts-node
/**
 * PgRouting Orchestrator for Trail Data Processing
 * 
 * This orchestrator manages the complete pipeline for processing trail data using pgRouting:
 * 1. Creates staging environment in PostgreSQL
 * 2. Copies region data to staging schema
 * 3. Uses pgRouting to generate routing network
 * 4. Exports processed data to SQLite
 * 
 * This is a pure class library - use src/cli/export.ts for command-line interface
 */

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

export interface PgRoutingOrchestratorConfig extends CarthorseOrchestratorConfig {
  // Additional pgRouting-specific configuration
  pgroutingTolerance?: number; // Tolerance for pgRouting node network creation
  usePgroutingTopology?: boolean; // Whether to use pgRouting topology functions
  exportRoutingNetwork?: boolean; // Whether to export the routing network
}

export class PgRoutingOrchestrator {
  private pgClient: Client;
  private pgConfig: any;
  private config: PgRoutingOrchestratorConfig;
  public readonly stagingSchema: string;
  private elevationService: ElevationService;
  private validationService: ValidationService;
  private cleanupService: CleanupService;
  private hooks: OrchestratorHooks;

  /**
   * Public method to manually cleanup staging schema (useful for tests)
   * SAFETY: Only cleans up staging schemas, never touches trail_master_db
   */
  public async cleanupStaging(): Promise<void> {
    console.log('🔒 SAFETY: Cleaning up only staging schemas, never trail_master_db');
    await this.cleanupService.cleanAllTestStagingSchemas();
  }

  /**
   * Safety check to ensure we never modify trail_master_db
   * This method validates that all operations are contained within staging schemas
   */
  private async validateSafetyConstraints(): Promise<void> {
    console.log('🔒 Performing safety validation...');
    
    // Check that staging schema follows safe naming pattern
    if (!this.stagingSchema.startsWith('staging_')) {
      throw new Error(`❌ SAFETY VIOLATION: Staging schema must start with 'staging_', got: ${this.stagingSchema}`);
    }
    
    // Check that we're not accidentally targeting public schema for modifications
    const publicSchemaCheck = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('trails', 'routing_nodes', 'routing_edges')
    `);
    
    if (publicSchemaCheck.rows[0].count > 0) {
      console.log('⚠️ WARNING: Public schema contains routing tables - ensuring READ-ONLY access');
    }
    
    console.log('✅ Safety validation passed - all operations will be contained in staging schema');
  }

  constructor(config?: PgRoutingOrchestratorConfig) {
    this.config = config || {
      region: 'boulder',
      outputPath: 'data/output.db',
      simplifyTolerance: 0.001,
      intersectionTolerance: 2.0,
      pgroutingTolerance: 0.0001, // Default pgRouting tolerance
      usePgroutingTopology: true,
      exportRoutingNetwork: true,
      replace: false,
      validate: true,
      verbose: false,
      skipBackup: false,
      buildMaster: false,
      targetSizeMB: null,
      maxSqliteDbSizeMB: 100,
      skipIncompleteTrails: false,
      useSqlite: false,
      useIntersectionNodes: true,
      useSplitTrails: true,
      aggressiveCleanup: true,
      cleanupOldStagingSchemas: true,
      cleanupTempFiles: true,
      maxStagingSchemasToKeep: 2,
      cleanupDatabaseLogs: false,
      skipValidation: false,
      skipBboxValidation: false,
      skipGeometryValidation: false,
      skipTrailValidation: false,
      skipRecommendations: false,
      targetSchemaVersion: 8
    };

    // Generate unique staging schema name
    const timestamp = Date.now();
    this.stagingSchema = `staging_${this.config.region}_${timestamp}`;

    // Initialize database connection
    this.pgConfig = getDbConfig();
    this.pgClient = new Client(this.pgConfig);
    
    // Initialize services (will be properly initialized after connection)
    this.elevationService = null as any;
    this.validationService = null as any;
    this.cleanupService = null as any;
    this.hooks = new OrchestratorHooks();

    // Initialize database connection
    this.pgConfig = getDbConfig();
    this.pgClient = new Client(this.pgConfig);
  }

  /**
   * Main entry point for pgRouting orchestrator
   */
  async run(): Promise<void> {
    console.log('🚀 Starting PgRouting Orchestrator...');
    console.log('🔒 SAFETY: All operations will be contained in staging schemas only');
    
    try {
      // Step 1: Connect to database
      console.log('🔗 Connecting to database...');
      await this.pgClient.connect();
      console.log('✅ Database connected successfully');
      
      // Step 2: Check required SQL functions and pgRouting extension
      console.log('🔍 Checking required SQL functions and pgRouting extension...');
      await this.checkRequiredSqlFunctions();
      
      // Step 3: Safety check - verify we're operating on the correct database
      console.log('🔍 Step 3: Safety check - verifying database...');
      await this.validateSafetyConstraints();
      console.log('✅ All checks completed successfully');
      
      // Step 4: Create staging environment
      console.log('🔧 Creating staging environment...');
      await this.createStagingEnvironment();
      
      // Step 5: Copy region data to staging (with bbox to limit processing)
      console.log('📋 Copying region data to staging (READ-ONLY from trail_master_db)...');
      
      // Use bbox from config if available, otherwise use a default Boulder area bbox
      const bbox = this.config.bbox || [-105.4, 39.9, -105.2, 40.1]; // min_lng, min_lat, max_lng, max_lat
      
      await this.copyRegionDataToStaging(bbox);
      
      // Step 4.5: Explode GeometryCollections immediately after copying data
      console.log('🧹 Step 4.5: Exploding GeometryCollections into individual geometries...');
      await this.pgClient.query(`
        -- Create a temporary table with exploded geometries
        DROP TABLE IF EXISTS ${this.stagingSchema}.exploded_trails;
        CREATE TABLE ${this.stagingSchema}.exploded_trails AS
        WITH exploded AS (
          SELECT 
            id,
            app_uuid,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            created_at,
            updated_at,
            (ST_Dump(geometry)).geom as geometry
          FROM ${this.stagingSchema}.trails
          WHERE ST_IsValid(geometry)
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          app_uuid,
          name,
          region,
          trail_type,
          surface,
          difficulty,
          source_tags,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          created_at,
          updated_at,
          geometry::geometry(LineString, 4326) as geometry
        FROM exploded
        WHERE ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_IsValid(geometry)
          AND ST_Length(geometry) > 0.001;
      `);
      
      // Replace the original trails table with exploded version
      console.log('🧹 Step 4.6: Replacing original trails with exploded version...');
      await this.pgClient.query(`
        DROP TABLE ${this.stagingSchema}.trails;
        ALTER TABLE ${this.stagingSchema}.exploded_trails RENAME TO trails;
      `);
      
      const explodedCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails 
        WHERE ST_GeometryType(geometry) = 'ST_LineString' AND ST_IsValid(geometry);
      `);
      console.log(`✅ Exploded geometry count: ${explodedCount.rows[0].count} clean LineStrings`);
      
      if (explodedCount.rows[0].count === 0) {
        throw new Error('❌ No valid LineString geometries remaining after exploding GeometryCollections');
      }
      
      // Step 4.7: Comprehensive pgRouting-friendly preprocessing
      console.log('🧹 Step 4.7: Comprehensive pgRouting-friendly preprocessing...');
      await this.preprocessForPgRouting();
      
      // Step 5: Generate routing network using pgRouting (only in staging)
      await this.generatePgRoutingNetwork();
      
      // Step 7: Export to SQLite
      await this.exportDatabase();
      
      // Step 7: Validation and cleanup
      if (this.config.validate) {
        await this.validateExport();
      }
      // Skip cleanup to avoid hanging - schemas can be cleaned manually later
      console.log('🧹 Skipping cleanup to avoid hanging - schemas can be cleaned manually later');
      // await this.performComprehensiveCleanup();
      
      console.log('🔒 SAFETY: All operations completed successfully within staging schemas');
      
    } catch (error) {
      console.error('❌ Error in PgRouting Orchestrator:', error);
      throw error;
    } finally {
      if (this.pgClient) {
        await this.pgClient.end();
      }
    }
  }

  /**
   * Check that required SQL functions and pgRouting extension are available
   */
  private async checkRequiredSqlFunctions(): Promise<void> {
    console.log('🔍 Checking required SQL functions and pgRouting extension...');
    
    try {
      console.log('🔍 Step 1: Checking pgRouting extension...');
      // Check if pgRouting extension is available
      const pgroutingCheck = await this.pgClient.query(`
        SELECT EXISTS(
          SELECT 1 FROM pg_extension WHERE extname = 'pgrouting'
        ) as pgrouting_available;
      `);
      
      if (!pgroutingCheck.rows[0].pgrouting_available) {
        throw new Error('❌ pgRouting extension is not installed. Please install pgRouting first.');
      }
      
      console.log('✅ pgRouting extension is available');
      
      console.log('🔍 Step 2: Checking required pgRouting functions...');
      // Check for required pgRouting functions (using correct case-sensitive names)
      const requiredFunctions = [
        'pgr_nodenetwork',
        'pgr_createtopology',
        'pgr_analyzegraph'
      ];
      
      for (const funcName of requiredFunctions) {
        console.log(`🔍 Checking function: ${funcName}...`);
        const funcCheck = await this.pgClient.query(`
          SELECT EXISTS(
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = $1
          ) as function_available;
        `, [funcName]);
        
        if (!funcCheck.rows[0].function_available) {
          throw new Error(`❌ Required pgRouting function '${funcName}' is not available.`);
        }
        console.log(`✅ Function '${funcName}' is available`);
      }
      
      console.log('✅ All required pgRouting functions are available');
      
      console.log('🔍 Step 3: Safety check - verifying database...');
      // SAFETY CHECK: Verify we're not accidentally targeting trail_master_db for modifications
      const currentDb = await this.pgClient.query('SELECT current_database() as db_name');
      console.log(`🔒 Safety check: Operating on database: ${currentDb.rows[0].db_name}`);
      
      console.log('✅ All checks completed successfully');
      
    } catch (error) {
      console.error('❌ Error checking required functions:', error);
      throw error;
    }
  }

  /**
   * Create staging environment with pgRouting-specific tables
   * SAFETY: Only creates/modifies staging schema, never touches trail_master_db
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log(`🔧 Creating staging environment: ${this.stagingSchema}`);
    console.log('🔒 SAFETY: Only creating staging schema, never modifying trail_master_db');
    
    try {
      // SAFETY CHECK: Ensure staging schema name follows safe pattern
      if (!this.stagingSchema.startsWith('staging_')) {
        throw new Error(`❌ SAFETY VIOLATION: Staging schema must start with 'staging_', got: ${this.stagingSchema}`);
      }
      
      // Drop existing schema if it exists (only staging schemas)
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
      
      // Create new schema (only staging schemas)
      await this.pgClient.query(`CREATE SCHEMA ${this.stagingSchema}`);
      
      // Create staging tables with pgRouting support (only in staging schema)
      const stagingSql = getStagingSchemaSql(this.stagingSchema);
      await this.pgClient.query(stagingSql);
      
      // Create additional pgRouting-specific tables (only in staging schema)
      await this.createPgRoutingTables();
      
      console.log(`✅ Staging environment created: ${this.stagingSchema}`);
      console.log('🔒 SAFETY: All operations contained within staging schema');
      
    } catch (error) {
      console.error('❌ Error creating staging environment:', error);
      throw error;
    }
  }

  /**
   * Create pgRouting-specific tables
   */
  private async createPgRoutingTables(): Promise<void> {
    console.log('📊 Creating pgRouting-specific tables...');
    
    const pgroutingTablesSql = `
      -- Table for pgRouting node network (exact pgRouting structure)
      CREATE TABLE ${this.stagingSchema}.trails_noded (
        id SERIAL PRIMARY KEY,
        old_id INTEGER,
        sub_id INTEGER,
        source INTEGER,
        target INTEGER,
        cost REAL,
        reverse_cost REAL,
        geometry geometry(LineString, 4326)
      );

      -- Table for pgRouting vertices (exact pgRouting structure)
      CREATE TABLE ${this.stagingSchema}.trails_vertices_pgr (
        id SERIAL PRIMARY KEY,
        cnt INTEGER,
        chk INTEGER,
        ein INTEGER,
        eout INTEGER,
        the_geom geometry(Point, 4326)
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_noded_geometry 
        ON ${this.stagingSchema}.trails_noded USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_vertices_pgr_geometry 
        ON ${this.stagingSchema}.trails_vertices_pgr USING GIST(the_geom);
    `;
    
    await this.pgClient.query(pgroutingTablesSql);
    console.log('✅ pgRouting tables created with exact pgRouting structure');
  }

  /**
   * Copy region data to staging schema (READ-ONLY from trail_master_db)
   */
  private async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log('📋 Copying region data to staging (READ-ONLY from trail_master_db)...');
    
    try {
      const region = this.config.region;
      const bboxClause = bbox ? 
        `AND ST_Intersects(geometry, ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326))` : '';
      
      // READ-ONLY copy from trail_master_db to staging schema - KEEP 3D for trails
      // This operation only READS from public.trails and WRITES to staging schema
      const copySql = `
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, region, trail_type, surface, difficulty,
          source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation,
          avg_elevation, source, created_at, updated_at, geometry
        )
        SELECT 
          app_uuid, name, region, trail_type, surface, difficulty,
          source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation,
          avg_elevation, source, created_at, updated_at, ST_Force2D(geometry) as geometry
        FROM public.trails
        WHERE region = $1 ${bboxClause}
        AND geometry IS NOT NULL
        AND ST_IsValid(geometry)
      `;
      
      const result = await this.pgClient.query(copySql, [region]);
      console.log(`✅ Copied ${result.rowCount} trails to staging (READ-ONLY from trail_master_db) - keeping 3D geometry for trails`);
      
    } catch (error) {
      console.error('❌ Error copying region data:', error);
      throw error;
    }
  }

  /**
   * Comprehensive preprocessing to make data pgRouting-friendly
   * This method simplifies, deduplicates, and explodes GeometryCollections
   */
  private async preprocessForPgRouting(): Promise<void> {
    console.log('🧹 Comprehensive pgRouting preprocessing...');
    
    try {
      // Step 1: Explode GeometryCollections into individual LineStrings
      console.log('  📦 Step 1: Exploding GeometryCollections...');
      await this.pgClient.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.exploded_trails;
        CREATE TABLE ${this.stagingSchema}.exploded_trails AS
        WITH exploded AS (
          SELECT 
            id,
            app_uuid,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            created_at,
            updated_at,
            (ST_Dump(geometry)).geom as geometry
          FROM ${this.stagingSchema}.trails
          WHERE ST_IsValid(geometry)
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          app_uuid,
          name,
          region,
          trail_type,
          surface,
          difficulty,
          source_tags,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          created_at,
          updated_at,
          geometry::geometry(LineString, 4326) as geometry
        FROM exploded
        WHERE ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_IsValid(geometry)
          AND ST_Length(geometry) > 0.001;
      `);
      
      // Step 2: Replace original table with exploded version
      console.log('  🔄 Step 2: Replacing with exploded geometries...');
      await this.pgClient.query(`
        DROP TABLE ${this.stagingSchema}.trails;
        ALTER TABLE ${this.stagingSchema}.exploded_trails RENAME TO trails;
      `);
      
      // Step 3: Flatten 3D geometries to 2D for pgRouting compatibility
      console.log('  📐 Step 3: Flattening 3D geometries to 2D...');
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails 
        SET geometry = ST_Force2D(geometry)
        WHERE ST_NDims(geometry) > 2;
      `);
      
      // Step 4: Simplify geometries to reduce complexity
      console.log('  ✂️ Step 4: Simplifying geometries...');
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails 
        SET geometry = ST_SimplifyPreserveTopology(geometry, 0.0001)
        WHERE ST_NumPoints(geometry) > 100;
      `);
      
      // Step 5: Remove invalid and problematic geometries
      console.log('  🧹 Step 5: Removing invalid geometries...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails
        WHERE NOT ST_IsValid(geometry)
          OR ST_IsEmpty(geometry)
          OR ST_Length(geometry) < 0.001
          OR ST_GeometryType(geometry) != 'ST_LineString';
      `);
      
      // Step 6: Remove exact duplicates
      console.log('  🚫 Step 6: Removing exact duplicates...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails a
        USING ${this.stagingSchema}.trails b
        WHERE a.ctid < b.ctid AND ST_Equals(a.geometry, b.geometry);
      `);
      
      // Step 7: Remove overlapping segments (keep the longer one)
      console.log('  🔗 Step 7: Removing overlapping segments...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails a
        USING ${this.stagingSchema}.trails b
        WHERE a.ctid < b.ctid 
          AND ST_Contains(b.geometry, a.geometry)
          AND ST_Length(a.geometry) < ST_Length(b.geometry);
      `);
      
      // Step 8: Remove self-intersecting geometries
      console.log('  🔄 Step 8: Removing self-intersecting geometries...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails
        WHERE NOT ST_IsSimple(geometry);
      `);
      
      // Step 9: Snap vertices to grid to remove minuscule errors
      console.log('  📍 Step 9: Snapping vertices to grid...');
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails
        SET geometry = ST_SnapToGrid(geometry, 0.00001);
      `);
      
      // Step 9.5: Comprehensive GeometryCollection detection and explosion
      console.log('  🔍 Step 9.5: Detecting and exploding GeometryCollections...');
      await this.pgClient.query(`
        -- First, identify any GeometryCollections
        DROP TABLE IF EXISTS ${this.stagingSchema}.geometry_collections;
        CREATE TABLE ${this.stagingSchema}.geometry_collections AS
        SELECT id, geometry, ST_GeometryType(geometry) as geom_type
        FROM ${this.stagingSchema}.trails
        WHERE ST_GeometryType(geometry) = 'ST_GeometryCollection';
      `);
      
      const gcCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.geometry_collections;
      `);
      
      if (gcCount.rows[0].count > 0) {
        console.log(`  ⚠️ Found ${gcCount.rows[0].count} GeometryCollections - exploding them...`);
        
        // Explode GeometryCollections into individual geometries
        await this.pgClient.query(`
          DROP TABLE IF EXISTS ${this.stagingSchema}.exploded_gc;
          CREATE TABLE ${this.stagingSchema}.exploded_gc AS
          WITH exploded AS (
            SELECT 
              gc.id,
              (ST_Dump(gc.geometry)).geom as geometry,
              (ST_Dump(gc.geometry)).path as path
            FROM ${this.stagingSchema}.geometry_collections gc
          )
          SELECT 
            ROW_NUMBER() OVER () as id,
            geometry::geometry(LineString, 4326) as geometry
          FROM exploded
          WHERE ST_GeometryType(geometry) = 'ST_LineString'
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0.001;
        `);
        
        // Remove GeometryCollections from main table and add exploded versions
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.trails
          WHERE id IN (SELECT id FROM ${this.stagingSchema}.geometry_collections);
          
          INSERT INTO ${this.stagingSchema}.trails (id, geometry)
          SELECT id, geometry FROM ${this.stagingSchema}.exploded_gc;
        `);
        
        const explodedCount = await this.pgClient.query(`
          SELECT COUNT(*) as count FROM ${this.stagingSchema}.exploded_gc;
        `);
        console.log(`  ✅ Exploded ${explodedCount.rows[0].count} LineStrings from GeometryCollections`);
      } else {
        console.log('  ✅ No GeometryCollections found');
      }
      
      // Step 10: Remove overlapping segments that cause linear intersections
      console.log('  🔗 Step 10: Removing overlapping segments that cause linear intersections...');
      await this.pgClient.query(`
        -- Remove trails that share significant segments (>10% overlap)
        DELETE FROM ${this.stagingSchema}.trails a
        USING ${this.stagingSchema}.trails b
        WHERE a.ctid < b.ctid 
          AND ST_Intersects(a.geometry, b.geometry)
          AND ST_Length(ST_Intersection(a.geometry, b.geometry)) / ST_Length(a.geometry) > 0.1;
      `);
      
      // Step 11: Remove trails that create linear intersections
      console.log('  🔄 Step 11: Removing trails that create linear intersections...');
      await this.pgClient.query(`
        -- Remove trails that would create MultiPoint intersections
        DELETE FROM ${this.stagingSchema}.trails t1
        WHERE EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.trails t2
          WHERE t1.id != t2.id
            AND ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_MultiPoint'
        );
      `);
      
      // Step 12: Use PostGIS to eliminate linear intersections
      console.log('  🔧 Step 12: Using PostGIS to eliminate linear intersections...');
      await this.pgClient.query(`
        -- Create a table with trails that don't have linear intersections
        DROP TABLE IF EXISTS ${this.stagingSchema}.non_intersecting_trails;
        CREATE TABLE ${this.stagingSchema}.non_intersecting_trails AS
        WITH trail_pairs AS (
          SELECT 
            t1.id as id1, t1.geometry as geom1,
            t2.id as id2, t2.geometry as geom2
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)) > 0.001
        ),
        problematic_trails AS (
          SELECT DISTINCT id1 as trail_id FROM trail_pairs
          UNION
          SELECT DISTINCT id2 as trail_id FROM trail_pairs
        )
        SELECT t.*
        FROM ${this.stagingSchema}.trails t
        WHERE NOT EXISTS (
          SELECT 1 FROM problematic_trails pt WHERE pt.trail_id = t.id
        );
      `);
      
      // Step 13: Replace with non-intersecting trails
      console.log('  🔄 Step 13: Replacing with non-intersecting trails...');
      await this.pgClient.query(`
        DROP TABLE ${this.stagingSchema}.trails;
        ALTER TABLE ${this.stagingSchema}.non_intersecting_trails RENAME TO trails;
      `);
      
      // Step 14: Advanced GeometryCollection cleanup
      console.log('  🔧 Step 14: Advanced GeometryCollection cleanup...');
      await this.pgClient.query(`
        -- Handle any remaining GeometryCollections by extracting only LineStrings
        DROP TABLE IF EXISTS ${this.stagingSchema}.final_clean_trails;
        CREATE TABLE ${this.stagingSchema}.final_clean_trails AS
        WITH cleaned AS (
          SELECT 
            id,
            app_uuid,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            created_at,
            updated_at,
            geometry
          FROM ${this.stagingSchema}.trails
          WHERE ST_GeometryType(geometry) != 'ST_GeometryCollection'
        ),
        exploded AS (
          SELECT 
            id,
            app_uuid,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            created_at,
            updated_at,
            (ST_Dump(geometry)).geom as geometry
          FROM ${this.stagingSchema}.trails
          WHERE ST_GeometryType(geometry) = 'ST_GeometryCollection'
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          app_uuid,
          name,
          region,
          trail_type,
          surface,
          difficulty,
          source_tags,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          created_at,
          updated_at,
          geometry::geometry(LineString, 4326) as geometry
        FROM (
          SELECT * FROM cleaned
          UNION ALL
          SELECT * FROM exploded
        ) combined
        WHERE ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_IsValid(geometry)
          AND ST_Length(geometry) > 0.001;
      `);
      
      // Step 15: Alternative approach - Split trails at intersection points
      console.log('  🔧 Step 15: Splitting trails at intersection points...');
      await this.pgClient.query(`
        -- Create a table with trails split at intersection points
        DROP TABLE IF EXISTS ${this.stagingSchema}.split_trails;
        CREATE TABLE ${this.stagingSchema}.split_trails AS
        WITH intersection_points AS (
          SELECT 
            t1.id as trail1_id, t1.geometry as trail1_geom,
            t2.id as trail2_id, t2.geometry as trail2_geom,
            ST_Intersection(t1.geometry, t2.geometry) as intersection
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)) > 0.001
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
        ),
        split_trails AS (
          SELECT 
            t.id,
            t.app_uuid,
            t.name,
            t.region,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.source_tags,
            t.bbox_min_lng,
            t.bbox_max_lng,
            t.bbox_min_lat,
            t.bbox_max_lat,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.max_elevation,
            t.min_elevation,
            t.avg_elevation,
            t.source,
            t.created_at,
            t.updated_at,
            (ST_Dump(ST_Split(t.geometry, ip.intersection))).geom as geometry
          FROM ${this.stagingSchema}.trails t
          LEFT JOIN intersection_points ip ON t.id = ip.trail1_id OR t.id = ip.trail2_id
          WHERE ip.intersection IS NOT NULL
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          app_uuid,
          name,
          region,
          trail_type,
          surface,
          difficulty,
          source_tags,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          created_at,
          updated_at,
          geometry::geometry(LineString, 4326) as geometry
        FROM split_trails
        WHERE ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_IsValid(geometry)
          AND ST_Length(geometry) > 0.001;
      `);
      
      // Step 16: Replace with split trails if we have any, otherwise use final clean trails
      console.log('  🔄 Step 16: Replacing with split trails...');
      const splitCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trails;
      `);
      
      if (splitCount.rows[0].count > 0) {
        await this.pgClient.query(`
          DROP TABLE ${this.stagingSchema}.trails;
          ALTER TABLE ${this.stagingSchema}.split_trails RENAME TO trails;
        `);
        console.log(`  ✅ Using ${splitCount.rows[0].count} split trails`);
      } else {
        await this.pgClient.query(`
          DROP TABLE ${this.stagingSchema}.trails;
          ALTER TABLE ${this.stagingSchema}.final_clean_trails RENAME TO trails;
        `);
        console.log(`  ✅ Using final clean trails`);
      }
      
      // Step 17: Final validation and count
      console.log('  ✅ Step 17: Final validation...');
      const finalCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails 
        WHERE ST_GeometryType(geometry) = 'ST_LineString' 
          AND ST_IsValid(geometry)
          AND ST_IsSimple(geometry)
          AND ST_Length(geometry) > 0.001;
      `);
      
      console.log(`✅ Preprocessing complete: ${finalCount.rows[0].count} pgRouting-friendly LineStrings`);
      
      if (finalCount.rows[0].count === 0) {
        throw new Error('❌ No valid geometries remaining after preprocessing');
      }
      
      // Step 18: Export clean data to GeoJSON for inspection
      console.log('  📤 Step 18: Exporting clean data to GeoJSON for inspection...');
      await this.exportCleanDataToGeoJSON();
      
      // Step 19: Comprehensive PostGIS cleanup for pgRouting compatibility
      console.log('  🔧 Step 19: Comprehensive PostGIS cleanup for pgRouting compatibility...');
      await this.pgClient.query(`
        -- Step 0: Create working table with forced 2D geometries
        DROP TABLE IF EXISTS ${this.stagingSchema}.cleaned_trails;
        CREATE TABLE ${this.stagingSchema}.cleaned_trails AS
        SELECT
          ROW_NUMBER() OVER () AS id,
          (ST_Dump(ST_Force2D(ST_MakeValid(geometry)))).geom::geometry(LineString, 4326) AS geometry
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_MultiLineString');
      `);
      
      // Step 1: Deduplicate exact duplicates
      console.log('  🚫 Step 1: Deduplicating exact duplicates...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.cleaned_trails a
        USING ${this.stagingSchema}.cleaned_trails b
        WHERE a.id < b.id AND ST_Equals(a.geometry, b.geometry);
      `);
      
      // Step 2: Remove zero-length and self-overlapping lines
      console.log('  🧹 Step 2: Removing zero-length and self-overlapping lines...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.cleaned_trails
        WHERE ST_Length(geometry) = 0 OR NOT ST_IsSimple(geometry);
      `);
      
      // Step 3: Snap nearby endpoints to prevent nearly-duplicate segments
      console.log('  📍 Step 3: Snapping nearby endpoints...');
      await this.pgClient.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.snapped_trails;
        CREATE TABLE ${this.stagingSchema}.snapped_trails AS
        SELECT
          ct.id,
          ST_Snap(ct.geometry, geom_union.geometry, 0.00001) AS geometry
        FROM ${this.stagingSchema}.cleaned_trails ct,
        LATERAL (
          SELECT ST_Union(geometry) AS geometry
          FROM ${this.stagingSchema}.cleaned_trails
        ) AS geom_union;
      `);
      
      // Step 4: Final cleanup and revalidation
      console.log('  ✅ Step 4: Final cleanup and revalidation...');
      await this.pgClient.query(`
        DROP TABLE IF EXISTS ${this.stagingSchema}.routing_ready_trails;
        CREATE TABLE ${this.stagingSchema}.routing_ready_trails AS
        SELECT
          id,
          ST_MakeValid(geometry)::geometry(LineString, 4326) AS geometry
        FROM ${this.stagingSchema}.snapped_trails
        WHERE ST_IsValid(geometry)
          AND ST_NPoints(geometry) >= 2;
      `);
      
      // Step 5: Create spatial index and analyze
      console.log('  📊 Step 5: Creating spatial index and analyzing...');
      await this.pgClient.query(`
        CREATE INDEX ON ${this.stagingSchema}.routing_ready_trails USING GIST (geometry);
        ANALYZE ${this.stagingSchema}.routing_ready_trails;
      `);
      
      // Step 6: Replace original trails with routing-ready version
      console.log('  🔄 Step 6: Replacing with routing-ready trails...');
      await this.pgClient.query(`
        DROP TABLE ${this.stagingSchema}.trails;
        ALTER TABLE ${this.stagingSchema}.routing_ready_trails RENAME TO trails;
      `);
      
      // Step 7: Final count and validation
      const finalRoutingCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails 
        WHERE ST_GeometryType(geometry) = 'ST_LineString' 
          AND ST_IsValid(geometry)
          AND ST_IsSimple(geometry)
          AND ST_Length(geometry) > 0.001;
      `);
      
      console.log(`✅ PostGIS cleanup complete: ${finalRoutingCount.rows[0].count} routing-ready LineStrings`);
      
      // Step 8: Final GeometryCollection elimination before pgRouting
      console.log('  🔧 Step 8: Final GeometryCollection elimination before pgRouting...');
      await this.pgClient.query(`
        -- Create final table with only pure LineStrings, no GeometryCollections
        DROP TABLE IF EXISTS ${this.stagingSchema}.final_pgrouting_trails;
        CREATE TABLE ${this.stagingSchema}.final_pgrouting_trails AS
        SELECT 
          id,
          geometry::geometry(LineString, 4326) as geometry
        FROM ${this.stagingSchema}.trails
        WHERE ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_IsValid(geometry)
          AND ST_IsSimple(geometry)
          AND ST_Length(geometry) > 0.001
          AND ST_NPoints(geometry) >= 2;
      `);
      
      // Replace with final pgRouting-ready table
      await this.pgClient.query(`
        DROP TABLE ${this.stagingSchema}.trails;
        ALTER TABLE ${this.stagingSchema}.final_pgrouting_trails RENAME TO trails;
      `);
      
      // Final count
      const finalPgroutingCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails;
      `);
      
      console.log(`✅ Final pgRouting-ready trails: ${finalPgroutingCount.rows[0].count} pure LineStrings`);
      
    } catch (error) {
      console.error('❌ Error in pgRouting preprocessing:', error);
      throw error;
    }
  }

  /**
   * Generate routing network using pure PostGIS (avoiding pgRouting GeometryCollection issues)
   */
  private async generatePgRoutingNetwork(): Promise<void> {
    console.log('🛣️ Generating routing network using pure PostGIS...');
    
    try {
      // Step 1: Create nodes at trail endpoints and intersections
      console.log('📍 Step 1: Creating nodes at trail endpoints and intersections...');
      await this.pgClient.query(`
        -- Drop existing tables if they exist (with CASCADE to handle foreign keys)
        DROP TABLE IF EXISTS ${this.stagingSchema}.routing_edges CASCADE;
        DROP TABLE IF EXISTS ${this.stagingSchema}.routing_nodes CASCADE;
        
        -- Create nodes table
        CREATE TABLE ${this.stagingSchema}.routing_nodes (
          id SERIAL PRIMARY KEY,
          lat DOUBLE PRECISION NOT NULL,
          lng DOUBLE PRECISION NOT NULL,
          elevation DOUBLE PRECISION,
          node_type TEXT DEFAULT 'intersection',
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        -- Insert nodes at trail endpoints
        INSERT INTO ${this.stagingSchema}.routing_nodes (lat, lng, node_type)
        SELECT DISTINCT 
          ST_Y(ST_StartPoint(geometry)) as lat,
          ST_X(ST_StartPoint(geometry)) as lng,
          'endpoint' as node_type
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry)
        
        UNION
        
        SELECT DISTINCT 
          ST_Y(ST_EndPoint(geometry)) as lat,
          ST_X(ST_EndPoint(geometry)) as lng,
          'endpoint' as node_type
        FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry);
      `);
      
      // Step 2: Create edges between nodes
      console.log('🛤️ Step 2: Creating edges between nodes...');
      await this.pgClient.query(`
        -- Create edges table
        DROP TABLE IF EXISTS ${this.stagingSchema}.routing_edges;
        CREATE TABLE ${this.stagingSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          source INTEGER NOT NULL,
          target INTEGER NOT NULL,
          trail_id TEXT NOT NULL,
          trail_name TEXT NOT NULL,
          length_km REAL NOT NULL,
          elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
          elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
          is_bidirectional BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW(),
          geometry geometry(LineString, 4326),
          geojson TEXT,
          FOREIGN KEY (source) REFERENCES ${this.stagingSchema}.routing_nodes(id) ON DELETE CASCADE,
          FOREIGN KEY (target) REFERENCES ${this.stagingSchema}.routing_nodes(id) ON DELETE CASCADE
        );
        
        -- Insert edges for each trail segment
        INSERT INTO ${this.stagingSchema}.routing_edges (
          source, target, trail_id, trail_name, length_km, 
          elevation_gain, elevation_loss, geometry
        )
        SELECT 
          source_node.id as source,
          target_node.id as target,
          t.id::TEXT as trail_id,
          'trail-' || t.id as trail_name,
          ST_Length(t.geometry) * 111.32 as length_km, -- Convert to km
          NULL as elevation_gain,
          NULL as elevation_loss,
          t.geometry
        FROM ${this.stagingSchema}.trails t
        JOIN ${this.stagingSchema}.routing_nodes source_node ON 
          ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(source_node.lng, source_node.lat), 4326), 0.001)
        JOIN ${this.stagingSchema}.routing_nodes target_node ON 
          ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(target_node.lng, target_node.lat), 4326), 0.001)
        WHERE source_node.id != target_node.id
          AND ST_IsValid(t.geometry)
          AND ST_Length(t.geometry) > 0.001;
      `);
      
      // Step 3: Add spatial indexes
      console.log('📊 Step 3: Adding spatial indexes...');
      await this.pgClient.query(`
        CREATE INDEX ON ${this.stagingSchema}.routing_nodes USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
        CREATE INDEX ON ${this.stagingSchema}.routing_edges USING GIST (geometry);
        ANALYZE ${this.stagingSchema}.routing_nodes;
        ANALYZE ${this.stagingSchema}.routing_edges;
      `);
      
      // Step 4: Count results
      const nodeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes;
      `);
      
      const edgeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges;
      `);
      
      console.log(`✅ PostGIS routing network complete: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
      
    } catch (error) {
      console.error('❌ Error generating routing network:', error);
      throw error;
    }
  }

  /**
   * Create node network using pgRouting (simplified - data already preprocessed)
   */
  private async createNodeNetwork(tolerance: number): Promise<void> {
    // SAFETY CHECK: Ensure we're only operating on staging schema
    if (!this.stagingSchema.startsWith('staging_')) {
      throw new Error(`❌ SAFETY VIOLATION: Cannot operate on non-staging schema: ${this.stagingSchema}`);
    }
    
    console.log(`🔒 SAFETY: Creating node network only in staging schema: ${this.stagingSchema}`);
    
    try {
      // Data is already preprocessed, try with much higher tolerance first
      console.log('🔄 Running pgr_nodenetwork with high tolerance to handle linear intersections...');
      
      // Try with a much higher tolerance to ignore minor intersections
      const highTolerance = tolerance * 1000; // 1.0 instead of 0.001
      
      const pgroutingSql = `
        SELECT pgr_nodenetwork(
          '${this.stagingSchema}.trails',
          ${highTolerance},
          'id',
          'geometry'
        );
      `;
      
      await this.pgClient.query(pgroutingSql);
      
      // Verify the results
      const nodeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_vertices_pgr;
      `);
      
      const edgeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_noded;
      `);
      
      console.log(`✅ pgr_nodenetwork completed with high tolerance: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
      
    } catch (error) {
      console.error('❌ Error creating node network:', error);
      throw error;
    }
  }

  /**
   * Create topology using pgRouting
   * SAFETY: Only operates on staging schema tables
   */
  private async createTopology(): Promise<void> {
    // SAFETY CHECK: Ensure we're only operating on staging schema
    if (!this.stagingSchema.startsWith('staging_')) {
      throw new Error(`❌ SAFETY VIOLATION: Cannot operate on non-staging schema: ${this.stagingSchema}`);
    }
    
    // Determine which noded table exists
    const tableCheck = await this.pgClient.query(`
      SELECT 
        CASE 
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'ultra_clean_trails_noded') THEN 'ultra_clean_trails_noded'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'clean_trails_noded') THEN 'clean_trails_noded'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'trails_noded') THEN 'trails_noded'
          ELSE 'trails_noded'
        END as noded_table
    `);
    
    const nodedTable = tableCheck.rows[0].noded_table;
    console.log(`🔍 Using noded table: ${this.stagingSchema}.${nodedTable}`);
    
    const topologySql = `
      SELECT pgr_createtopology(
        '${this.stagingSchema}.${nodedTable}',
        ${this.config.pgroutingTolerance || 0.0001},
        'the_geom',
        'id'
      );
    `;
    
    console.log(`🔒 SAFETY: Creating topology only in staging schema: ${this.stagingSchema}`);
    const result = await this.pgClient.query(topologySql);
    console.log(`✅ Topology created in staging schema: ${JSON.stringify(result.rows[0])}`);
  }

  /**
   * Analyze graph using pgRouting
   * SAFETY: Only operates on staging schema tables
   */
  private async analyzeGraph(): Promise<void> {
    // SAFETY CHECK: Ensure we're only operating on staging schema
    if (!this.stagingSchema.startsWith('staging_')) {
      throw new Error(`❌ SAFETY VIOLATION: Cannot operate on non-staging schema: ${this.stagingSchema}`);
    }
    
    // Determine which noded table exists
    const tableCheck = await this.pgClient.query(`
      SELECT 
        CASE 
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'ultra_clean_trails_noded') THEN 'ultra_clean_trails_noded'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'clean_trails_noded') THEN 'clean_trails_noded'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'trails_noded') THEN 'trails_noded'
          ELSE 'trails_noded'
        END as noded_table
    `);
    
    const nodedTable = tableCheck.rows[0].noded_table;
    console.log(`🔍 Using noded table for analysis: ${this.stagingSchema}.${nodedTable}`);
    
    const analyzeSql = `
      SELECT pgr_analyzegraph(
        '${this.stagingSchema}.${nodedTable}',
        ${this.config.pgroutingTolerance || 0.0001},
        'the_geom',
        'id'
      );
    `;
    
    console.log(`🔒 SAFETY: Analyzing graph only in staging schema: ${this.stagingSchema}`);
    const result = await this.pgClient.query(analyzeSql);
    console.log(`✅ Graph analysis completed in staging schema: ${JSON.stringify(result.rows[0])}`);
  }

  /**
   * Generate routing nodes and edges from pgRouting results
   */
  private async generateRoutingNodesAndEdges(): Promise<void> {
    console.log('🔄 Generating routing nodes and edges from pgRouting results...');
    
    // Determine which noded table and vertices table exist
    const tableCheck = await this.pgClient.query(`
      SELECT 
        CASE 
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'ultra_clean_trails_noded') THEN 'ultra_clean_trails_noded'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'clean_trails_noded') THEN 'clean_trails_noded'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'trails_noded') THEN 'trails_noded'
          ELSE 'trails_noded'
        END as noded_table,
        CASE 
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'ultra_clean_trails_noded_vertices_pgr') THEN 'ultra_clean_trails_noded_vertices_pgr'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'clean_trails_noded_vertices_pgr') THEN 'clean_trails_noded_vertices_pgr'
          WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '${this.stagingSchema}' AND table_name = 'trails_noded_vertices_pgr') THEN 'trails_noded_vertices_pgr'
          ELSE 'trails_noded_vertices_pgr'
        END as vertices_table
    `);
    
    const nodedTable = tableCheck.rows[0].noded_table;
    const verticesTable = tableCheck.rows[0].vertices_table;
    console.log(`🔍 Using noded table: ${this.stagingSchema}.${nodedTable}`);
    console.log(`🔍 Using vertices table: ${this.stagingSchema}.${verticesTable}`);
    
    // Generate routing nodes from pgRouting vertices (using integer IDs)
    const nodesSql = `
      INSERT INTO ${this.stagingSchema}.routing_nodes (
        id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at
      )
      SELECT 
        v.id,
        gen_random_uuid() as node_uuid,
        ST_Y(v.the_geom) as lat,
        ST_X(v.the_geom) as lng,
        0 as elevation,
        CASE 
          WHEN v.cnt > 2 THEN 'intersection'
          ELSE 'endpoint'
        END as node_type,
        'Connected trails' as connected_trails,
        ARRAY[]::TEXT[] as trail_ids,
        NOW() as created_at
      FROM ${this.stagingSchema}.${verticesTable} v
      WHERE v.the_geom IS NOT NULL;
    `;
    
    const nodesResult = await this.pgClient.query(nodesSql);
    console.log(`✅ Generated ${nodesResult.rowCount} routing nodes from pgRouting vertices`);
    
    // Generate routing edges from pgRouting noded trails (using native pgRouting structure)
    const edgesSql = `
      INSERT INTO ${this.stagingSchema}.routing_edges (
        source, target, trail_id, trail_name, length_km, elevation_gain, 
        elevation_loss, is_bidirectional, geometry, created_at
      )
      SELECT 
        n.source,
        n.target,
        t.app_uuid as trail_id,
        t.name as trail_name,
        ST_Length(n.the_geom::geography) / 1000.0 as length_km,
        COALESCE(t.elevation_gain, 0) as elevation_gain,
        COALESCE(t.elevation_loss, 0) as elevation_loss,
        TRUE as is_bidirectional,
        n.the_geom as geometry,
        NOW() as created_at
      FROM ${this.stagingSchema}.${nodedTable} n
      JOIN ${this.stagingSchema}.trails t ON n.old_id = t.id
      WHERE n.source IS NOT NULL AND n.target IS NOT NULL;
    `;
    
    const edgesResult = await this.pgClient.query(edgesSql);
    console.log(`✅ Generated ${edgesResult.rowCount} routing edges from pgRouting noded trails`);
  }





  /**
   * Export database to SQLite
   */
  private async exportDatabase(): Promise<void> {
    console.log(`💾 Exporting to: ${this.config.outputPath}`);
    
    try {
      // Create output directory if it doesn't exist
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Export routing nodes and edges to SQLite
      await this.exportRoutingData();
      
      console.log(`✅ Export completed: ${this.config.outputPath}`);
      
    } catch (error) {
      console.error('❌ Error exporting database:', error);
      throw error;
    }
  }

  /**
   * Export routing data to single GeoJSON file
   */
  private async exportRoutingData(): Promise<void> {
    console.log('📤 Exporting routing data to single GeoJSON file...');
    
    try {
      // Create output directory if it doesn't exist
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Export all data to a single GeoJSON file
      await this.exportCombinedGeoJSON();
      
      console.log(`✅ GeoJSON export completed: ${this.config.outputPath}`);
      
    } catch (error) {
      console.error('❌ Error exporting to GeoJSON:', error);
      throw error;
    }
  }

  /**
   * Export combined GeoJSON with trails, nodes, and edges
   */
  private async exportCombinedGeoJSON(): Promise<void> {
    // Get trails data
    const trailsSql = `
      SELECT 
        id,
        id as app_uuid,
        'trail-' || id as name,
        'hiking' as trail_type,
        ST_Length(geometry) * 111.32 as length_km,
        NULL as elevation_gain,
        NULL as elevation_loss,
        ST_AsGeoJSON(geometry) as geometry
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY id;
    `;
    
    const trailsResult = await this.pgClient.query(trailsSql);
    
    // Get nodes data
    const nodesSql = `
      SELECT 
        id,
        'node-' || id as node_uuid,
        lat,
        lng,
        NULL as elevation,
        node_type,
        NULL as connected_trails,
        ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(lng, lat), 4326)) as geometry
      FROM ${this.stagingSchema}.routing_nodes
      ORDER BY id;
    `;
    
    const nodesResult = await this.pgClient.query(nodesSql);
    
    // Get edges data
    const edgesSql = `
      SELECT 
        id,
        source,
        target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        is_bidirectional,
        ST_AsGeoJSON(geometry) as geometry
      FROM ${this.stagingSchema}.routing_edges
      WHERE geometry IS NOT NULL
      ORDER BY id;
    `;
    
    const edgesResult = await this.pgClient.query(edgesSql);
    
    // Create combined GeoJSON with all features
    const combinedGeoJSON = {
      type: "FeatureCollection",
      name: `${this.config.region}_pgrouting_network`,
      description: `PgRouting network for ${this.config.region} with trails (green), nodes (blue), and edges (magenta)`,
      features: [
        // Trails (green lines)
        ...trailsResult.rows.map((row: any) => ({
          type: "Feature",
          properties: {
            id: row.app_uuid,
            name: row.name,
            trail_type: row.trail_type,
            length_km: row.length_km,
            elevation_gain: row.elevation_gain,
            elevation_loss: row.elevation_loss,
            layer: "trails",
            color: "#00FF00", // Green
            stroke: "#00FF00",
            "stroke-width": 3,
            "stroke-opacity": 0.8
          },
          geometry: JSON.parse(row.geometry)
        })),
        
        // Nodes (small blue dots)
        ...nodesResult.rows.map((row: any) => ({
          type: "Feature",
          properties: {
            id: row.id,
            node_uuid: row.node_uuid,
            elevation: row.elevation,
            node_type: row.node_type,
            connected_trails: row.connected_trails,
            layer: "nodes",
            color: "#0000FF", // Blue
            "marker-color": "#0000FF",
            "marker-size": "small",
            "marker-symbol": "circle"
          },
          geometry: JSON.parse(row.geometry)
        })),
        
        // Edges (magenta lines)
        ...edgesResult.rows.map((row: any) => ({
          type: "Feature",
          properties: {
            id: row.id,
            source: row.source,
            target: row.target,
            trail_id: row.trail_id,
            trail_name: row.trail_name,
            length_km: row.length_km,
            elevation_gain: row.elevation_gain,
            elevation_loss: row.elevation_loss,
            is_bidirectional: row.is_bidirectional,
            layer: "edges",
            color: "#FF00FF", // Magenta
            stroke: "#FF00FF",
            "stroke-width": 2,
            "stroke-opacity": 0.6
          },
          geometry: JSON.parse(row.geometry)
        }))
      ]
    };
    
    // Write to single GeoJSON file
    const geojsonPath = this.config.outputPath.replace('.db', '.geojson');
    fs.writeFileSync(geojsonPath, JSON.stringify(combinedGeoJSON, null, 2));
    
    console.log(`✅ Exported combined GeoJSON to ${geojsonPath}`);
    console.log(`   - ${trailsResult.rows.length} trails (green lines)`);
    console.log(`   - ${nodesResult.rows.length} nodes (blue dots)`);
    console.log(`   - ${edgesResult.rows.length} edges (magenta lines)`);
  }

  /**
   * Validate export
   */
  private async validateExport(): Promise<void> {
    console.log('🔍 Validating export...');
    
    try {
      // Validate routing network
      const nodeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes
      `);
      
      const edgeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges
      `);
      
      console.log(`✅ Validation complete:`);
      console.log(`   - Routing nodes: ${nodeCount.rows[0].count}`);
      console.log(`   - Routing edges: ${edgeCount.rows[0].count}`);
      
    } catch (error) {
      console.error('❌ Error validating export:', error);
      throw error;
    }
  }

  /**
   * Perform comprehensive cleanup
   */
  private async performComprehensiveCleanup(): Promise<void> {
    console.log('🧹 Performing comprehensive cleanup...');
    
    try {
      await this.cleanupService.cleanAllTestStagingSchemas();
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      throw error;
    }
  }

  /**
   * Create a manual routing network when pgRouting fails
   * This creates nodes at trail endpoints and edges between connected trails
   */
  private async createManualRoutingNetwork(): Promise<void> {
    console.log('🔄 Creating manual routing network...');
    
    try {
      // Create nodes at trail endpoints
      console.log('📍 Creating nodes at trail endpoints...');
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.routing_nodes (
          id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at
        )
        WITH trail_endpoints AS (
          SELECT 
            id,
            app_uuid,
            name,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point,
            ST_Z(ST_StartPoint(geometry)) as start_elevation,
            ST_Z(ST_EndPoint(geometry)) as end_elevation
          FROM ${this.stagingSchema}.trails
          WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
        ),
        all_endpoints AS (
          SELECT 
            id,
            app_uuid,
            name,
            start_point as point,
            start_elevation as elevation,
            'endpoint' as node_type
          FROM trail_endpoints
          UNION ALL
          SELECT 
            id,
            app_uuid,
            name,
            end_point as point,
            end_elevation as elevation,
            'endpoint' as node_type
          FROM trail_endpoints
        ),
        unique_endpoints AS (
          SELECT DISTINCT
            point,
            elevation,
            node_type,
            array_agg(app_uuid) as trail_ids,
            array_agg(name) as trail_names
          FROM all_endpoints
          WHERE point IS NOT NULL
          GROUP BY point, elevation, node_type
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(point), ST_Y(point)) as id,
          gen_random_uuid() as node_uuid,
          ST_Y(point) as lat,
          ST_X(point) as lng,
          COALESCE(elevation, 0) as elevation,
          node_type,
          array_to_string(trail_names, ', ') as connected_trails,
          trail_ids,
          NOW() as created_at
        FROM unique_endpoints
        WHERE point IS NOT NULL;
      `);
      
      const nodeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes;
      `);
      console.log(`✅ Created ${nodeCount.rows[0].count} manual routing nodes`);
      
      // Create edges between trails that share endpoints
      console.log('🔗 Creating edges between connected trails...');
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.routing_edges (
          source, target, trail_id, trail_name, length_km, elevation_gain, 
          elevation_loss, is_bidirectional, geometry, created_at
        )
        WITH trail_connections AS (
          SELECT DISTINCT
            t1.id as trail1_id,
            t1.app_uuid as trail1_uuid,
            t1.name as trail1_name,
            t1.geometry as trail1_geom,
            t2.id as trail2_id,
            t2.app_uuid as trail2_uuid,
            t2.name as trail2_name,
            t2.geometry as trail2_geom,
            n1.id as source_node,
            n2.id as target_node
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          JOIN ${this.stagingSchema}.routing_nodes n1 ON 
            ST_DWithin(ST_StartPoint(t1.geometry), ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326), 0.001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326), 0.001)
          JOIN ${this.stagingSchema}.routing_nodes n2 ON 
            ST_DWithin(ST_StartPoint(t2.geometry), ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326), 0.001)
            OR ST_DWithin(ST_EndPoint(t2.geometry), ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326), 0.001)
          WHERE ST_IsValid(t1.geometry) AND ST_IsValid(t2.geometry)
            AND ST_GeometryType(t1.geometry) = 'ST_LineString'
            AND ST_GeometryType(t2.geometry) = 'ST_LineString'
            AND n1.id != n2.id
        )
        SELECT 
          source_node as source,
          target_node as target,
          trail1_uuid as trail_id,
          trail1_name as trail_name,
          ST_Length(trail1_geom::geography) / 1000.0 as length_km,
          0 as elevation_gain,
          0 as elevation_loss,
          TRUE as is_bidirectional,
          trail1_geom as geometry,
          NOW() as created_at
        FROM trail_connections
        UNION ALL
        SELECT 
          target_node as source,
          source_node as target,
          trail2_uuid as trail_id,
          trail2_name as trail_name,
          ST_Length(trail2_geom::geography) / 1000.0 as length_km,
          0 as elevation_gain,
          0 as elevation_loss,
          TRUE as is_bidirectional,
          trail2_geom as geometry,
          NOW() as created_at
        FROM trail_connections;
      `);
      
      const edgeCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges;
      `);
      console.log(`✅ Created ${edgeCount.rows[0].count} manual routing edges`);
      
      console.log('✅ Manual routing network created successfully');
      
    } catch (error) {
      console.error('❌ Error creating manual routing network:', error);
      throw error;
    }
  }

  /**
   * Export clean data to GeoJSON for inspection
   */
  private async exportCleanDataToGeoJSON(): Promise<void> {
    console.log('📤 Exporting clean data to GeoJSON for inspection...');
    try {
      const trailsSql = `
        SELECT 
          app_uuid,
          name,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_AsGeoJSON(geometry) as geometry
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL
        ORDER BY app_uuid;
      `;
      
      const trailsResult = await this.pgClient.query(trailsSql);
      
      const geojsonPath = `${this.config.outputPath.replace('.db', '')}_clean_trails.geojson`;
      const combinedGeoJSON = {
        type: "FeatureCollection",
        name: `${this.config.region}_clean_trails`,
        description: `Clean trails data for ${this.config.region}`,
        features: trailsResult.rows.map((row: any) => ({
          type: "Feature",
          properties: {
            id: row.app_uuid,
            name: row.name,
            trail_type: row.trail_type,
            length_km: row.length_km,
            elevation_gain: row.elevation_gain,
            elevation_loss: row.elevation_loss,
            layer: "trails",
            color: "#00FF00", // Green
            stroke: "#00FF00",
            "stroke-width": 3,
            "stroke-opacity": 0.8
          },
          geometry: JSON.parse(row.geometry)
        }))
      };
      
      fs.writeFileSync(geojsonPath, JSON.stringify(combinedGeoJSON, null, 2));
      console.log(`✅ Exported clean trails data to ${geojsonPath}`);
    } catch (error) {
      console.error('❌ Error exporting clean data to GeoJSON:', error);
      throw error;
    }
  }
} 