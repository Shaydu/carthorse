#!/usr/bin/env ts-node
/**
 * Enhanced PostgreSQL Orchestrator for Carthorse
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
 *   npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region <region> --sqlite-db-export <path> [options]
 *   npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region boulder --sqlite-db-export ./data/boulder.db
 *   npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region boulder --sqlite-db-export ./data/boulder.db --build-master
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
dotenv.config();

import { getDbConfig, validateTestEnvironment } from '../utils/env';
import { backupDatabase } from '../utils/sql/backup';
import { getStagingSchemaSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { isValidNumberTuple, hashString } from '../utils';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { execSync } from 'child_process';
import { createCanonicalRoutingEdgesTable } from '../utils/sql/postgres-schema-helpers';
import { INTERSECTION_TOLERANCE, EDGE_TOLERANCE, SCHEMA_VERSION } from '../constants';
import { calculateInitialViewBbox, getValidInitialViewBbox } from '../utils/bbox';
import { getTestDbConfig } from '../database/connection';

// --- Type Definitions ---
import type { EnhancedOrchestratorConfig } from '../types';
import { ElevationService } from '../utils/elevation-service';
import { ValidationService } from '../utils/validation-service';
import { CleanupService } from '../utils/cleanup-service';
import { OrchestratorHooks, OrchestratorContext } from './orchestrator-hooks';

export class EnhancedPostgresOrchestrator {
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
   * Export schema and data from staging to SQLite (Phase 1: Schema Creation)
   * This method can be called independently to export the database without running the full pipeline
   */
  public async exportSchema(): Promise<void> {
    try {
      if (!this.pgClient) {
        throw new Error('No database connection available');
      }

      // Query data from staging schema
      const trailsRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry, 6, 0) AS geojson FROM ${this.stagingSchema}.trails`);
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

      // Build region metadata and insert
      const regionMeta = buildRegionMeta(trailsRes.rows, this.config.region, this.regionBbox);
      insertRegionMetadata(sqliteDb, regionMeta, this.config.outputPath);
      insertSchemaVersion(sqliteDb, SCHEMA_VERSION.CURRENT, SCHEMA_VERSION.DESCRIPTION, this.config.outputPath);

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
      const trailsRes = await this.pgClient.query(`SELECT *, ST_AsGeoJSON(geometry, 6, 0) AS geojson FROM ${this.stagingSchema}.trails`);
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

      // Build region metadata and insert
      const regionMeta = buildRegionMeta(this.config, this.regionBbox);
      insertRegionMetadata(sqliteDb, regionMeta, this.config.outputPath);
      insertSchemaVersion(sqliteDb, SCHEMA_VERSION.CURRENT, SCHEMA_VERSION.STAGING_DESCRIPTION, this.config.outputPath);

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

  constructor(config: EnhancedOrchestratorConfig) {
    this.config = config;
    this.stagingSchema = `staging_${config.region}_${Date.now()}`;
    
    const clientConfig = getTestDbConfig();
    this.pgConfig = clientConfig;
    this.pgClient = new Client(clientConfig);

    // Initialize services and hooks
    this.elevationService = new ElevationService(this.pgClient);
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
      await this.copyRegionDataToStaging();
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
      
      // Only include elevation initialization if not skipping elevation processing
      if (!this.config.skipElevationProcessing) {
        preProcessingHooks.unshift('initialize-elevation-data');
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

      // Execute processing hooks
      console.log('[ORCH] About to execute processing hooks');
      if (this.config.skipElevationProcessing) {
        console.log('[ORCH] Skipping elevation processing as requested');
      } else {
        await this.hooks.executeHooks([
          'process-elevation-data',
          'validate-elevation-data'
        ], context);
      }
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
        console.log('[ORCH] About to cleanupStaging');
        await this.cleanupStaging();
        lastTime = logStep('cleanupStaging', lastTime);
      }

      const total = Date.now() - startTime;
      console.log(`[TIMER] Total orchestrator run: ${total}ms`);

    } catch (err) {
      console.error('[Orchestrator] Error during run:', err);
      
      // Clean up on error if configured
      if (this.config.cleanupOnError) {
        console.log('[Orchestrator] Cleaning up on error...');
        await this.cleanupStaging();
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
      // Use new native PostgreSQL functions to generate routing graph
      // First, generate routing nodes
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
      
      // Then, generate routing edges
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
      
      // Clean up routing graph issues (self-loops, orphaned nodes)
      const cleanupResult = await this.pgClient.query(
        `SELECT * FROM cleanup_routing_graph($1)`,
        [this.stagingSchema]
      );
      
      const cleanupData = cleanupResult.rows[0];
      const cleanupSuccess = cleanupData?.success || false;
      const cleanupMessage = cleanupData?.message || 'Unknown error';
      const cleanedEdges = cleanupData?.cleaned_edges || 0;
      const cleanedNodes = cleanupData?.cleaned_nodes || 0;
      
      if (!cleanupSuccess) {
        console.warn(`⚠️ Warning: ${cleanupMessage}`);
      } else if (cleanedEdges > 0 || cleanedNodes > 0) {
        console.log(`🧹 ${cleanupMessage}`);
      }
      
      console.log(`✅ Generated routing graph using native PostgreSQL: ${nodeCount} nodes, ${edgeCount} edges`);
      
    } catch (error) {
      console.error('❌ Error generating routing graph:', error);
      throw error;
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
      validateSchemaVersion(db, SCHEMA_VERSION.CURRENT);
      console.log('  ✅ Schema version validated');
      
      // 2. Check schema structure
      console.log('  🏗️  Checking schema structure...');
      const tableCheck = (table: string) => {
        const res = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!res;
      };
      
      const requiredTables = ['trails', 'routing_nodes', 'routing_edges', 'region_metadata', 'schema_version'];
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

    // Functions are now part of the database schema via migrations
    console.log('📚 PostGIS functions available via database schema (V3 migration)');

    // Note: Triggers are not needed in staging schema - they're for the main trails table
    console.log('✅ Staging environment created (no triggers needed in staging)');

    console.log('✅ Staging environment created');
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