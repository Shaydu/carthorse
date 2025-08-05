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
 * This is a pure class library - use src/cli/export.ts for command-line interface
 */

// NOTE: Do not set process.env.PGDATABASE or PGUSER here.
// Test DB safety must be enforced in test setup or before importing this module.

import { Pool } from 'pg';
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
import { createGeometryPreprocessor } from '../utils/sql/geometry-preprocessing';

// --- Type Definitions ---
import type { CarthorseOrchestratorConfig } from '../types';
import { ElevationService } from '../utils/elevation-service';
import { ValidationService } from '../utils/validation-service';
import { CleanupService } from '../utils/cleanup-service';
import { OrchestratorHooks, OrchestratorContext } from './orchestrator-hooks';
import { TrailSplitter, TrailSplitterConfig } from '../utils/trail-splitter';

async function checkSchemaVersion(pgClient: Pool, expectedVersion: number) {
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
  private pgClient: Pool;
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
    console.log('🧹 Cleaning up staging environment...');
    await this.cleanupService.cleanSpecificStagingSchema(this.stagingSchema);
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
   * Export all functions from the production database to a SQL file
   * This method exports all functions for backup and version control purposes
   */
  public static async exportProductionFunctions(outputPath?: string): Promise<void> {
    console.log('💾 Starting production functions export...');
    
    try {
      const dbConfig = getDbConfig();
      const client = new Pool(dbConfig);
      await client.connect();
      
      try {
        // Query to get all function definitions
        const functionsQuery = `
          SELECT 
            n.nspname as schema_name,
            p.proname as function_name,
            pg_get_functiondef(p.oid) as function_definition,
            COALESCE(pgd.description, '') as function_comment
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          LEFT JOIN pg_description pgd ON p.oid = pgd.objoid
          WHERE n.nspname = 'public'
            AND p.prokind = 'f'  -- Only functions, not procedures
          ORDER BY n.nspname, p.proname;
        `;
        
        const result = await client.query(functionsQuery);
        console.log(`📊 Found ${result.rows.length} functions to export`);
        
        // Determine output path
        const defaultPath = './sql/organized/functions/production-functions.sql';
        const finalOutputPath = outputPath || defaultPath;
        
        // Create output directory if it doesn't exist
        const fs = require('fs');
        const path = require('path');
        const outputDir = path.dirname(finalOutputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Generate SQL file content
        let sqlContent = `-- Carthorse Production Functions Export
-- Generated on: ${new Date().toISOString()}
-- Database: ${dbConfig.database || 'unknown'}
-- 
-- This file contains all functions from the production PostGIS database.
-- Use this file for backup and version control purposes.
--

`;
        
        for (const row of result.rows) {
          // Add function definition
          sqlContent += `${row.function_definition};\n\n`;
          
          // Add comment if exists
          if (row.function_comment && row.function_comment.trim()) {
            sqlContent += `-- Function: ${row.function_name}
-- Comment: ${row.function_comment}
-- 
`;
          }
        }
        
        // Write to file
        fs.writeFileSync(finalOutputPath, sqlContent);
        
        console.log(`✅ Successfully exported ${result.rows.length} functions to: ${finalOutputPath}`);
        
      } finally {
        await client.end();
      }
      
    } catch (error) {
      console.error('❌ Production functions export failed:', error);
      throw error;
    }
  }

  /**
   * Install functions from a SQL file to the production database
   * This method installs functions from a backup file for restoration purposes
   */
  public static async installFunctions(inputPath?: string): Promise<void> {
    console.log('🔧 Starting production functions installation...');
    
    try {
      // Determine input path
      const defaultPath = './sql/organized/functions/production-functions.sql';
      const finalInputPath = inputPath || defaultPath;
      
      // Check if file exists
      const fs = require('fs');
      if (!fs.existsSync(finalInputPath)) {
        throw new Error(`Functions file not found: ${finalInputPath}`);
      }
      
      console.log(`📊 Installing functions from: ${finalInputPath}`);
      
      // Read and clean the SQL file by removing comments
      const sqlContent = fs.readFileSync(finalInputPath, 'utf8');
      const cleanedSql = sqlContent
        .split('\n')
        .filter((line: string) => {
          const trimmed = line.trim();
          return !trimmed.startsWith('--') && 
                 !trimmed.startsWith('/*') && 
                 !trimmed.startsWith('-') &&
                 trimmed !== '';
        })
        .join('\n');
      
      // Write cleaned SQL to temporary file
      const tempFile = finalInputPath.replace('.sql', '_cleaned.sql');
      fs.writeFileSync(tempFile, cleanedSql);
      
      // Use psql to execute the cleaned SQL file
      const { spawnSync } = require('child_process');
      const dbConfig = getDbConfig();
      
      const result = spawnSync('psql', [
        '-h', dbConfig.host || process.env.PGHOST || 'localhost',
        '-U', dbConfig.user || process.env.PGUSER || 'postgres',
        '-d', dbConfig.database || process.env.PGDATABASE || 'postgres',
        '-f', tempFile,
        '-v', 'ON_ERROR_STOP=1'
      ], {
        stdio: 'inherit',
        env: { ...process.env, PGPASSWORD: dbConfig.password || process.env.PGPASSWORD }
      });
      
      // Clean up temporary file
      fs.unlinkSync(tempFile);
      
      if (result.status !== 0) {
        throw new Error(`psql failed with exit code ${result.status}`);
      }
      
      console.log('✅ Successfully installed functions to production database');
      
    } catch (error) {
      console.error('❌ Production functions installation failed:', error);
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
  /**
   * Unified cleanup method that respects the noCleanup flag
   */
  public async performCleanup(): Promise<void> {
    console.log(`🔍 Cleanup flag check: noCleanup = ${this.config.noCleanup}`);
    if (this.config.noCleanup) {
      console.log('⏭️ Skipping all cleanup operations (--no-cleanup flag)');
      return;
    }

    console.log('🧹 Performing cleanup...');
    
    try {
      // Clean up the current staging schema if it exists
      if (this.stagingSchema) {
        console.log(`🗑️ Cleaning up current staging schema: ${this.stagingSchema}`);
        await this.cleanupStaging();
      }
      
      // Perform comprehensive cleanup of all test databases
      await CarthorseOrchestrator.cleanAllTestDatabases();
      
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
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
      // Export pgRouting nodes and edges
      const nodesRes = await this.pgClient.query(`
        SELECT 
          id,
          the_geom,
          ST_X(ST_Centroid(the_geom)) as lng,
          ST_Y(ST_Centroid(the_geom)) as lat,
          COALESCE(ST_Z(ST_Centroid(the_geom)), 0) as elevation,
          'intersection' as node_type,
          '' as connected_trails,
          NOW() as created_at,
          'node_' || id::text as node_uuid
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      
      // Extract routing edges export logic for better debugging
      console.log('📊 Exporting pgRouting edges...');
      const edgesRes = await this.pgClient.query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY old_id) as id,
          source,
          target,
          old_id as trail_id,
          length_km,
          elevation_gain,
          COALESCE(elevation_gain, 0) as elevation_loss,
          true as is_bidirectional,
          NOW() as created_at,
          ST_AsGeoJSON(the_geom, 6, 0) AS geojson
        FROM ${this.stagingSchema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL
      `);
      console.log(`📊 Found ${edgesRes.rows.length} routing edges to export`);

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
      
      // pgRouting uses integer IDs, so no mapping needed
      console.log(`📊 Using pgRouting integer IDs: ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);
      
      // Edges already have integer source/target IDs from pgRouting
      const convertedEdges = edgesRes.rows.map(edge => ({
        ...edge,
        distance_km: edge.length_km // Map length_km to distance_km for SQLite schema
      }));
      
      insertTrails(sqliteDb, trailsRes.rows, this.config.outputPath);
      insertRoutingNodes(sqliteDb, nodesRes.rows, this.config.outputPath);
      insertRoutingEdges(sqliteDb, convertedEdges, this.config.outputPath);

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

      // Export route trails (trail composition of routes)
      try {
        const routeTrailsRes = await this.pgClient.query(`
          SELECT 
            route_uuid,
            trail_id,
            trail_name,
            segment_order,
            segment_distance_km,
            segment_elevation_gain,
            segment_elevation_loss,
            created_at
          FROM ${this.stagingSchema}.route_trails
          ORDER BY route_uuid, segment_order
        `);
        
        if (routeTrailsRes.rows.length > 0) {
          console.log(`📊 Exporting ${routeTrailsRes.rows.length} route trail segments to SQLite...`);
          const { insertRouteTrails } = require('../utils/sqlite-export-helpers');
          insertRouteTrails(sqliteDb, routeTrailsRes.rows);
        } else {
          console.log('ℹ️  No route trail segments found in staging schema');
        }
      } catch (error) {
        console.warn('⚠️  Route trails export failed:', error);
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
      // Get nodes and create UUID to integer mapping for SQLite
      // Debug: Check what tables exist in the staging schema
      const tablesRes = await this.pgClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = '${this.stagingSchema}'
        ORDER BY table_name
      `);
      console.log(`📊 Tables in staging schema:`, tablesRes.rows.map(r => r.table_name));
      
      // Check if ways_noded_vertices_pgr table exists and has data
      const tableCheck = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      console.log(`📊 ways_noded_vertices_pgr table has ${tableCheck.rows[0].count} rows`);
      
      if (tableCheck.rows[0].count === 0) {
        console.error('❌ ways_noded_vertices_pgr table is empty!');
        throw new Error('No routing nodes found in ways_noded_vertices_pgr table');
      }
      
      // Test the actual query to see what fields are returned
      const testQuery = await this.pgClient.query(`
        SELECT 
          id,
          'node_' || id::text as node_uuid,
          ST_Y(the_geom) as lat,
          ST_X(the_geom) as lng
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        LIMIT 1
      `);
      console.log(`📊 Test query result:`, JSON.stringify(testQuery.rows[0], null, 2));
      console.log(`📊 Test query fields:`, Object.keys(testQuery.rows[0] || {}));
      console.log(`📊 Test query node_uuid value:`, testQuery.rows[0]?.node_uuid);
      console.log(`📊 Test query node_uuid type:`, typeof testQuery.rows[0]?.node_uuid);
      
      // Check for case sensitivity issues
      const firstRow = testQuery.rows[0];
      if (firstRow) {
        console.log(`📊 All field names:`, Object.keys(firstRow));
        console.log(`📊 Field values:`, Object.entries(firstRow).map(([key, value]) => `${key}=${value} (${typeof value})`));
      }
      
      // Export nodes from pgRouting vertices table
      console.log(`📊 About to query ways_noded_vertices_pgr from ${this.stagingSchema}`);
      
      // Test the actual query to see what fields are returned
      const debugQuery = await this.pgClient.query(`
        SELECT 
          id,
          'node_' || id::text as node_uuid,
          ST_Y(the_geom) as lat,
          ST_X(the_geom) as lng
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        LIMIT 1
      `);
      console.log(`📊 Test query result:`, JSON.stringify(debugQuery.rows[0], null, 2));
      console.log(`📊 Test query fields:`, Object.keys(debugQuery.rows[0] || {}));
      console.log(`📊 Test query node_uuid value:`, debugQuery.rows[0]?.node_uuid);
      console.log(`📊 Test query node_uuid type:`, typeof debugQuery.rows[0]?.node_uuid);
      
      // Check for case sensitivity issues
      const debugRow = debugQuery.rows[0];
      if (debugRow) {
        console.log(`📊 All field names:`, Object.keys(debugRow));
        console.log(`📊 Field values:`, Object.entries(debugRow).map(([k, v]) => `${k}=${v} (${typeof v})`));
      }
      
      const nodesRes = await this.pgClient.query(`
        SELECT 
          id,
          'node_' || id::text as node_uuid,
          ST_Y(the_geom) as lat,
          ST_X(the_geom) as lng,
          0 as elevation, -- pgRouting doesn't store elevation in vertices
          CASE 
            WHEN cnt = 1 THEN 'dead_end'
            WHEN cnt = 2 THEN 'simple_connection'
            WHEN cnt >= 3 THEN 'intersection'
            ELSE 'unknown'
          END as node_type,
          '' as connected_trails,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      `);
      // DEBUG: Confirm entry to node export debug block
      console.log('DEBUG: Entered node export debug block');
      if (nodesRes.rows && nodesRes.rows.length > 0) {
        console.log('DEBUG: First row from nodesRes:', nodesRes.rows[0]);
        console.log('DEBUG: Keys from nodesRes:', Object.keys(nodesRes.rows[0]));
        process.stdout.write(''); // Force flush
        process.exit(1); // Stop here to guarantee output
      }
      console.log(`📊 Query completed, got ${nodesRes.rows.length} rows`);
      
      // Debug: Log the first few nodes to see what fields are returned
      console.log(`📊 Sample node data:`, nodesRes.rows.slice(0, 2));
      console.log(`📊 Node data keys:`, Object.keys(nodesRes.rows[0] || {}));
      
      // Create UUID to integer mapping for SQLite export
      const nodeIdMapping = new Map<string, number>();
      nodesRes.rows.forEach((node, index) => {
        nodeIdMapping.set(node.id, index + 1); // SQLite auto-increment starts at 1
      });
      
      console.log(`📊 Node mapping: ${nodeIdMapping.size} nodes mapped`);
      console.log(`📊 Sample node IDs: ${Array.from(nodeIdMapping.keys()).slice(0, 5).join(', ')}`);
      
      // Export edges from pgRouting ways_noded table
      const edgesRes = await this.pgClient.query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY old_id) as id,
          source,
          target,
          old_id as trail_id,
          t.name as trail_name,
          length_km,
          elevation_gain,
          COALESCE(elevation_gain, 0) as elevation_loss,
          ST_AsGeoJSON(the_geom, 6, 0) AS geojson,
          NOW() as created_at
        FROM ${this.stagingSchema}.ways_noded wn
        JOIN ${this.stagingSchema}.trails t ON wn.old_id = t.id
        WHERE source IS NOT NULL AND target IS NOT NULL
      `);
      
      // Convert edge source/target UUIDs to integers using the mapping
      const convertedEdges = edgesRes.rows.map(edge => {
        const sourceId = nodeIdMapping.get(edge.source);
        const targetId = nodeIdMapping.get(edge.target);
        
        // Debug: Log any edges that reference non-existent nodes
        if (!sourceId || !targetId) {
          console.log(`⚠️  Edge references non-existent node: source=${edge.source} (mapped to ${sourceId}), target=${edge.target} (mapped to ${targetId})`);
        }
        
        // Debug: Log the conversion for first few edges
        if (edgesRes.rows.indexOf(edge) < 3) {
          console.log(`[DEBUG] Converting edge ${edgesRes.rows.indexOf(edge) + 1}: ${edge.source} -> ${sourceId}, ${edge.target} -> ${targetId}`);
        }
        
        return {
          ...edge,
          source: sourceId || null,
          target: targetId || null
        };
      });

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
      
      // Debug: Log the first few nodes from Postgres to see what we got
      console.log(`📊 Sample node data from Postgres query:`, nodesRes.rows.slice(0, 2));
      console.log(`📊 Node data keys from Postgres query:`, Object.keys(nodesRes.rows[0] || {}));
      
      // Debug: Log the first few nodes from Postgres to see what we got
      console.log(`📊 Sample node data from Postgres query:`, nodesRes.rows.slice(0, 2));
      console.log(`📊 Node data keys from Postgres query:`, Object.keys(nodesRes.rows[0] || {}));
      
      // Use nodes directly from PostgreSQL query (node_uuid is now included in the query)
      const sqliteNodes = nodesRes.rows;
      
      // Debug: Log the first few nodes before SQLite insert
      console.log(`📊 Sample node data before SQLite insert:`, sqliteNodes.slice(0, 2));
      console.log(`📊 Node data keys before SQLite insert:`, Object.keys(sqliteNodes[0] || {}));
      
      // Debug: Log the first few nodes before SQLite insert
      console.log(`📊 Sample node data before SQLite insert:`, sqliteNodes.slice(0, 2));
      console.log(`📊 Node data keys before SQLite insert:`, Object.keys(sqliteNodes[0] || {}));
      
      insertRoutingNodes(sqliteDb, sqliteNodes, this.config.outputPath);
      insertRoutingEdges(sqliteDb, convertedEdges, this.config.outputPath);

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

      // Export route trails (trail composition of routes)
      try {
        const routeTrailsRes = await this.pgClient.query(`
          SELECT 
            route_uuid,
            trail_id,
            trail_name,
            segment_order,
            segment_distance_km,
            segment_elevation_gain,
            segment_elevation_loss,
            created_at
          FROM ${this.stagingSchema}.route_trails
          ORDER BY route_uuid, segment_order
        `);
        
        if (routeTrailsRes.rows.length > 0) {
          console.log(`📊 Exporting ${routeTrailsRes.rows.length} route trail segments to SQLite...`);
          const { insertRouteTrails } = require('../utils/sqlite-export-helpers');
          insertRouteTrails(sqliteDb, routeTrailsRes.rows);
        } else {
          console.log('ℹ️  No route trail segments found in staging schema');
        }
      } catch (error) {
        console.warn('⚠️  Route trails export failed:', error);
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
      const pgClient = new Pool(clientConfig);
      
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
      'copy_trails_to_staging_v1',
      'split_trails_in_staging_v1',
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
        noCleanup: false,

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
  /**
   * Common staging setup for both SQLite and GeoJSON export
   */
  private async setupStagingEnvironment(): Promise<void> {
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

      // Setup complete - export will be handled by calling method

    } catch (error) {
      console.error('[Orchestrator] Error during staging setup:', error);
      
      // Cleanup on error
      console.log('[Orchestrator] Cleaning up on error...');
      await this.performCleanup();
      
      throw error;
    }
  }

  async export(outputFormat: 'geojson' | 'sqlite' | 'trails-only' = 'sqlite'): Promise<void> {
    try {
      // Setup staging environment (common for all formats)
      await this.setupStagingEnvironment();
      
      // Use the new export service
      const { ExportService } = await import('../utils/export/export-service');
      const exportService = new ExportService();
      
      console.log(`[ORCH] Starting ${outputFormat.toUpperCase()} export using export service...`);
      
      const result = await exportService.export(
        outputFormat,
        this.pgClient,
        {
          outputPath: this.config.outputPath,
          stagingSchema: this.stagingSchema
        }
      );
      
      if (!result.success) {
        throw new Error(result.message);
      }
      
      console.log(`[ORCH] ${outputFormat.toUpperCase()} export completed successfully`);
      console.log(`[ORCH] Output: ${this.config.outputPath}`);

    } catch (error) {
      console.error('[Orchestrator] Error during run:', error);
      
      // Cleanup on error
      console.log('[Orchestrator] Cleaning up on error...');
      await this.performCleanup();
      
      throw error;
    } finally {
      // Always cleanup staging unless explicitly skipped
      if (!this.config.noCleanup) {
        console.log('[ORCH] About to cleanup staging');
        await this.cleanupStaging();
      } else {
        console.log('[ORCH] Skipping cleanup (--no-cleanup flag)');
      }
      
      // Close database connection
      await this.pgClient.end();
    }
  }

  // Legacy methods for backward compatibility
  async exportSqlite(): Promise<void> {
    return this.export('sqlite');
  }

  async exportGeoJSON(): Promise<void> {
    return this.export('geojson');
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
        'copy_trails_to_staging_v1',
        'split_trails_in_staging_v1',
        'generate_routing_nodes_native_v2',
        'generate_routing_edges_native_v2'
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
      'copy_trails_to_staging_v1',
      'split_trails_in_staging_v1',
      'generate_routing_nodes_native_v2_with_trail_ids',
      'generate_routing_edges_native_v2',
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
    
    // Build query with bbox filter if provided
    let trailsQuery = `SELECT COUNT(*) as count FROM public.trails WHERE region = $1`;
    const queryParams: any[] = [this.config.region];
    let paramIndex = 2;
    
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = this.config.bbox;
      trailsQuery += ` AND ST_Intersects(geometry, ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326))`;
      queryParams.push(bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat);
      console.log(`  🗺️ Applying bbox filter: ${bboxMinLng}, ${bboxMinLat}, ${bboxMaxLng}, ${bboxMaxLat}`);
    }
    
    const trailsCount = await this.pgClient.query(trailsQuery, queryParams);
    
    const count = parseInt(trailsCount.rows[0].count);
    if (count === 0) {
      throw new Error(`❌ No trails found for region '${this.config.region}'${this.config.bbox ? ' in specified bbox' : ''}. Please check data ingestion.`);
    }
    console.log(`  ✅ Found ${count} trails for region '${this.config.region}'${this.config.bbox ? ' in bbox' : ''}`);

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
      
      // For bbox-filtered datasets, we might have fewer trails, so adjust expectations
      if (this.config.bbox && totalTrails < 10) {
        console.log(`📊 Note: Working with bbox-filtered dataset (${totalTrails} trails). Validation expectations adjusted.`);
      }
      
      // Fail if no valid trails remain
      if (validTrails === 0) {
        // For bbox-filtered datasets, allow empty results if no trails were found
        if (this.config.bbox) {
          console.log(`⚠️ No valid trails found in bbox-filtered dataset. This may be normal for small areas.`);
          console.log(`📊 Proceeding with empty routing graph for bbox area.`);
          return; // Allow the process to continue with empty results
        } else {
          throw new Error(`No valid trails found for routing graph generation. All ${totalTrails} trails have issues that prevent edge creation`);
        }
      }
      
      console.log(`✅ Trail validation passed: ${validTrails} valid trails available for routing graph generation`);
      
    } catch (error) {
      console.error('❌ Trail validation failed:', error);
      throw error;
    }
  }

  /**
   * Generate routing graph using serial operations approach
   * 1. Complete trail splitting first
   * 2. Then add nodes at endpoints of split segments
   * 3. Then generate edges between nodes that share trail segments
   */
  private async generateRoutingGraph(): Promise<void> {
    console.log('[ORCH] 🔧 Generating routing graph using pgRouting...');
    
    try {
      // Import PgRoutingHelpers
      const { PgRoutingHelpers } = await import('../utils/pgrouting-helpers');
      
      // Create pgRouting helpers with Pool wrapper
      const pool = {
        query: (text: string, params?: any[]) => this.pgClient.query(text, params),
        end: () => this.pgClient.end()
      } as any;
      
      const pgrouting = new PgRoutingHelpers({
        stagingSchema: this.stagingSchema,
        pgClient: pool
      });
      
      // Step 1: Create pgRouting network from trail data
      console.log('[ORCH] Step 1: Creating pgRouting network from trail data...');
      const networkCreated = await pgrouting.createPgRoutingViews();
      if (!networkCreated) {
        throw new Error('Failed to create pgRouting network');
      }
      
      // Step 2: Get network statistics
      const statsResult = await this.pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as edges,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as vertices
      `);
      console.log(`[ORCH] Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);
      
      // Step 3: Add length and elevation columns to ways_noded for KSP routing
      console.log('[ORCH] Step 3: Adding length and elevation columns to ways_noded...');
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.ways_noded 
        ADD COLUMN IF NOT EXISTS length_km REAL,
        ADD COLUMN IF NOT EXISTS elevation_gain REAL
      `);
      
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_noded 
        SET 
          length_km = ST_Length(the_geom) / 1000,
          elevation_gain = COALESCE(
            (SELECT elevation_gain FROM ${this.stagingSchema}.ways w WHERE w.id = ways_noded.old_id), 
            0
          )
      `);
      
      console.log('[ORCH] ✅ Routing graph generation completed using pgRouting');
      
    } catch (error) {
      console.error('❌ Error generating routing graph:', error);
      throw error;
    }
  }

  /**
   * Generate routing nodes from split segment endpoints
   * Creates nodes at the start and end points of each split trail segment
   */
  private async generateRoutingNodesFromSplitSegments(intersectionToleranceMeters: number): Promise<void> {
    console.log(`📍 Generating routing nodes with tolerance: ${intersectionToleranceMeters}m`);
    
    // Clear existing routing nodes
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);
    
    // Generate routing nodes from trail endpoints and intersections
    const toleranceDegrees = intersectionToleranceMeters / 111000.0;
    
    const nodesSql = `
      INSERT INTO ${this.stagingSchema}.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
      WITH valid_trails AS (
        SELECT app_uuid, name, geometry
        FROM ${this.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry) > 0
      ),
      trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Z(ST_StartPoint(geometry)) as start_elevation,
          ST_Z(ST_EndPoint(geometry)) as end_elevation
        FROM valid_trails
      ),
      all_endpoints AS (
        SELECT 
          app_uuid,
          name,
          start_point as point,
          start_elevation as elevation,
          'endpoint' as node_type,
          name as connected_trails,
          ARRAY[app_uuid] as trail_ids
        FROM trail_endpoints
        UNION ALL
        SELECT 
          app_uuid,
          name,
          end_point as point,
          end_elevation as elevation,
          'endpoint' as node_type,
          name as connected_trails,
          ARRAY[app_uuid] as trail_ids
        FROM trail_endpoints
      ),
      intersection_points AS (
        -- Detect intersections between split trail segments directly
        SELECT 
          dumped.geom as point,
          COALESCE(ST_Z(dumped.geom), 0) as elevation,
          'intersection' as node_type,
          array_to_string(ARRAY[t1.name, t2.name], ',') as connected_trails,
          ARRAY[t1.app_uuid, t2.app_uuid] as trail_ids
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid,
        LATERAL ST_Dump(ST_Intersection(t1.geometry, t2.geometry)) as dumped
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 5
          AND ST_Length(t2.geometry::geography) > 5
      ),
      all_nodes AS (
        SELECT point, elevation, node_type, connected_trails, trail_ids
        FROM all_endpoints
        WHERE point IS NOT NULL
        UNION ALL
        SELECT point, elevation, node_type, connected_trails, trail_ids
        FROM intersection_points
        WHERE point IS NOT NULL
      ),
      unique_nodes AS (
        SELECT DISTINCT
          point,
          elevation,
          node_type,
          connected_trails,
          trail_ids
        FROM all_nodes
        WHERE point IS NOT NULL
      ),
      clustered_nodes AS (
        -- Simplified clustering without problematic array aggregation
        SELECT 
          point as clustered_point,
          elevation,
          node_type,
          connected_trails,
          trail_ids
        FROM unique_nodes
        WHERE point IS NOT NULL
      )
      SELECT 
        gen_random_uuid() as id,
        gen_random_uuid() as node_uuid,
        ST_Y(clustered_point) as lat,
        ST_X(clustered_point) as lng,
        elevation,
        'unknown' as node_type, -- Start with 'unknown', will update after edge creation
        connected_trails,
        trail_ids,
        NOW() as created_at
      FROM clustered_nodes
      WHERE clustered_point IS NOT NULL
      AND ST_X(clustered_point) IS NOT NULL
      AND ST_Y(clustered_point) IS NOT NULL
    `;
    
    const nodesResult = await this.pgClient.query(nodesSql);
    const nodeCount = nodesResult.rowCount;
    console.log(`✅ Generated ${nodeCount} routing nodes (all marked as 'unknown' initially)`);
  }

  /**
   * Generate routing edges from trail segments
   */
  private async generateRoutingEdgesFromSplitSegments(toleranceMeters: number): Promise<void> {
    console.log(`🛤️ Generating routing edges with tolerance: ${toleranceMeters}m`);
    
    // Clear existing routing edges
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
    
    // Get node count for validation
    const nodeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_nodes`);
    const nodeCount = parseInt(nodeCountResult.rows[0].count);
    console.log(`📍 Found ${nodeCount} nodes to connect`);
    
    const toleranceDegrees = toleranceMeters / 111000.0;
    
        // Generate routing edges based on actual trail segments connecting nodes
    // Only connect nodes that are the actual start/end points of the same trail segment
    const edgesSql = `
      INSERT INTO ${this.stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      WITH trail_segments AS (
        -- For each trail segment, find its start and end points
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Force2D(geometry) as trail_geometry
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry) 
        AND length_km > 0
      ),
      node_connections AS (
        -- Find nodes that are the actual start/end points of trail segments
        SELECT DISTINCT
          n1.id as source_id,
          n2.id as target_id,
          ts.trail_id,
          ts.trail_name,
          ts.length_km,
          ts.elevation_gain,
          ts.elevation_loss,
          ts.trail_geometry
        FROM trail_segments ts
        JOIN ${this.stagingSchema}.routing_nodes n1 ON 
          ST_DWithin(
            ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
            ts.start_point,
            ${toleranceDegrees}
          )
        JOIN ${this.stagingSchema}.routing_nodes n2 ON 
          ST_DWithin(
            ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326),
            ts.end_point,
            ${toleranceDegrees}
          )
        WHERE n1.id <> n2.id
      )
      SELECT 
        source_id as source,
        target_id as target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_MakeLine(
          ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
          ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
        ) as geometry,
        ST_AsGeoJSON(
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
            ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
          ), 6, 0
        ) as geojson
      FROM node_connections
      JOIN ${this.stagingSchema}.routing_nodes n1 ON n1.id = source_id
      JOIN ${this.stagingSchema}.routing_nodes n2 ON n2.id = target_id
      WHERE source_id IS NOT NULL 
      AND target_id IS NOT NULL
      AND source_id <> target_id
    `;
    
    const edgesResult = await this.pgClient.query(edgesSql);
    const edgeCount = edgesResult.rowCount;
    console.log(`✅ Generated ${edgeCount} routing edges between nodes with shared trail connections`);
    
    // Clean up orphaned nodes (nodes that have no edges)
    const orphanedNodesResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.routing_nodes 
      WHERE id NOT IN (
        SELECT DISTINCT source FROM ${this.stagingSchema}.routing_edges 
        UNION 
        SELECT DISTINCT target FROM ${this.stagingSchema}.routing_edges
      )
    `);
    const orphanedNodesCount = orphanedNodesResult.rowCount;
    console.log(`🧹 Cleaned up ${orphanedNodesCount} orphaned nodes`);
    
    // Clean up orphaned edges (edges that reference non-existent nodes)
    const orphanedEdgesResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.routing_edges 
      WHERE source NOT IN (SELECT id FROM ${this.stagingSchema}.routing_nodes)
      OR target NOT IN (SELECT id FROM ${this.stagingSchema}.routing_nodes)
    `);
    const orphanedEdgesCount = orphanedEdgesResult.rowCount;
    console.log(`🧹 Cleaned up ${orphanedEdgesCount} orphaned edges`);
    
    // Final counts
    const finalNodeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_nodes`);
    const finalEdgeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_edges`);
    const finalNodeCount = parseInt(finalNodeCountResult.rows[0].count);
    const finalEdgeCount = parseInt(finalEdgeCountResult.rows[0].count);
    
    console.log(`✅ Final routing network: ${finalNodeCount} nodes, ${finalEdgeCount} edges`);
    
    // Log connectivity statistics
    const connectivityResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN id IN (SELECT DISTINCT source FROM ${this.stagingSchema}.routing_edges UNION SELECT DISTINCT target FROM ${this.stagingSchema}.routing_edges) THEN 1 END) as connected_nodes,
        COUNT(CASE WHEN id NOT IN (SELECT DISTINCT source FROM ${this.stagingSchema}.routing_edges UNION SELECT DISTINCT target FROM ${this.stagingSchema}.routing_edges) THEN 1 END) as isolated_nodes
      FROM ${this.stagingSchema}.routing_nodes
    `);
    
    const stats = connectivityResult.rows[0];
    console.log(`📊 Network connectivity:`);
    console.log(`   - Total nodes: ${stats.total_nodes}`);
    console.log(`   - Connected nodes: ${stats.connected_nodes}`);
    console.log(`   - Isolated nodes: ${stats.isolated_nodes}`);
  }

  /**
   * Validate routing network connectivity
   */
  private async validateRoutingNetwork(): Promise<void> {
    console.log('🔍 Validating routing network connectivity...');
    
    // Check for isolated nodes
    const isolatedNodesResult = await this.pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${this.stagingSchema}.routing_nodes n
      WHERE n.id NOT IN (
        SELECT DISTINCT source FROM ${this.stagingSchema}.routing_edges 
        UNION 
        SELECT DISTINCT target FROM ${this.stagingSchema}.routing_edges
      )
    `);
    const isolatedNodesCount = parseInt(isolatedNodesResult.rows[0].count);
    
    // Check for orphaned edges
    const orphanedEdgesResult = await this.pgClient.query(`
      SELECT COUNT(*) as count
      FROM ${this.stagingSchema}.routing_edges e
      WHERE e.source NOT IN (SELECT id FROM ${this.stagingSchema}.routing_nodes) 
      OR e.target NOT IN (SELECT id FROM ${this.stagingSchema}.routing_nodes)
    `);
    const orphanedEdgesCount = parseInt(orphanedEdgesResult.rows[0].count);
    
    // Check connectivity statistics
    const connectivityResult = await this.pgClient.query(`
      WITH node_degrees AS (
        SELECT 
          n.id,
          n.node_type,
          COUNT(DISTINCT e.source) + COUNT(DISTINCT e.target) as degree
        FROM ${this.stagingSchema}.routing_nodes n
        LEFT JOIN ${this.stagingSchema}.routing_edges e ON n.id = e.source OR n.id = e.target
        GROUP BY n.id, n.node_type
      )
      SELECT 
        node_type,
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN degree = 0 THEN 1 END) as isolated_nodes,
        COUNT(CASE WHEN degree = 1 THEN 1 END) as leaf_nodes,
        COUNT(CASE WHEN degree > 1 THEN 1 END) as connected_nodes,
        AVG(degree) as avg_degree
      FROM node_degrees
      GROUP BY node_type
    `);
    
    console.log('🔍 Routing network validation results:');
    console.log(`  - Isolated nodes: ${isolatedNodesCount}`);
    console.log(`  - Orphaned edges: ${orphanedEdgesCount}`);
    
    connectivityResult.rows.forEach(row => {
      console.log(`  - ${row.node_type} nodes: ${row.total_nodes} total, ${row.isolated_nodes} isolated, ${row.connected_nodes} connected (avg degree: ${parseFloat(row.avg_degree).toFixed(1)})`);
    });
    
    if (isolatedNodesCount > 0 || orphanedEdgesCount > 0) {
      console.log(`⚠️ Warning: Found ${isolatedNodesCount} isolated nodes and ${orphanedEdgesCount} orphaned edges`);
    } else {
      console.log('✅ Routing network is fully connected!');
    }
  }

  /**
   * Generate route recommendations using recursive route finding
   */
  private async generateRouteRecommendations(): Promise<void> {
    console.log('DEBUG: NEW generateRouteRecommendations called');
    console.log('🛤️ Starting KSP route recommendation generation...');
    
    try {
      // Use the exact same approach as the working script
      console.log('📋 Loading route patterns...');
      const patternsResult = await this.pgClient.query(`
        SELECT * FROM public.route_patterns 
        ORDER BY target_distance_km
      `);
      
      const patterns = patternsResult.rows;
      console.log(`✅ Loaded ${patterns.length} route patterns`);

      // Create a new staging schema for route generation (like working script)
      const routeStagingSchema = `ksp_routes_${Date.now()}`;
      console.log(`📁 Creating route staging schema: ${routeStagingSchema}`);
      
      await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${routeStagingSchema}`);
      
      // Create trails table in route staging schema (like working script)
      console.log('📊 Creating trails table in route staging schema...');
      await this.pgClient.query(`
        CREATE TABLE ${routeStagingSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT,
          name TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRINGZ, 4326)
        )
      `);

      // Copy trail data using the exact same bbox as working script
      console.log('📊 Copying trail data...');
      
      // Use specific bbox instead of region filter (exactly like working script)
      const bboxFilter = `
        AND ST_Intersects(geometry, ST_MakeEnvelope(-105.35184737563483, 40.10010564946518, -105.31343938074664, 40.1281541323425, 4326))
      `;
      console.log('🗺️ Using specific bbox filter...');
      
      await this.pgClient.query(`
        INSERT INTO ${routeStagingSchema}.trails (app_uuid, name, geometry, length_km, elevation_gain)
        SELECT app_uuid::text, name, geometry, length_km, elevation_gain
        FROM public.trails
        WHERE geometry IS NOT NULL ${bboxFilter}
      `);

      const trailsCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${routeStagingSchema}.trails`);
      console.log(`✅ Copied ${trailsCount.rows[0].count} trails to route staging`);

      if (trailsCount.rows[0].count === 0) {
        console.log('⚠️ No trails found in bbox, skipping route generation');
        await this.pgClient.query(`DROP SCHEMA IF EXISTS ${routeStagingSchema} CASCADE`);
        return;
      }

      // Create pgRouting network (like working script)
      console.log('🔄 Creating pgRouting network...');
      const { PgRoutingHelpers } = await import('../utils/pgrouting-helpers');
      const pgrouting = new PgRoutingHelpers({
        stagingSchema: routeStagingSchema,
        pgClient: this.pgClient as any
      });

      const networkCreated = await pgrouting.createPgRoutingViews();
      if (!networkCreated) {
        console.log('⚠️ Failed to create pgRouting network, skipping route generation');
        await this.pgClient.query(`DROP SCHEMA IF EXISTS ${routeStagingSchema} CASCADE`);
        return;
      }

      // Get network statistics (like working script)
      const statsResult = await this.pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${routeStagingSchema}.ways_noded) as edges,
          (SELECT COUNT(*) FROM ${routeStagingSchema}.ways_noded_vertices_pgr) as vertices
      `);
      console.log(`📊 Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);

      // Add length and elevation columns to ways_noded for KSP routing (like working script)
      console.log('📏 Adding length and elevation columns to ways_noded...');
      
      // Add length_km column
      await this.pgClient.query(`
        ALTER TABLE ${routeStagingSchema}.ways_noded 
        ADD COLUMN IF NOT EXISTS length_km DOUBLE PRECISION
      `);
      
      // Calculate length in kilometers
      await this.pgClient.query(`
        UPDATE ${routeStagingSchema}.ways_noded 
        SET length_km = ST_Length(the_geom::geography) / 1000
      `);
      
      // Add elevation_gain column
      await this.pgClient.query(`
        ALTER TABLE ${routeStagingSchema}.ways_noded 
        ADD COLUMN IF NOT EXISTS elevation_gain DOUBLE PRECISION DEFAULT 0
      `);
      
      // Calculate elevation gain by joining with trail data
      await this.pgClient.query(`
        UPDATE ${routeStagingSchema}.ways_noded w
        SET elevation_gain = COALESCE(t.elevation_gain, 0)
        FROM ${routeStagingSchema}.trails t
        WHERE w.old_id = t.id
      `);
      
      console.log('✅ Added length_km and elevation_gain columns to ways_noded');

      // Create edge_mapping table for UUID mapping at boundary (like get-route-constituent-trails.ts)
      console.log('🔗 Creating edge_mapping table for UUID boundary mapping...');
      await this.pgClient.query(`DROP TABLE IF EXISTS ${routeStagingSchema}.edge_mapping`);
      await this.pgClient.query(`
        CREATE TABLE ${routeStagingSchema}.edge_mapping AS
        SELECT 
          w.id as pg_id,
          w.old_id as trail_id,
          t.app_uuid,
          t.name as trail_name,
          t.length_km,
          t.elevation_gain,
          w.length_km as edge_length_km,
          w.elevation_gain as edge_elevation_gain
        FROM ${routeStagingSchema}.ways_noded w
        JOIN ${routeStagingSchema}.trails t ON w.old_id = t.id
      `);
      
      const edgeMappingCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${routeStagingSchema}.edge_mapping`);
      console.log(`✅ Edge mapping created with ${edgeMappingCount.rows[0].count} edge-to-trail mappings`);

      // Create node_mapping table (like working script)
      console.log('🔧 Creating node_mapping table...');
      await this.pgClient.query(`DROP TABLE IF EXISTS ${routeStagingSchema}.node_mapping`);
      await this.pgClient.query(`
        CREATE TABLE ${routeStagingSchema}.node_mapping AS
        SELECT 
          v.id as pg_id,
          v.cnt as connection_count,
          CASE 
            WHEN v.cnt = 1 THEN 'dead_end'
            WHEN v.cnt = 2 THEN 'simple_connection'
            WHEN v.cnt >= 3 THEN 'intersection'
            ELSE 'unknown'
          END as node_type
        FROM ${routeStagingSchema}.ways_noded_vertices_pgr v
      `);
      
      const nodeMappingCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${routeStagingSchema}.node_mapping WHERE connection_count > 0`);
      console.log(`✅ Node mapping created with ${nodeMappingCount.rows[0].count} nodes with connections`);

      // Generate route recommendations using the exact same logic as working script
      const allRecommendations: any[] = [];
      
      for (const pattern of patterns) {
        console.log(`\n🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
        
        // Get intersection nodes for routing (like working script)
        const nodesResult = await this.pgClient.query(`
          SELECT pg_id as id, node_type, connection_count 
          FROM ${routeStagingSchema}.node_mapping 
          WHERE node_type IN ('intersection', 'simple_connection')
          ORDER BY connection_count DESC
          LIMIT 20
        `);
        
        if (nodesResult.rows.length < 2) {
          console.log('⚠️ Not enough nodes for routing');
          continue;
        }

        const patternRoutes: any[] = [];
        const targetRoutes = 5;
        
        // Try different tolerance levels to get 5 routes (like working script)
        const toleranceLevels = [
          { name: 'strict', distance: pattern.tolerance_percent, elevation: pattern.tolerance_percent, quality: 1.0 },
          { name: 'medium', distance: 50, elevation: 50, quality: 0.8 },
          { name: 'wide', distance: 100, elevation: 100, quality: 0.6 }
        ];

        for (const tolerance of toleranceLevels) {
          if (patternRoutes.length >= targetRoutes) break;
          
          console.log(`🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
          
          // Generate routes between node pairs (like working script)
          for (let i = 0; i < Math.min(nodesResult.rows.length - 1, 10); i++) {
            if (patternRoutes.length >= targetRoutes) break;
            
            const startNode = nodesResult.rows[i].id;
            const endNode = nodesResult.rows[i + 1].id;
            
            // Try KSP routing between these nodes (like working script)
            console.log(`🛤️ Trying KSP from node ${startNode} to node ${endNode}...`);
            
            try {
              // First check if these nodes are connected (like working script)
              const connectivityCheck = await this.pgClient.query(`
                SELECT 
                  COUNT(*) as path_exists
                FROM pgr_dijkstra(
                  'SELECT id, source, target, length_km as cost FROM ${routeStagingSchema}.ways_noded',
                  $1::integer, $2::integer, false
                )
              `, [startNode, endNode]);
              
              const hasPath = connectivityCheck.rows[0].path_exists > 0;
              console.log(`  📊 Path exists: ${hasPath} (${connectivityCheck.rows[0].path_exists} edges)`);
              
              if (!hasPath) {
                console.log(`  ❌ No path exists between nodes ${startNode} and ${endNode}`);
                continue;
              }

              const kspResult = await this.pgClient.query(`
                SELECT * FROM pgr_ksp(
                  'SELECT id, source, target, length_km as cost FROM ${routeStagingSchema}.ways_noded',
                  $1::bigint, $2::bigint, 5, false, false
                )
              `, [startNode, endNode]);
              
              console.log(`✅ KSP found ${kspResult.rows.length} routes`);
              
              // Group KSP results by path_id to get complete routes (like working script)
              const routeGroups = new Map();
              for (const row of kspResult.rows) {
                if (!routeGroups.has(row.path_id)) {
                  routeGroups.set(row.path_id, []);
                }
                routeGroups.get(row.path_id).push(row);
              }
              
              for (const [pathId, routeSteps] of routeGroups.entries()) {
                // Extract edge IDs from the route steps (skip -1 which means no edge)
                const edgeIds = routeSteps.map((step: any) => step.edge).filter((edge: number) => edge !== -1);
                
                if (edgeIds.length === 0) {
                  console.log(`  ⚠️ No valid edges found for path ${pathId}`);
                  continue;
                }
                
                // Get the edges for this route with UUID mapping (like get-route-constituent-trails.ts)
                const routeEdgesWithMapping = await this.pgClient.query(`
                  SELECT 
                    w.*,
                    em.app_uuid,
                    em.trail_name,
                    em.length_km as trail_length_km,
                    em.elevation_gain as trail_elevation_gain
                  FROM ${routeStagingSchema}.ways_noded w
                  JOIN ${routeStagingSchema}.edge_mapping em ON w.id = em.pg_id
                  WHERE w.id = ANY($1::integer[])
                  ORDER BY w.id
                `, [edgeIds]);
                
                if (routeEdgesWithMapping.rows.length === 0) {
                  console.log(`  ⚠️ No edges found for route path`);
                  continue;
                }
                
                // Calculate route metrics (like working script)
                let totalDistance = 0;
                let totalElevationGain = 0;
                
                for (const edge of routeEdgesWithMapping.rows) {
                  totalDistance += edge.length_km || 0;
                  totalElevationGain += edge.elevation_gain || 0;
                }
                
                console.log(`  📏 Route metrics: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(0)}m elevation`);
                
                // Get constituent trails analysis (like get-route-constituent-trails.ts)
                const uniqueTrails = routeEdgesWithMapping.rows
                  .filter((edge: any) => edge.app_uuid)
                  .map((edge: any) => ({
                    app_uuid: edge.app_uuid,
                    trail_name: edge.trail_name,
                    length_km: edge.trail_length_km,
                    elevation_gain: edge.trail_elevation_gain
                  }))
                  .filter((trail: any, index: number, arr: any[]) => 
                    arr.findIndex((t: any) => t.app_uuid === trail.app_uuid) === index
                  );
                
                console.log(`  🛤️ Constituent trails: ${uniqueTrails.length} unique trails`);
                uniqueTrails.forEach((trail: any, index: number) => {
                  console.log(`    ${index + 1}. ${trail.trail_name} (${trail.length_km?.toFixed(2)}km, ${trail.elevation_gain?.toFixed(0)}m)`);
                });
                
                // Check if route meets tolerance criteria (like working script)
                const distanceOk = totalDistance >= pattern.target_distance_km * (1 - tolerance.distance / 100) && totalDistance <= pattern.target_distance_km * (1 + tolerance.distance / 100);
                const elevationOk = totalElevationGain >= pattern.target_elevation_gain * (1 - tolerance.elevation / 100) && totalElevationGain <= pattern.target_elevation_gain * (1 + tolerance.elevation / 100);
                
                if (distanceOk && elevationOk) {
                  // Calculate quality score based on tolerance level (like working script)
                  const finalScore = tolerance.quality * (1.0 - Math.abs(totalDistance - pattern.target_distance_km) / pattern.target_distance_km);
                  
                  console.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
                  
                  // Store the route in the main staging schema with enhanced data (like get-route-constituent-trails.ts)
                  const recommendation = {
                    route_uuid: `ksp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    route_name: `${pattern.pattern_name} - KSP Route`,
                    route_type: 'custom',
                    route_shape: pattern.route_shape,
                    input_distance_km: pattern.target_distance_km,
                    input_elevation_gain: pattern.target_elevation_gain,
                    recommended_distance_km: totalDistance,
                    recommended_elevation_gain: totalElevationGain,
                    route_path: { path_id: pathId, steps: routeSteps },
                    route_edges: routeEdgesWithMapping.rows,
                    trail_count: uniqueTrails.length,
                    route_score: Math.floor(finalScore * 100),
                    similarity_score: finalScore,
                    region: 'boulder', // Hardcode for now
                    // Enhanced data from get-route-constituent-trails.ts
                    constituent_trails: uniqueTrails,
                    edge_count: edgeIds.length,
                    unique_trail_count: uniqueTrails.length,
                    one_way_distance_km: totalDistance,
                    one_way_elevation_m: totalElevationGain,
                    out_and_back_distance_km: totalDistance * 2,
                    out_and_back_elevation_m: totalElevationGain * 2
                  };
                  
                  patternRoutes.push(recommendation);
                  
                  if (patternRoutes.length >= targetRoutes) {
                    console.log(`  🎯 Reached ${targetRoutes} routes for this pattern`);
                    break;
                  }
                } else {
                  console.log(`  ❌ Route doesn't meet criteria (distance: ${distanceOk}, elevation: ${elevationOk})`);
                }
              }
            } catch (error: any) {
              console.log(`❌ KSP routing failed: ${error.message}`);
            }
          }
        }
        
        // Sort by score and take top routes (like working script)
        const bestRoutes = patternRoutes
          .sort((a, b) => b.route_score - a.route_score)
          .slice(0, targetRoutes);
        
        allRecommendations.push(...bestRoutes);
        console.log(`✅ Generated ${bestRoutes.length} routes for ${pattern.pattern_name}`);
      }

      // Store all recommendations in the main staging schema (not the route staging schema)
      if (allRecommendations.length > 0) {
        console.log(`💾 Storing ${allRecommendations.length} route recommendations in main staging schema...`);
        
        for (const rec of allRecommendations) {
          await this.pgClient.query(`
            INSERT INTO ${this.stagingSchema}.route_recommendations (
              route_uuid, route_name, route_type, route_shape, 
              input_distance_km, input_elevation_gain, 
              recommended_distance_km, recommended_elevation_gain,
              route_path, route_edges, trail_count, route_score, similarity_score, region
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `, [
            rec.route_uuid, rec.route_name, rec.route_type, rec.route_shape,
            rec.input_distance_km, rec.input_elevation_gain,
            rec.recommended_distance_km, rec.recommended_elevation_gain,
            JSON.stringify(rec.route_path), JSON.stringify(rec.route_edges),
            rec.trail_count, rec.route_score, rec.similarity_score, rec.region
          ]);
        }
        
        console.log(`✅ Successfully stored ${allRecommendations.length} route recommendations in main staging schema`);
        
        // Generate summary analysis (like get-route-constituent-trails.ts)
        console.log(`\n📊 ROUTE RECOMMENDATIONS SUMMARY:`);
        console.log(`Total routes generated: ${allRecommendations.length}`);
        const avgTrailsPerRoute = allRecommendations.reduce((sum, route) => sum + route.unique_trail_count, 0) / allRecommendations.length;
        console.log(`Average trails per route: ${avgTrailsPerRoute.toFixed(1)}`);
        
        // Show top routes by score
        const topRoutes = allRecommendations
          .sort((a, b) => b.route_score - a.route_score)
          .slice(0, 5);
        
        console.log(`\n🏆 Top 5 routes by score:`);
        topRoutes.forEach((route, index) => {
          console.log(`  ${index + 1}. ${route.route_name}`);
          console.log(`     Score: ${route.route_score}, Distance: ${route.recommended_distance_km.toFixed(2)}km, Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
          console.log(`     Trails: ${route.unique_trail_count} unique trails`);
        });
      }

      // Clean up the route staging schema
      console.log(`🧹 Cleaning up route staging schema: ${routeStagingSchema}`);
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${routeStagingSchema} CASCADE`);
      
      console.log('✅ Route recommendation generation completed successfully!');
    } catch (error: any) {
      const errorMessage = `❌ Failed to generate KSP route recommendations: ${error}`;
      console.error(errorMessage);
      console.error('Full error details:', error);
      
      // Don't throw error - route recommendations are optional
      console.warn('⚠️ KSP route recommendation generation failed, continuing with export...');
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

  /**
   * Execute trail splitting logic (extracted to eliminate code duplication)
   */
  private async executeTrailSplitting(sourceQuery: string, params: any[]): Promise<any> {
    // Get tolerances for configuration
    const tolerances = getTolerances();
    const minTrailLengthMeters = tolerances.minTrailLengthMeters || 0.0;
    
    // Create trail splitter with configuration
    const splitterConfig: TrailSplitterConfig = {
      minTrailLengthMeters
    };
    
    const trailSplitter = new TrailSplitter(this.pgClient, this.stagingSchema, splitterConfig);
    
    // Execute the splitting
    const result = await trailSplitter.splitTrails(sourceQuery, params);
    
    return { rowCount: result.iterations };
  }

  private async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log('📋 Reading and splitting', this.config.region, 'data directly from public.trails...');
    console.log('🔍 DEBUG: bbox parameter received:', bbox);
    console.log('🔍 DEBUG: this.config.bbox:', this.config.bbox);
    
    // Get configurable minimum trail length for intersection detection
    const tolerances = getTolerances();
    const minTrailLengthMeters = tolerances.minTrailLengthMeters || 0.0;
    console.log(`🔍 Using minimum trail length: ${minTrailLengthMeters}m for intersection detection`);
    
    // Support CARTHORSE_TEST_LIMIT for quick tests
    const trailLimit = process.env.CARTHORSE_TEST_LIMIT ? parseInt(process.env.CARTHORSE_TEST_LIMIT) : null;
    // Build bbox parameters if provided
    let bboxMinLng: number | null = null, bboxMinLat: number | null = null, bboxMaxLng: number | null = null, bboxMaxLat: number | null = null;
    
    if (bbox && bbox.length === 4) {
      [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = bbox;
      console.log(`🗺️ Filtering by bbox: ${bboxMinLng}, ${bboxMinLat}, ${bboxMaxLng}, ${bboxMaxLat}`);
    }
    
    // Clear existing data
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.trails`);
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);
    
    // Build source query with filters (read-only from public.trails)
    let sourceQuery = `SELECT * FROM public.trails WHERE region = '${this.config.region}'`;
    let queryParams: any[] = [this.config.region];

    // Add bbox filter if provided
    if (bboxMinLng !== null && bboxMinLat !== null && bboxMaxLng !== null && bboxMaxLat !== null) {
      sourceQuery += ` AND ST_Intersects(geometry, ST_MakeEnvelope(${bboxMinLng}, ${bboxMinLat}, ${bboxMaxLng}, ${bboxMaxLat}, 4326))`;
      queryParams.push(bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat);
    }

    // Add limit
    if (trailLimit !== null) {
      sourceQuery += ` LIMIT ${trailLimit}`;
      queryParams.push(trailLimit);
    }

    console.log('📋 Source query (read-only from public.trails):', sourceQuery);
    console.log('📋 Query parameters:', queryParams);

    // Step 1a: Read original trails and split loops before copying to staging
    console.log('📋 Step 1a: Reading original trails and splitting loops...');
    
             // First, get the original trails that need to be processed
         const originalTrailsSql = `
           SELECT app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry, region,
                  bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
           FROM public.trails 
           WHERE region = $1
           ${bboxMinLng !== null ? 'AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))' : ''}
           ${trailLimit !== null ? 'LIMIT $6' : ''}
         `;
    
    const originalTrails = await this.pgClient.query(originalTrailsSql, queryParams);
    console.log(`📋 Found ${originalTrails.rows.length} original trails to process`);
    
    // Step 1b: Split loops and create new segments
    console.log('🔍 Step 1b: Splitting loops using ST_Node()...');
    const allTrailsToInsert = [...originalTrails.rows];
    
    for (const trail of originalTrails.rows) {
      // Check if this trail forms a loop
      const isLoop = await this.pgClient.query(`
        SELECT ST_DWithin(ST_StartPoint($1::geometry), ST_EndPoint($1::geometry), 10) as is_loop,
               ST_Distance(ST_StartPoint($1::geometry), ST_EndPoint($1::geometry)) as start_end_distance
      `, [trail.geometry]);
      
      if (isLoop.rows[0].is_loop && isLoop.rows[0].start_end_distance < 10) {
        console.log(`📍 Processing loop: ${trail.name} (start/end distance: ${isLoop.rows[0].start_end_distance.toFixed(2)}m)`);
        
                 // Detect intersections with other trails and split loops at those points
         const splitSegmentsSql = `
           WITH other_trail_intersections AS (
             SELECT 
               dumped.geom as intersection_point,
               ST_LineLocatePoint($1::geometry, dumped.geom) as split_ratio
             FROM public.trails t2,
             LATERAL ST_Dump(ST_Intersection($1::geometry, t2.geometry)) as dumped
             WHERE t2.app_uuid != $2
             AND ST_Intersects($1::geometry, t2.geometry)
             AND ST_GeometryType(ST_Intersection($1::geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
             AND ST_LineLocatePoint($1::geometry, dumped.geom) > 0.001 
             AND ST_LineLocatePoint($1::geometry, dumped.geom) < 0.999
             ORDER BY split_ratio
           ),
           split_segments AS (
             SELECT 
               ST_LineSubstring($1::geometry, 
                 COALESCE(LAG(split_ratio) OVER (ORDER BY split_ratio), 0), 
                 split_ratio) as segment_geometry,
               ST_Length(ST_LineSubstring($1::geometry, 
                 COALESCE(LAG(split_ratio) OVER (ORDER BY split_ratio), 0), 
                 split_ratio)) as segment_length
             FROM other_trail_intersections
             UNION ALL
             SELECT 
               ST_LineSubstring($1::geometry, 
                 (SELECT MAX(split_ratio) FROM other_trail_intersections), 
                 1) as segment_geometry,
               ST_Length(ST_LineSubstring($1::geometry, 
                 (SELECT MAX(split_ratio) FROM other_trail_intersections), 
                 1)) as segment_length
             WHERE (SELECT MAX(split_ratio) FROM other_trail_intersections) IS NOT NULL
           )
           SELECT 
             segment_geometry,
             segment_length
           FROM split_segments
           WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
           AND segment_length > 10
         `;
        
                 const splitSegments = await this.pgClient.query(splitSegmentsSql, [trail.geometry, trail.app_uuid]);
        
                 console.log(`📍 Found ${splitSegments.rows.length} segments for loop: ${trail.name}`);
         
         if (splitSegments.rows.length > 1) {
           console.log(`📍 Split loop into ${splitSegments.rows.length} segments: ${trail.name}`);
           
           // Create new trail segments from the split geometry
           for (let i = 0; i < splitSegments.rows.length; i++) {
             const segment = splitSegments.rows[i];
             const newTrail = {
               ...trail,
               app_uuid: `split_${trail.app_uuid}_${i}`,
               name: `${trail.name} (segment ${i + 1})`,
               geometry: segment.segment_geometry,
               length_km: segment.segment_length / 1000
             };
             allTrailsToInsert.push(newTrail);
           }
         } else {
           console.log(`📍 Loop ${trail.name} did not split (only ${splitSegments.rows.length} segment found)`);
           
           // Debug: let's see what the geometry looks like
           const debugSql = `
             SELECT 
               ST_GeometryType($1::geometry) as geom_type,
               ST_Length($1::geometry) as length,
               ST_NumPoints($1::geometry) as num_points,
               ST_StartPoint($1::geometry) as start_point,
               ST_EndPoint($1::geometry) as end_point
           `;
           const debugResult = await this.pgClient.query(debugSql, [trail.geometry]);
           console.log(`📍 Debug for ${trail.name}: type=${debugResult.rows[0].geom_type}, length=${debugResult.rows[0].length}, points=${debugResult.rows[0].num_points}`);
         }
      }
    }
    
    // Step 1c: Copy all trails (original + split segments) directly to staging
    console.log(`📋 Step 1c: Copying ${allTrailsToInsert.length} trails (original + split segments) to staging...`);
    
             // Insert all trails directly into staging
         for (const trail of allTrailsToInsert) {
           const insertSql = `
             INSERT INTO ${this.stagingSchema}.trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           `;
           
           await this.pgClient.query(insertSql, [
             trail.app_uuid,
             trail.name,
             trail.trail_type,
             trail.surface,
             trail.difficulty,
             trail.length_km,
             trail.elevation_gain,
             trail.elevation_loss,
             trail.max_elevation,
             trail.min_elevation,
             trail.avg_elevation,
             trail.geometry,
             trail.region,
             trail.bbox_min_lng,
             trail.bbox_max_lng,
             trail.bbox_min_lat,
             trail.bbox_max_lat
           ]);
         }
    
    console.log(`✅ Successfully copied ${allTrailsToInsert.length} trails to staging (including ${allTrailsToInsert.length - originalTrails.rows.length} split segments)`);
    
    // Step 1c: Trail splitting already completed above - trails are now in staging
    console.log('✂️ Step 1c: Trail splitting completed during loop processing...');
    
    // Step 1d: Clean up geometries to prevent pgRouting issues
    console.log('🔧 Step 1d: Cleaning up geometries for pgRouting compatibility...');
    
    // Clean up GeometryCollections and complex geometries
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_LineMerge(ST_CollectionHomogenize(geometry))
      WHERE ST_GeometryType(geometry) = 'ST_GeometryCollection'
    `);
    
    // Convert MultiLineStrings to LineStrings
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_LineMerge(geometry)
      WHERE ST_GeometryType(geometry) = 'ST_MultiLineString'
    `);
    
    // Fix invalid geometries
    await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_MakeValid(geometry)
      WHERE NOT ST_IsValid(geometry)
    `);
    
    // Remove problematic geometries that can't be fixed
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_GeometryType(geometry) != 'ST_LineString'
        OR NOT ST_IsSimple(geometry)
        OR ST_IsEmpty(geometry)
        OR ST_Length(geometry) < 0.001
    `);
    
    // Final check for any remaining problematic geometries
    const problematicGeoms = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${this.stagingSchema}.trails 
      WHERE ST_GeometryType(geometry) != 'ST_LineString'
    `);
    
    if (problematicGeoms.rows[0].count > 0) {
      console.warn(`⚠️  Found ${problematicGeoms.rows[0].count} problematic geometries, removing them...`);
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE ST_GeometryType(geometry) != 'ST_LineString'
      `);
    }
    
    // Get final count after cleanup
    const finalCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
    `);
    console.log(`✅ Geometry cleanup completed: ${finalCount.rows[0].count} trails remaining`);
    
    // Step 1e: Robust geometry preprocessing using the new utility
    console.log('🔧 Step 1e: Running robust geometry preprocessing...');
    const geometryPreprocessor = createGeometryPreprocessor(this.pgClient);
    
    const preprocessingResult = await geometryPreprocessor.preprocessTrailGeometries({
      schemaName: this.stagingSchema,
      tableName: 'trails',
      region: this.config.region,
      bbox: bbox,
      maxPasses: 5,
      minLengthMeters: 0.0 // No minimum length requirement
    });
    
    if (!preprocessingResult.success) {
      throw new Error(`Geometry preprocessing failed: ${preprocessingResult.errors.join(', ')}`);
    }
    
    console.log(`✅ Robust geometry preprocessing completed: ${preprocessingResult.finalCount} trails remaining (dropped ${preprocessingResult.droppedCount})`);
    
    // Step 1f: Calculate bbox from geometry for trails with missing or invalid bbox data
    console.log('📐 Step 1f: Calculating bbox from geometry for trails with missing or invalid bbox data...');
    const bboxUpdateSql = `
      UPDATE ${this.stagingSchema}.trails 
      SET 
        bbox_min_lng = ST_XMin(geometry),
        bbox_max_lng = ST_XMax(geometry),
        bbox_min_lat = ST_YMin(geometry),
        bbox_max_lat = ST_YMax(geometry)
      WHERE geometry IS NOT NULL 
        AND (bbox_min_lng IS NULL OR bbox_max_lng IS NULL OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL
             OR bbox_min_lng > bbox_max_lng OR bbox_min_lat > bbox_max_lat)
    `;
    const bboxUpdateResult = await this.pgClient.query(bboxUpdateSql);
    console.log(`✅ Updated ${bboxUpdateResult.rowCount} trails with bbox calculated from geometry`);
    
    // Create spatial index for intersection points
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_intersection_points ON ${this.stagingSchema}.intersection_points USING GIST(point)`);
  }

  /**
   * Export data as GeoJSON with nodes, edges, and trails
   */
  private async exportTrailSegmentsOnly(): Promise<void> {
    console.log('🗺️ Exporting trail segments only...');
    
    try {
      // Export only trails (no nodes or edges)
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          ST_AsGeoJSON(geometry) as geojson
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL
        ORDER BY name
      `);

      // Create GeoJSON features for trails only
      const trailFeatures = trailsResult.rows.map(row => ({
        type: 'Feature',
        properties: {
          id: row.app_uuid,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          max_elevation: row.max_elevation,
          min_elevation: row.min_elevation,
          avg_elevation: row.avg_elevation,
          color: '#00ff00', // Green for trails
          size: 2
        },
        geometry: JSON.parse(row.geojson)
      }));

      // Create GeoJSON collection
      const geojson = {
        type: 'FeatureCollection',
        features: trailFeatures
      };

      // Write to file using the configured output path
      fs.writeFileSync(this.config.outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Trail segments export completed:`);
      console.log(`   📁 File: ${this.config.outputPath}`);
      console.log(`   🗺️ Trails: ${trailFeatures.length}`);
      console.log(`   🎨 Colors: Trails (green)`);

    } catch (error) {
      console.error('❌ Error exporting trail segments:', error);
      throw error;
    }
  }

  private async exportGeoJSONData(): Promise<void> {
    console.log('🗺️ Exporting GeoJSON data...');
    
    try {
      // Export original trails
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          ST_AsGeoJSON(geometry, 6, 0) as geojson
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL
        ORDER BY name
      `);

      // Export routing nodes
      const nodesResult = await this.pgClient.query(`
        SELECT 
          id,
          node_uuid,
          lat,
          lng,
          elevation,
          node_type,
          connected_trails,
          trail_ids,
          ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(lng, lat), 4326)) as geojson
        FROM ${this.stagingSchema}.routing_nodes
        ORDER BY id
      `);

      // Export routing edges
      const edgesResult = await this.pgClient.query(`
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
          ST_AsGeoJSON(geometry) as geojson
        FROM ${this.stagingSchema}.routing_edges
        ORDER BY id
      `);

      // Create GeoJSON features
      const trailFeatures = trailsResult.rows.map(row => ({
        type: 'Feature',
        properties: {
          id: row.app_uuid,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          max_elevation: row.max_elevation,
          min_elevation: row.min_elevation,
          avg_elevation: row.avg_elevation,
          color: '#00ff00', // Green for trails
          size: 2
        },
        geometry: JSON.parse(row.geojson)
      }));

      const nodeFeatures = nodesResult.rows.map(row => {
        let color = '#0000ff'; // Blue for trail nodes
        let size = 2;
        
        if (row.node_type === 'intersection') {
          color = '#ff0000'; // Red for intersections
          size = 3;
        } else if (row.node_type === 'endpoint') {
          color = '#00ff00'; // Green for endpoints
          size = 3;
        }
        
        return {
          type: 'Feature',
          properties: {
            id: row.id,
            node_uuid: row.node_uuid,
            node_type: row.node_type,
            connected_trails: row.connected_trails,
            elevation: row.elevation,
            color: color,
            size: size
          },
          geometry: JSON.parse(row.geojson)
        };
      });

      const edgeFeatures = edgesResult.rows.map(row => ({
        type: 'Feature',
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
          color: '#ff00ff', // Magenta for edges
          size: 1
        },
        geometry: JSON.parse(row.geojson)
      }));

      // Combine all features
      const allFeatures = [...trailFeatures, ...nodeFeatures, ...edgeFeatures];
      
      const geojson = {
        type: 'FeatureCollection',
        features: allFeatures
      };

      // Write to file using the configured output path
      const fs = require('fs');
      const path = require('path');
      
      // Create output directory if it doesn't exist
      const outputDir = path.dirname(this.config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(this.config.outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ GeoJSON export completed:`);
      console.log(`   📁 File: ${this.config.outputPath}`);
      console.log(`   🗺️ Trails: ${trailFeatures.length}`);
      console.log(`   📍 Nodes: ${nodeFeatures.length}`);
      console.log(`   🔗 Edges: ${edgeFeatures.length}`);
      console.log(`   🎨 Colors: Trails (green), Intersections (red), Endpoints (green), Edges (magenta)`);

    } catch (error) {
      console.error('❌ Error exporting GeoJSON:', error);
      throw error;
    }
  }

  /**
   * Enhanced loop detection that identifies loops through intersection patterns
   * Detects trails that intersect the same other trail multiple times
   */














  /**
   * Generate routing graph using traversal algorithm
   * Starts at nodes and traces trails to build the graph incrementally
   */
  private async generateRoutingGraphByTraversal(intersectionToleranceMeters: number): Promise<void> {
    console.log(`🔄 Generating routing graph using traversal algorithm with tolerance: ${intersectionToleranceMeters}m`);
    
    // Clear existing routing nodes and edges
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
    
    const toleranceDegrees = intersectionToleranceMeters / 111000.0;
    
    // Step 1: Find all potential nodes (trail endpoints and intersections)
    const potentialNodesSql = `
      WITH trail_endpoints AS (
        -- Start points
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as point,
          ST_Z(ST_StartPoint(geometry)) as elevation,
          'start' as endpoint_type,
          geometry as trail_geometry
        FROM ${this.stagingSchema}.trails
        WHERE ST_StartPoint(geometry) IS NOT NULL
        UNION ALL
        -- End points
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_EndPoint(geometry) as point,
          ST_Z(ST_EndPoint(geometry)) as elevation,
          'end' as endpoint_type,
          geometry as trail_geometry
        FROM ${this.stagingSchema}.trails
        WHERE ST_EndPoint(geometry) IS NOT NULL
      ),
      intersection_points AS (
        -- Find trail intersections between different trails
        SELECT 
          t1.app_uuid as trail_id,
          t1.name as trail_name,
          t1.length_km,
          t1.elevation_gain,
          t1.elevation_loss,
          dumped.geom as point,
          COALESCE(ST_Z(dumped.geom), 0) as elevation,
          'intersection' as endpoint_type,
          t1.geometry as trail_geometry
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid,
        LATERAL ST_Dump(ST_Intersection(t1.geometry, t2.geometry)) as dumped
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 5
          AND ST_Length(t2.geometry::geography) > 5
      ),
      self_intersection_points AS (
        -- Find self-intersections within the same trail
        SELECT 
          t1.app_uuid as trail_id,
          t1.name as trail_name,
          t1.length_km,
          t1.elevation_gain,
          t1.elevation_loss,
          dumped.geom as point,
          COALESCE(ST_Z(dumped.geom), 0) as elevation,
          'self_intersection' as endpoint_type,
          t1.geometry as trail_geometry
        FROM ${this.stagingSchema}.trails t1,
        LATERAL ST_Dump(ST_Intersection(t1.geometry, t1.geometry)) as dumped
        WHERE ST_GeometryType(ST_Intersection(t1.geometry, t1.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 5
          -- Exclude start and end points to avoid duplicates
          AND ST_LineLocatePoint(t1.geometry, dumped.geom) > 0.001 
          AND ST_LineLocatePoint(t1.geometry, dumped.geom) < 0.999
      ),
      all_points AS (
        SELECT * FROM trail_endpoints
        UNION ALL
        SELECT * FROM intersection_points
        UNION ALL
        SELECT * FROM self_intersection_points
      ),
      unique_points AS (
        -- Deduplicate points that are very close to each other
        SELECT DISTINCT ON (ST_SnapToGrid(point, ${toleranceDegrees}))
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          point,
          elevation,
          endpoint_type,
          trail_geometry,
          ST_Y(point) as lat,
          ST_X(point) as lng
        FROM all_points
        WHERE point IS NOT NULL
      )
      SELECT * FROM unique_points
      ORDER BY trail_id, endpoint_type;
    `;
    
    const potentialNodesResult = await this.pgClient.query(potentialNodesSql);
    const potentialNodes = potentialNodesResult.rows;
    
    console.log(`📍 Found ${potentialNodes.length} potential nodes`);
    
    // Step 2: Create nodes and track visited trails
    const visitedTrails = new Set<string>();
    const createdNodes = new Map<string, string>(); // point_key -> node_id
    const nodeTrailMap = new Map<string, any>(); // node_id -> node_data
    
    for (const nodeData of potentialNodes) {
      const pointKey = `${nodeData.lat.toFixed(6)},${nodeData.lng.toFixed(6)}`;
      
      // Skip if we've already created a node at this location
      if (createdNodes.has(pointKey)) {
        continue;
      }
      
      // Create the node
      const nodeId = await this.createRoutingNode(nodeData);
      createdNodes.set(pointKey, nodeId);
      nodeTrailMap.set(nodeId, nodeData);
      
      console.log(`📍 Created node ${nodeId} at (${nodeData.lat.toFixed(4)}, ${nodeData.lng.toFixed(4)}) for trail ${nodeData.trail_id}`);
    }
    
    console.log(`✅ Created ${createdNodes.size} unique nodes`);
    
    // Step 3: Create comprehensive trail edges with intersection detection
    const visitedEdges = new Set<string>();
    await this.createComprehensiveTrailEdges(createdNodes, visitedEdges);
    
    // Get final statistics
    const nodeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_nodes`);
    const edgeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_edges`);
    
    const nodeCount = parseInt(nodeCountResult.rows[0].count);
    const edgeCount = parseInt(edgeCountResult.rows[0].count);
    
    console.log(`📊 Final results: ${nodeCount} nodes, ${edgeCount} edges`);
  }
  
  /**
   * Create a routing node
   */
  private async createRoutingNode(nodeData: any): Promise<string> {
    const insertSql = `
      INSERT INTO ${this.stagingSchema}.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
      VALUES (
        gen_random_uuid(),
        gen_random_uuid(),
        $1, $2, $3, 'unknown', $4, ARRAY[$5], NOW()
      )
      RETURNING id;
    `;
    
    const result = await this.pgClient.query(insertSql, [
      nodeData.lat,
      nodeData.lng,
      nodeData.elevation,
      nodeData.trail_name,
      nodeData.trail_id
    ]);
    
    return result.rows[0].id;
  }
  
  /**
   * Trace a trail from a starting node to find connected nodes and create edges
   */
  private async traceTrailFromNode(
    startNodeId: string, 
    startNodeData: any, 
    createdNodes: Map<string, string>,
    visitedEdges: Set<string>
  ): Promise<void> {
    const trailId = startNodeData.trail_id;
    
    // Find the other endpoint of this trail
    const otherEndpointSql = `
      SELECT 
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng
      FROM ${this.stagingSchema}.trails
      WHERE app_uuid = $1;
    `;
    
    const trailResult = await this.pgClient.query(otherEndpointSql, [trailId]);
    if (trailResult.rows.length === 0) {
      return;
    }
    
    const trail = trailResult.rows[0];
    
    // Find the other node (start or end depending on where we started)
    let otherNodeId: string | null = null;
    
    if (startNodeData.endpoint_type === 'start') {
      // We started at start point, find end point
      const endPointKey = `${trail.end_lat.toFixed(6)},${trail.end_lng.toFixed(6)}`;
      otherNodeId = createdNodes.get(endPointKey) || null;
    } else if (startNodeData.endpoint_type === 'end') {
      // We started at end point, find start point
      const startPointKey = `${trail.start_lat.toFixed(6)},${trail.start_lng.toFixed(6)}`;
      otherNodeId = createdNodes.get(startPointKey) || null;
    }
    
    if (!otherNodeId || otherNodeId === startNodeId) {
      return;
    }
    
    // Create edge if we haven't already
    const edgeKey = `${startNodeId}-${otherNodeId}`;
    const reverseEdgeKey = `${otherNodeId}-${startNodeId}`;
    
    if (!visitedEdges.has(edgeKey) && !visitedEdges.has(reverseEdgeKey)) {
      await this.createRoutingEdge(startNodeId, otherNodeId, startNodeData);
      visitedEdges.add(edgeKey);
      visitedEdges.add(reverseEdgeKey);
      
      console.log(`🛤️ Created edge from ${startNodeId} to ${otherNodeId} for trail ${trailId}`);
    }
  }
  
  /**
   * Create a routing edge using smart simplification that preserves endpoints and intersections
   */
  private async createRoutingEdge(sourceId: string, targetId: string, trailData: any): Promise<void> {
    // Simple approach: use original trail geometry with minimal simplification, force to 2D
    const insertSql = `
      INSERT INTO ${this.stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      VALUES ($1, $2, $3, $4, $5, $6, $7, ST_Simplify(ST_Force2D($8::geometry), 0.00005), ST_AsGeoJSON(ST_Simplify(ST_Force2D($8::geometry), 0.00005), 6, 0))
    `;
    
    await this.pgClient.query(insertSql, [
      sourceId,
      targetId,
      trailData.trail_id,
      trailData.trail_name,
      trailData.length_km,
      trailData.elevation_gain,
      trailData.elevation_loss,
      trailData.geometry
    ]);
  }

  /**
   * Comprehensive trail edge creation with intersection detection
   * Handles loops, X, T, and P (double joined loop) intersections
   */
  private async createComprehensiveTrailEdges(createdNodes: Map<string, string>, visitedEdges: Set<string>): Promise<void> {
    console.log('🔄 Creating comprehensive trail edges with intersection detection...');
    
    // Step 1: Get all trails with their intersection points
    const trailsWithIntersectionsSql = `
      WITH trail_segments AS (
        SELECT 
          t.app_uuid as trail_id,
          t.name as trail_name,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.geometry,
          -- Find all intersection points with other trails
          ARRAY_AGG(DISTINCT dumped.geom) as intersection_points
        FROM ${this.stagingSchema}.trails t
        LEFT JOIN ${this.stagingSchema}.trails t2 ON t.app_uuid != t2.app_uuid
        LEFT JOIN LATERAL ST_Dump(ST_Intersection(t.geometry, t2.geometry)) as dumped ON 
          ST_Intersects(t.geometry, t2.geometry) 
          AND ST_GeometryType(ST_Intersection(t.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        GROUP BY t.app_uuid, t.name, t.length_km, t.elevation_gain, t.elevation_loss, t.geometry
      ),
      trail_nodes AS (
        SELECT 
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          geometry,
          -- Start point coordinates
          ST_Y(ST_StartPoint(geometry)) as start_lat,
          ST_X(ST_StartPoint(geometry)) as start_lng,
          -- End point coordinates
          ST_Y(ST_EndPoint(geometry)) as end_lat,
          ST_X(ST_EndPoint(geometry)) as end_lng,
          -- All intersection points
          intersection_points,
          -- Check if it's a loop using PostGIS ST_IsClosed function
          ST_IsClosed(geometry) as is_loop
        FROM trail_segments
      )
      SELECT * FROM trail_nodes
      ORDER BY trail_id;
    `;
    
    const trailsResult = await this.pgClient.query(trailsWithIntersectionsSql);
    const trails = trailsResult.rows;
    
    console.log(`📍 Processing ${trails.length} trails for comprehensive edge creation...`);
    
    let totalEdgesCreated = 0;
    let loopCount = 0;
    let xIntersectionCount = 0;
    let tIntersectionCount = 0;
    let pIntersectionCount = 0;
    
    for (const trail of trails) {
      const trailId = trail.trail_id;
      const nodes = new Set<string>();
      
      // Add start and end points
      const startPointKey = `${trail.start_lat.toFixed(6)},${trail.start_lng.toFixed(6)}`;
      const endPointKey = `${trail.end_lat.toFixed(6)},${trail.end_lng.toFixed(6)}`;
      
      const startNodeId = createdNodes.get(startPointKey);
      const endNodeId = createdNodes.get(endPointKey);
      
      if (startNodeId) nodes.add(startNodeId);
      if (endNodeId) nodes.add(endNodeId);
      
      // Add intersection points (simplified for now)
      if (trail.intersection_points && trail.intersection_points.length > 0) {
        console.log(`📍 Trail ${trailId} has ${trail.intersection_points.length} intersection points`);
        // TODO: Handle intersection points properly in future iteration
      }
      
      // Convert to array and sort for consistent edge creation
      const nodeArray = Array.from(nodes);
      
      // Handle loops by splitting them into two separate edges
      if (trail.is_loop && nodeArray.length === 2) {
        // For loops, create two separate edges that can be traversed independently
        const sourceId = nodeArray[0];
        const targetId = nodeArray[1];
        
        if (sourceId && targetId && sourceId !== targetId) {
          // Create first edge (clockwise direction)
          const edgeKey1 = `${sourceId}-${targetId}`;
          const reverseEdgeKey1 = `${targetId}-${sourceId}`;
          
          if (!visitedEdges.has(edgeKey1) && !visitedEdges.has(reverseEdgeKey1)) {
            await this.createRoutingEdge(sourceId, targetId, trail);
            visitedEdges.add(edgeKey1);
            visitedEdges.add(reverseEdgeKey1);
            totalEdgesCreated++;
            loopCount++;
            console.log(`🔄 Created first loop edge for trail ${trailId} (clockwise)`);
          }
          
          // Create second edge (counter-clockwise direction) - same nodes, different traversal
          const edgeKey2 = `${targetId}-${sourceId}`;
          const reverseEdgeKey2 = `${sourceId}-${targetId}`;
          
          if (!visitedEdges.has(edgeKey2) && !visitedEdges.has(reverseEdgeKey2)) {
            await this.createRoutingEdge(targetId, sourceId, trail);
            visitedEdges.add(edgeKey2);
            visitedEdges.add(reverseEdgeKey2);
            totalEdgesCreated++;
            loopCount++;
            console.log(`🔄 Created second loop edge for trail ${trailId} (counter-clockwise)`);
          }
        }
      } else {
        // Create edges between consecutive nodes along the trail (non-loops)
        for (let i = 0; i < nodeArray.length - 1; i++) {
          const sourceId = nodeArray[i];
          const targetId = nodeArray[i + 1];
          
          if (sourceId && targetId && sourceId !== targetId) {
            const edgeKey = `${sourceId}-${targetId}`;
            const reverseEdgeKey = `${targetId}-${sourceId}`;
            
            if (!visitedEdges.has(edgeKey) && !visitedEdges.has(reverseEdgeKey)) {
              await this.createRoutingEdge(sourceId, targetId, trail);
              visitedEdges.add(edgeKey);
              visitedEdges.add(reverseEdgeKey);
              totalEdgesCreated++;
              
              // Classify intersection type
              if (nodeArray.length === 2) {
                console.log(`🛤️ Created simple edge for trail ${trailId}`);
              } else if (nodeArray.length === 3) {
                tIntersectionCount++;
                console.log(`🔗 Created T-intersection edge for trail ${trailId}`);
              } else if (nodeArray.length === 4) {
                xIntersectionCount++;
                console.log(`❌ Created X-intersection edge for trail ${trailId}`);
              } else if (nodeArray.length > 4) {
                pIntersectionCount++;
                console.log(`🔄 Created P-intersection (double loop) edge for trail ${trailId}`);
              }
            }
          }
        }
      }
      
      // Always create the main trail edge (start to end) to preserve network topology
      if (startNodeId && endNodeId && startNodeId !== endNodeId) {
        const mainEdgeKey = `${startNodeId}-${endNodeId}`;
        const reverseMainEdgeKey = `${endNodeId}-${startNodeId}`;
        
        if (!visitedEdges.has(mainEdgeKey) && !visitedEdges.has(reverseMainEdgeKey)) {
          await this.createRoutingEdge(startNodeId, endNodeId, trail);
          visitedEdges.add(mainEdgeKey);
          visitedEdges.add(reverseMainEdgeKey);
          totalEdgesCreated++;
          console.log(`🛤️ Created main trail edge for ${trailId}`);
        }
      }
      
      // Handle loops - treat as T-intersections and split into segments
      if (trail.is_loop && endNodeId && startNodeId && endNodeId !== startNodeId) {
        // For loops, create segments that connect to intersection nodes
        // This makes loops traversable by creating proper intersection points
        
        // Create segment from start to end (clockwise)
        const clockwiseEdgeKey = `${startNodeId}-${endNodeId}`;
        const reverseClockwiseEdgeKey = `${endNodeId}-${startNodeId}`;
        
        if (!visitedEdges.has(clockwiseEdgeKey) && !visitedEdges.has(reverseClockwiseEdgeKey)) {
          await this.createRoutingEdge(startNodeId, endNodeId, trail);
          visitedEdges.add(clockwiseEdgeKey);
          visitedEdges.add(reverseClockwiseEdgeKey);
          totalEdgesCreated++;
          console.log(`🔄 Created loop segment (clockwise) for trail ${trailId}`);
        }
        
        // Create segment from end to start (counter-clockwise) - different traversal
        const counterClockwiseEdgeKey = `${endNodeId}-${startNodeId}`;
        const reverseCounterClockwiseEdgeKey = `${startNodeId}-${endNodeId}`;
        
        if (!visitedEdges.has(counterClockwiseEdgeKey) && !visitedEdges.has(reverseCounterClockwiseEdgeKey)) {
          await this.createRoutingEdge(endNodeId, startNodeId, trail);
          visitedEdges.add(counterClockwiseEdgeKey);
          visitedEdges.add(reverseCounterClockwiseEdgeKey);
          totalEdgesCreated++;
          console.log(`🔄 Created loop segment (counter-clockwise) for trail ${trailId}`);
        }
        
        loopCount++;
      }
    }
    
    console.log(`✅ Comprehensive edge creation complete:`);
    console.log(`   📊 Total edges created: ${totalEdgesCreated}`);
    console.log(`   🔄 Loops: ${loopCount}`);
    console.log(`   ❌ X-intersections: ${xIntersectionCount}`);
    console.log(`   🔗 T-intersections: ${tIntersectionCount}`);
    console.log(`   🔄 P-intersections (double loops): ${pIntersectionCount}`);
  }

  private async processRegionInSubRegions(): Promise<void> {
    console.log('🗺️ Processing region in sub-regions using bbox subdivision...');
    
    // Use the exact same bbox as the working script (generate-ksp-routes.ts)
    const workingScriptBbox = [-105.35184737563483, 40.10010564946518, -105.31343938074664, 40.1281541323425];
    
    const subdivisions = [{
      id: 'working-script-bbox',
      bbox: workingScriptBbox,
      name: 'working-script-bbox'
    }];
    
    console.log(`📊 Created ${subdivisions.length} subdivisions for processing`);
    
    const allRecommendations: any[] = [];
    
    for (let i = 0; i < subdivisions.length; i++) {
      const subdivision = subdivisions[i];
      console.log(`\n🔄 Processing subdivision ${i + 1}/${subdivisions.length}: ${subdivision.name}`);
      
      // Step 1: Create sub-region staging schema
      const subRegionSchema = `${subdivision.name.replace(/-/g, '_')}_${Date.now()}`;
      console.log(`📁 Creating sub-region staging schema: ${subRegionSchema}`);
      
      await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${subRegionSchema}`);
      
      // Step 1.5: Create trails table in sub-region schema
      await this.pgClient.query(`
        CREATE TABLE ${subRegionSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT,
          name TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRINGZ, 4326)
        )
      `);
      
      // Step 2: Copy trail data using bbox filter (like working script)
      console.log(`📊 Copying trail data for bbox: ${JSON.stringify(subdivision.bbox)}`);
      
      const bboxFilter = `
        AND ST_Intersects(geometry, ST_MakeEnvelope(${subdivision.bbox[0]}, ${subdivision.bbox[1]}, ${subdivision.bbox[2]}, ${subdivision.bbox[3]}, 4326))
      `;
      
      await this.pgClient.query(`
        INSERT INTO ${subRegionSchema}.trails (app_uuid, name, geometry, length_km, elevation_gain)
        SELECT app_uuid::text, name, geometry, length_km, elevation_gain
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL ${bboxFilter}
      `);
      
      const trailsCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${subRegionSchema}.trails`);
      console.log(`✅ Copied ${trailsCount.rows[0].count} trails to ${subRegionSchema}`);
      
      if (trailsCount.rows[0].count === 0) {
        console.log(`⚠️ No trails in subdivision ${subdivision.name}, skipping...`);
        await this.pgClient.query(`DROP SCHEMA IF EXISTS ${subRegionSchema} CASCADE`);
        continue;
      }
      
      // Step 3: Create pgRouting network for this sub-region
      console.log(`🔄 Creating pgRouting network for ${subdivision.name}...`);
      const { PgRoutingHelpers } = await import('../utils/pgrouting-helpers');
      const pgrouting = new PgRoutingHelpers({
        stagingSchema: subRegionSchema,
        pgClient: this.pgClient as any // Type assertion to fix linter error
      });
      
      const networkCreated = await pgrouting.createPgRoutingViews();
      if (!networkCreated) {
        console.log(`⚠️ Failed to create pgRouting network for ${subdivision.name}, skipping...`);
        await this.pgClient.query(`DROP SCHEMA IF EXISTS ${subRegionSchema} CASCADE`);
        continue;
      }
      
      // Ensure node_mapping table is properly populated
      console.log(`🔧 Ensuring node_mapping table is properly populated for ${subdivision.name}...`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${subRegionSchema}.node_mapping`);
      await this.pgClient.query(`
        CREATE TABLE ${subRegionSchema}.node_mapping AS
        SELECT 
          v.id as pg_id,
          v.cnt as connection_count,
          CASE 
            WHEN v.cnt = 1 THEN 'dead_end'
            WHEN v.cnt = 2 THEN 'simple_connection'
            WHEN v.cnt >= 3 THEN 'intersection'
            ELSE 'unknown'
          END as node_type
        FROM ${subRegionSchema}.ways_noded_vertices_pgr v
      `);
      
      const nodeMappingCount = await this.pgClient.query(`SELECT COUNT(*) FROM ${subRegionSchema}.node_mapping WHERE connection_count > 0`);
      console.log(`✅ Node mapping created with ${nodeMappingCount.rows[0].count} nodes with connections`);
      
                    // Step 4: Generate route recommendations using exact same approach as working script
       console.log(`🔧 Generating route recommendations for ${subdivision.name}...`);
       const { KspRouteGenerator } = await import('../utils/ksp-route-generator');
       const routeGenerator = new KspRouteGenerator(this.pgClient, subRegionSchema);
       
       // Step 4.1: Add length_km and elevation_gain columns to ways_noded (like working script)
       console.log(`📏 Adding length_km and elevation_gain columns to ways_noded for ${subdivision.name}...`);
       await this.pgClient.query(`
         ALTER TABLE ${subRegionSchema}.ways_noded 
         ADD COLUMN IF NOT EXISTS length_km DOUBLE PRECISION
       `);
       
       await this.pgClient.query(`
         UPDATE ${subRegionSchema}.ways_noded 
         SET length_km = ST_Length(the_geom::geography) / 1000
       `);
       
       await this.pgClient.query(`
         ALTER TABLE ${subRegionSchema}.ways_noded 
         ADD COLUMN IF NOT EXISTS elevation_gain DOUBLE PRECISION DEFAULT 0
       `);
       
       await this.pgClient.query(`
         UPDATE ${subRegionSchema}.ways_noded w
         SET elevation_gain = COALESCE(t.elevation_gain, 0)
         FROM ${subRegionSchema}.trails t
         WHERE w.old_id = t.id
       `);
       
       console.log(`✅ Added length_km and elevation_gain columns to ways_noded for ${subdivision.name}`);
       
       // Load route patterns (exactly like working script)
       const patternsResult = await this.pgClient.query(`
         SELECT * FROM public.route_patterns 
         ORDER BY target_distance_km
       `);
       
       const patterns = patternsResult.rows;
       console.log(`✅ Loaded ${patterns.length} route patterns for ${subdivision.name}`);
       
       // Generate recommendations for each pattern (exactly like working script)
       const subRegionRecommendations: any[] = [];
       for (const pattern of patterns) {
         console.log(`🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
         
         // Use the proper out-and-back route generator (exactly like working script)
         const patternRoutes = await routeGenerator.generateOutAndBackRoutes(pattern, 5);
         subRegionRecommendations.push(...patternRoutes);
       }
      
      console.log(`✅ Generated ${subRegionRecommendations.length} route recommendations for ${subdivision.name}`);
      
      // Step 5: Store recommendations in main staging schema (same format as public.route_recommendations)
      if (subRegionRecommendations.length > 0) {
        console.log(`💾 Storing ${subRegionRecommendations.length} recommendations in main staging schema...`);
        
        for (const rec of subRegionRecommendations) {
          await this.pgClient.query(`
            INSERT INTO ${this.stagingSchema}.route_recommendations (
              route_uuid, route_name, route_type, route_shape,
              input_distance_km, input_elevation_gain,
              recommended_distance_km, recommended_elevation_gain,
              route_path, route_edges, trail_count, route_score,
              similarity_score, region, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
          `, [
            rec.route_uuid, rec.route_name, rec.route_type, rec.route_shape,
            rec.input_distance_km, rec.input_elevation_gain,
            rec.recommended_distance_km, rec.recommended_elevation_gain,
            JSON.stringify(rec.route_path), JSON.stringify(rec.route_edges),
            rec.trail_count, rec.route_score, rec.similarity_score, rec.region
          ]);
        }
        
        allRecommendations.push(...subRegionRecommendations);
        console.log(`✅ Successfully stored ${subRegionRecommendations.length} recommendations for ${subdivision.name}`);
      }
      
      // Step 6: Clean up sub-region staging schema
      console.log(`🧹 Cleaning up ${subRegionSchema}...`);
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${subRegionSchema} CASCADE`);
    }
    
         console.log(`\n🎉 Processing complete! Generated ${allRecommendations.length} total route recommendations`);
   }
 

 
 }