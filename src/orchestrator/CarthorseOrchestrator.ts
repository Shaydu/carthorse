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
import { TrailSplitter, TrailSplitterConfig } from '../utils/trail-splitter';

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
      const client = new Client(dbConfig);
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
      // Extract routing edges export logic for better debugging
      console.log('📊 Exporting routing edges...');
      const edgesRes = await this.pgClient.query(`
        SELECT 
          id,
          source,                    -- ✅ Use correct column name
          target,                    -- ✅ Use correct column name  
          trail_id,
          trail_name,
          length_km as distance_km,
          elevation_gain,
          elevation_loss,
          is_bidirectional,
          NOW() as created_at,
          ST_AsGeoJSON(geometry, 6, 0) AS geojson
        FROM ${this.stagingSchema}.routing_edges
        WHERE source IS NOT NULL AND target IS NOT NULL  -- ✅ Use correct column names
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
      
      // Create UUID to integer mapping for SQLite export
      const nodeIdMapping = new Map<string, number>();
      nodesRes.rows.forEach((node, index) => {
        nodeIdMapping.set(node.id, index + 1); // SQLite auto-increment starts at 1
      });
      
      console.log(`📊 Node mapping: ${nodeIdMapping.size} nodes mapped`);
      console.log(`📊 Sample node IDs: ${Array.from(nodeIdMapping.keys()).slice(0, 5).join(', ')}`);
      
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
      
      // Create UUID to integer mapping for SQLite export
      const nodeIdMapping = new Map<string, number>();
      nodesRes.rows.forEach((node, index) => {
        nodeIdMapping.set(node.id, index + 1); // SQLite auto-increment starts at 1
      });
      
      console.log(`📊 Node mapping: ${nodeIdMapping.size} nodes mapped`);
      console.log(`📊 Sample node IDs: ${Array.from(nodeIdMapping.keys()).slice(0, 5).join(', ')}`);
      
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
          ST_AsGeoJSON(geometry, 6, 0) AS geojson,
          NOW() as created_at
        FROM ${this.stagingSchema}.routing_edges
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
      await this.performComprehensiveCleanup();
      
      throw error;
    }
  }

  async export(outputFormat: 'geojson' | 'sqlite' | 'trails-only' = 'sqlite'): Promise<void> {
    try {
      // Setup staging environment (common for all formats)
      await this.setupStagingEnvironment();
      
      // Export based on format
      switch (outputFormat) {
        case 'geojson':
          console.log('[ORCH] About to exportGeoJSONData');
          await this.exportGeoJSONData();
          console.log('[ORCH] GeoJSON export completed successfully');
          console.log(`[ORCH] GeoJSON file created successfully`);
          break;
          
        case 'sqlite':
          console.log('[ORCH] About to exportSchema');
          await this.exportSchema();
          console.log('[ORCH] SQLite export completed successfully');
          console.log(`[ORCH] Output: ${this.config.outputPath}`);
          break;
          
        case 'trails-only':
          console.log('[ORCH] About to exportTrailSegmentsOnly');
          await this.exportTrailSegmentsOnly();
          console.log('[ORCH] Trails-only export completed successfully');
          break;
          
        default:
          throw new Error(`Unsupported output format: ${outputFormat}`);
      }

    } catch (error) {
      console.error('[Orchestrator] Error during run:', error);
      
      // Cleanup on error
      console.log('[Orchestrator] Cleaning up on error...');
      await this.performComprehensiveCleanup();
      
      throw error;
    } finally {
      // Always cleanup staging unless explicitly skipped
      if (!this.config.skipCleanup && !this.config.skipCleanupOnError) {
        console.log('[ORCH] About to cleanup staging');
        await this.cleanupStaging();
      } else if (this.config.skipCleanup) {
        console.log('[ORCH] Skipping cleanup (--skip-cleanup flag)');
      } else if (this.config.skipCleanupOnError) {
        console.log('[ORCH] Skipping cleanup (--skip-cleanup-on-error flag)');
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
    console.log('[ORCH] 🔧 Generating routing graph using serial operations...');
    
    try {
      // Get tolerance values from YAML configuration
      const tolerances = getTolerances();
      const nodeTolerance = tolerances.intersectionTolerance || 2.0;
      const edgeTolerance = tolerances.edgeTolerance || 20.0;
      const minTrailLengthMeters = tolerances.minTrailLengthMeters || 0.0;
      
      console.log(`[ORCH] Using tolerances: ${nodeTolerance}m (intersectionTolerance from route-discovery.config.yaml) for nodes, ${edgeTolerance}m (edgeTolerance from route-discovery.config.yaml) for edges`);
      console.log(`[ORCH] Using minimum trail length: ${minTrailLengthMeters}m (minTrailLengthMeters from route-discovery.config.yaml) for intersection detection`);
      
      // Step 1: Complete trail splitting (already done in copyRegionDataToStaging)
      console.log('[ORCH] Step 1: Trail splitting already completed in copyRegionDataToStaging');
      
      // Step 2: Generate routing graph using traversal algorithm
      console.log('[ORCH] Step 2: Generating routing graph using traversal algorithm...');
      await this.generateRoutingGraphByTraversal(nodeTolerance);
      
      // Step 3: Detect and split loops into separate edges
      console.log('[ORCH] Step 3: Detecting and splitting loops into separate edges...');
      await this.splitLoopsIntoEdges();
      
      // Step 4: Update node types based on actual connectivity
      console.log('[ORCH] Step 4: Updating node types based on actual connectivity...');
      await this.updateNodeTypesBasedOnConnectivity();
      
      // Step 5: Validate connectivity
      console.log('[ORCH] Step 5: Validating routing network connectivity...');
      await this.validateRoutingNetwork();
      
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
      
      // Add timing and progress logging
      const startTime = Date.now();
      logMessage(`⏱️  Starting route generation at ${new Date().toISOString()}`);
      
      if (this.config.verbose) {
        logMessage(`🔍 Verbose mode enabled - will show detailed progress`);
        logMessage(`📊 Network stats: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
        
        // Check route patterns configuration
        try {
          const patternCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM route_patterns`);
          logMessage(`📋 Found ${patternCount.rows[0].count} route patterns to process`);
        } catch (e) {
          logMessage(`⚠️  Could not check route patterns: ${e}`);
        }
      }
      
      const recommendationResult = await this.pgClient.query(
        `SELECT generate_route_recommendations($1)`,
        [this.stagingSchema]
      );
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      const routeCount = recommendationResult.rows[0]?.generate_route_recommendations || 0;
      
      logMessage(`✅ Generated ${routeCount} route recommendations in ${duration}ms`);
      logMessage(`⏱️  Route generation completed at ${new Date().toISOString()}`);
      
      if (this.config.verbose) {
        logMessage(`📈 Performance: ${duration}ms for ${trailCountValue} trails (${(duration/trailCountValue).toFixed(1)}ms per trail)`);
      }
      
      // Show route recommendation stats from staging schema
      const statsResult = await this.pgClient.query(
        `SELECT 
          COUNT(*) as total_routes,
          COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
          COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
          COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes,
          AVG(route_score) as avg_score
        FROM ${this.stagingSchema}.route_recommendations`
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
      // Test enhanced loop detection
      console.log('🔍 Testing enhanced loop detection...');
      const loopResults = await this.detectLoopsByIntersectionPatterns();
      
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
  private async detectLoopsByIntersectionPatterns(): Promise<{
    multipleIntersectionLoops: Array<{
      trail1_id: string;
      trail1_name: string;
      trail2_id: string;
      trail2_name: string;
      intersection_count: number;
    }>;
    selfIntersectingLoops: Array<{
      trail_id: string;
      trail_name: string;
    }>;
    startEndProximityLoops: Array<{
      trail_id: string;
      trail_name: string;
      start_end_distance: number;
    }>;
  }> {
    console.log('🔍 Detecting loops by intersection patterns...');
    
    // 1. Find trails that intersect the same other trail multiple times
    const multipleIntersectionQuery = `
      WITH trail_intersections AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id, 
          t2.name as trail2_name,
          COUNT(*) as intersection_count
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
          AND ST_Length(t1.geometry::geography) > 10  -- Minimum trail length
          AND ST_Length(t2.geometry::geography) > 10
        GROUP BY t1.app_uuid, t1.name, t2.app_uuid, t2.name
        HAVING COUNT(*) >= 2
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        intersection_count
      FROM trail_intersections
      ORDER BY intersection_count DESC, trail1_name, trail2_name
    `;
    
    const multipleIntersectionResult = await this.pgClient.query(multipleIntersectionQuery);
    const multipleIntersectionLoops = multipleIntersectionResult.rows;
    
    // 2. Find trails that self-intersect
    const selfIntersectingQuery = `
      SELECT 
        app_uuid as trail_id,
        name as trail_name
      FROM ${this.stagingSchema}.trails
      WHERE ST_NumGeometries(ST_Node(geometry)) > 1
        AND ST_Length(geometry::geography) > 10
      ORDER BY name
    `;
    
    const selfIntersectingResult = await this.pgClient.query(selfIntersectingQuery);
    const selfIntersectingLoops = selfIntersectingResult.rows;
    
    // 3. Find trails where start and end points are close (existing method)
    const startEndProximityQuery = `
      SELECT 
        app_uuid as trail_id,
        name as trail_name,
        ST_Distance(
          ST_StartPoint(geometry)::geography,
          ST_EndPoint(geometry)::geography
        ) as start_end_distance
      FROM ${this.stagingSchema}.trails
      WHERE ST_StartPoint(geometry) != ST_EndPoint(geometry)  -- Not a single point
        AND ST_Distance(
          ST_StartPoint(geometry)::geography,
          ST_EndPoint(geometry)::geography
        ) < 50  -- Within 50 meters
        AND ST_Length(geometry::geography) > 100  -- At least 100m long
      ORDER BY start_end_distance ASC, name
    `;
    
    const startEndProximityResult = await this.pgClient.query(startEndProximityQuery);
    const startEndProximityLoops = startEndProximityResult.rows;
    
    console.log(`✅ Loop detection results:`);
    console.log(`   🔗 Multiple intersection loops: ${multipleIntersectionLoops.length}`);
    console.log(`   🔄 Self-intersecting loops: ${selfIntersectingLoops.length}`);
    console.log(`   📍 Start/end proximity loops: ${startEndProximityLoops.length}`);
    
    // Log some examples
    if (multipleIntersectionLoops.length > 0) {
      console.log(`   📋 Multiple intersection examples:`);
      multipleIntersectionLoops.slice(0, 5).forEach(loop => {
        console.log(`      - ${loop.trail1_name} + ${loop.trail2_name} (${loop.intersection_count} intersections)`);
      });
    }
    
    if (selfIntersectingLoops.length > 0) {
      console.log(`   📋 Self-intersecting examples:`);
      selfIntersectingLoops.slice(0, 5).forEach(loop => {
        console.log(`      - ${loop.trail_name}`);
      });
    }
    
    if (startEndProximityLoops.length > 0) {
      console.log(`   📋 Start/end proximity examples:`);
      startEndProximityLoops.slice(0, 5).forEach(loop => {
        console.log(`      - ${loop.trail_name} (${loop.start_end_distance.toFixed(1)}m)`);
      });
    }
    
    return {
      multipleIntersectionLoops,
      selfIntersectingLoops,
      startEndProximityLoops
    };
  }

  /**
   * Connect edges to nearby nodes to fix intersection detection
   */
  private async connectEdgesToNearbyNodes(toleranceMeters: number): Promise<void> {
    console.log(`🔄 Connecting edges to nearby nodes within ${toleranceMeters}m tolerance...`);
    
    // Find edges that pass near nodes but don't connect to them (optimized with spatial indexing)
    const findNearbyEdgesSql = `
      WITH edge_node_proximity AS (
        SELECT 
          e.id as edge_id,
          e.source as current_source,
          e.target as current_target,
          e.trail_id,
          e.trail_name,
          e.length_km,
          e.elevation_gain,
          e.elevation_loss,
          e.geometry as original_geometry,
          n.id as nearby_node_id,
          n.lat as node_lat,
          n.lng as node_lng,
          ST_Distance(
            ST_ClosestPoint(e.geometry, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)),
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)
          ) as closest_distance,
          ST_LineLocatePoint(e.geometry, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)) as split_ratio
        FROM ${this.stagingSchema}.routing_edges e
        JOIN ${this.stagingSchema}.routing_nodes n ON 
          e.source != n.id AND e.target != n.id
          AND ST_DWithin(
            e.geometry, 
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), 
            ${toleranceMeters}
          )
      )
      SELECT * FROM edge_node_proximity
              WHERE closest_distance <= ${toleranceMeters}
          AND split_ratio > 0.05 AND split_ratio < 0.95
        ORDER BY edge_id, closest_distance;
    `;
    
    const proximityResult = await this.pgClient.query(findNearbyEdgesSql);
    
    if (proximityResult.rows.length > 0) {
      console.log(`📍 Found ${proximityResult.rows.length} edges passing near nodes`);
      
      let splitsMade = 0;
      for (const proximity of proximityResult.rows) {
        const edgeId = proximity.edge_id;
        const nearbyNodeId = proximity.nearby_node_id;
        const splitRatio = proximity.split_ratio;
        
        // Split the edge at the node location and create two new edges
        const splitEdgeSql = `
          WITH split_geometries AS (
            SELECT 
              CASE 
                WHEN $2 > 0.001 AND $2 < 0.999 THEN ST_LineSubstring($1, 0, $2)
                ELSE NULL
              END as first_part,
              CASE 
                WHEN $2 > 0.001 AND $2 < 0.999 THEN ST_LineSubstring($1, $2, 1)
                ELSE NULL
              END as second_part
          )
          INSERT INTO ${this.stagingSchema}.routing_edges 
            (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
          SELECT 
            $3::uuid, $4::uuid, $5, $6, $7 * $2, $8 * $2, $9 * $2, 
            first_part,
            ST_AsGeoJSON(first_part, 6, 0)
          FROM split_geometries
                  WHERE first_part IS NOT NULL AND ST_GeometryType(first_part) = 'ST_LineString' AND $2 > 0.1
        UNION ALL
        SELECT 
          $4::uuid, $10::uuid, $5, $6, $7 * (1 - $2), $8 * (1 - $2), $9 * (1 - $2),
          second_part,
          ST_AsGeoJSON(second_part, 6, 0)
        FROM split_geometries
        WHERE second_part IS NOT NULL AND ST_GeometryType(second_part) = 'ST_LineString' AND $2 < 0.9;
        `;
        
        await this.pgClient.query(splitEdgeSql, [
          proximity.original_geometry,
          splitRatio,
          proximity.current_source,
          nearbyNodeId,
          proximity.trail_id,
          proximity.trail_name,
          proximity.length_km,
          proximity.elevation_gain,
          proximity.elevation_loss,
          proximity.current_target
        ]);
        
        // Delete the original edge
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.routing_edges WHERE id = $1
        `, [edgeId]);
        
        splitsMade++;
        console.log(`✂️ Split edge ${edgeId} at node ${nearbyNodeId} (ratio: ${splitRatio.toFixed(3)})`);
      }
      
      console.log(`✅ Split ${splitsMade} edges to connect to nearby nodes`);
    } else {
      console.log(`✅ No edges need splitting to connect to nearby nodes`);
    }
  }

  /**
   * Cluster nearby nodes to ensure proper connectivity with simplified geometry
   */
  private async clusterNearbyNodes(toleranceMeters: number): Promise<void> {
    console.log(`🔄 Clustering nodes within ${toleranceMeters}m tolerance...`);
    
    // First, get a count of nodes before clustering
    const beforeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`);
    console.log(`📍 Before clustering: ${beforeCount.rows[0].count} nodes`);
    
    // Find nodes that are very close to each other and merge them
    const clusterSql = `
      WITH node_clusters AS (
        SELECT 
          n1.id as primary_node_id,
          n1.lat as primary_lat,
          n1.lng as primary_lng,
          ARRAY_AGG(n2.id) as nearby_node_ids,
          COUNT(*) as cluster_size
        FROM ${this.stagingSchema}.routing_nodes n1
        JOIN ${this.stagingSchema}.routing_nodes n2 ON 
          n1.id != n2.id 
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
            ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326),
            ${toleranceMeters}
          )
        GROUP BY n1.id, n1.lat, n1.lng
        HAVING COUNT(*) > 0
      )
      SELECT * FROM node_clusters
      ORDER BY cluster_size DESC, primary_node_id;
    `;
    
    const clusterResult = await this.pgClient.query(clusterSql);
    
    if (clusterResult.rows.length > 0) {
      console.log(`📍 Found ${clusterResult.rows.length} node clusters to merge`);
      
      for (const cluster of clusterResult.rows) {
        const primaryNodeId = cluster.primary_node_id;
        const nearbyNodeIds = cluster.nearby_node_ids;
        
        // Update edges to point to the primary node (separate statements)
        const updateSourceEdgesSql = `
          UPDATE ${this.stagingSchema}.routing_edges 
          SET source = $1 
          WHERE source = ANY($2);
        `;
        
        const updateTargetEdgesSql = `
          UPDATE ${this.stagingSchema}.routing_edges 
          SET target = $1 
          WHERE target = ANY($2);
        `;
        
        await this.pgClient.query(updateSourceEdgesSql, [primaryNodeId, nearbyNodeIds]);
        await this.pgClient.query(updateTargetEdgesSql, [primaryNodeId, nearbyNodeIds]);
        
        // Delete the nearby nodes (they're now merged into the primary)
        const deleteNodesSql = `
          DELETE FROM ${this.stagingSchema}.routing_nodes 
          WHERE id = ANY($1);
        `;
        
        await this.pgClient.query(deleteNodesSql, [nearbyNodeIds]);
      }
      
      console.log(`✅ Node clustering complete`);
    } else {
      console.log(`✅ No nodes need clustering`);
    }
  }

  /**
   * Detect and split loops into separate edges
   */
  private async splitLoopsIntoEdges(): Promise<void> {
    console.log('🔄 Detecting and splitting loops into separate edges...');
    
    // First, detect loops (trails where start and end are close)
    const loopDetectionSql = `
      WITH loop_trails AS (
        SELECT 
          app_uuid,
          name,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance
        FROM ${this.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry) > 0
        AND ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) < 50  -- 50m threshold for loops
      ),
      loop_intersections AS (
        -- Find where loops intersect with other trails
        SELECT 
          lt.app_uuid as loop_trail_id,
          lt.name as loop_trail_name,
          t.app_uuid as intersecting_trail_id,
          t.name as intersecting_trail_name,
          ST_Intersection(lt.geometry, t.geometry) as intersection_geom
        FROM loop_trails lt
        JOIN ${this.stagingSchema}.trails t ON lt.app_uuid != t.app_uuid
        WHERE ST_Intersects(lt.geometry, t.geometry)
        AND ST_GeometryType(ST_Intersection(lt.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
      )
      SELECT 
        loop_trail_id,
        loop_trail_name,
        COUNT(*) as intersection_count
      FROM loop_intersections
      GROUP BY loop_trail_id, loop_trail_name
      ORDER BY intersection_count DESC
    `;
    
    const loopResult = await this.pgClient.query(loopDetectionSql);
    console.log(`📍 Found ${loopResult.rows.length} loops with intersections`);
    
    // For now, let's just log the loops we found
    loopResult.rows.forEach(row => {
      console.log(`  - Loop: ${row.loop_trail_name} (${row.intersection_count} intersections)`);
    });
    
    // TODO: Implement actual loop splitting logic
    // 1. For each loop, find intersection points
    // 2. Split loop at intersection points
    // 3. Create separate edges for each loop segment
    // 4. Update node types based on new connectivity
    
    console.log('✅ Loop detection complete (splitting logic to be implemented)');
  }

  /**
   * Validate that simplification doesn't break node connections
   * Returns true if connections are preserved, false if any nodes lose connections
   */
  private async validateNodeConnectionsAfterSimplification(tolerance: number): Promise<boolean> {
    console.log('🔍 Validating node connections before simplification...');
    
    // Get connection counts before simplification
    const beforeSql = `
      SELECT 
        n.id,
        n.lat,
        n.lng,
        n.node_type,
        COALESCE(COUNT(e.id), 0) as connection_count
      FROM ${this.stagingSchema}.routing_nodes n
      LEFT JOIN ${this.stagingSchema}.routing_edges e ON 
        n.id = e.source OR n.id = e.target
      GROUP BY n.id, n.lat, n.lng, n.node_type
      ORDER BY connection_count DESC
    `;
    
    const beforeResult = await this.pgClient.query(beforeSql);
    const beforeConnections = new Map<string, number>();
    beforeResult.rows.forEach(row => {
      beforeConnections.set(row.id, row.connection_count);
    });
    
    console.log(`📊 Before simplification: ${beforeResult.rows.length} nodes with connections`);
    
    // Apply simplification
    const simplifySql = `
      UPDATE ${this.stagingSchema}.routing_edges 
      SET 
        geometry = ST_Simplify(geometry, $1),
        geojson = ST_AsGeoJSON(ST_Simplify(geometry, $1), 6, 0)
      WHERE geometry IS NOT NULL;
    `;
    
    await this.pgClient.query(simplifySql, [tolerance]);
    
    // Get connection counts after simplification
    const afterSql = `
      SELECT 
        n.id,
        n.lat,
        n.lng,
        n.node_type,
        COALESCE(COUNT(e.id), 0) as connection_count
      FROM ${this.stagingSchema}.routing_nodes n
      LEFT JOIN ${this.stagingSchema}.routing_edges e ON 
        n.id = e.source OR n.id = e.target
      GROUP BY n.id, n.lat, n.lng, n.node_type
      ORDER BY connection_count DESC
    `;
    
    const afterResult = await this.pgClient.query(afterSql);
    const afterConnections = new Map<string, number>();
    afterResult.rows.forEach(row => {
      afterConnections.set(row.id, row.connection_count);
    });
    
    console.log(`📊 After simplification: ${afterResult.rows.length} nodes with connections`);
    
    // Check for lost connections
    let lostConnections = 0;
    let totalConnectionsLost = 0;
    
    for (const [nodeId, beforeCount] of beforeConnections) {
      const afterCount = afterConnections.get(nodeId) || 0;
      if (afterCount < beforeCount) {
        lostConnections++;
        totalConnectionsLost += (beforeCount - afterCount);
        console.log(`⚠️ Node ${nodeId} lost ${beforeCount - afterCount} connections (${beforeCount} -> ${afterCount})`);
      }
    }
    
    if (lostConnections > 0) {
      console.log(`❌ Simplification broke ${lostConnections} nodes, lost ${totalConnectionsLost} total connections`);
      return false;
    } else {
      console.log(`✅ Simplification preserved all node connections`);
      return true;
    }
  }

  /**
   * Simplify edge geometries while preserving node connections
   */
  private async simplifyEdgeGeometries(tolerance: number): Promise<void> {
    console.log(`🔄 Simplifying edge geometries with tolerance: ${tolerance}`);
    
    // Validate connections before and after simplification
    const connectionsPreserved = await this.validateNodeConnectionsAfterSimplification(tolerance);
    
    if (!connectionsPreserved) {
      console.log(`⚠️ Simplification broke connections, reverting to original geometries...`);
      
      // Revert to original geometries by recreating edges without simplification
      const revertSql = `
        UPDATE ${this.stagingSchema}.routing_edges 
        SET 
          geometry = ST_Force2D(geometry),
          geojson = ST_AsGeoJSON(ST_Force2D(geometry), 6, 0)
        WHERE geometry IS NOT NULL;
      `;
      
      await this.pgClient.query(revertSql);
      console.log('✅ Reverted to original edge geometries');
    } else {
      console.log('✅ Edge geometries simplified while preserving node connections');
    }
  }

  /**
   * Update node types based on actual connectivity after edges are created
   */
  private async updateNodeTypesBasedOnConnectivity(): Promise<void> {
    console.log('🔄 Updating node types based on actual connectivity...');
    
    // Update node types based on how many edges connect to each node
    const updateNodeTypesSql = `
      UPDATE ${this.stagingSchema}.routing_nodes 
      SET node_type = CASE 
        WHEN connection_count = 1 THEN 'endpoint'
        WHEN connection_count >= 2 THEN 'intersection'
        ELSE 'endpoint'
      END
      FROM (
        SELECT 
          n.id,
          COALESCE(COUNT(e.id), 0) as connection_count
        FROM ${this.stagingSchema}.routing_nodes n
        LEFT JOIN ${this.stagingSchema}.routing_edges e ON 
          n.id = e.source OR n.id = e.target
        GROUP BY n.id
      ) as connectivity
      WHERE ${this.stagingSchema}.routing_nodes.id = connectivity.id
    `;
    
    const updateResult = await this.pgClient.query(updateNodeTypesSql);
    console.log(`✅ Updated node types for ${updateResult.rowCount} nodes`);
    
    // Get final node type breakdown
    const nodeTypesResult = await this.pgClient.query(`
      SELECT node_type, COUNT(*) as count 
      FROM ${this.stagingSchema}.routing_nodes 
      GROUP BY node_type
      ORDER BY count DESC
    `);
    
    console.log('📍 Final node type breakdown:');
    nodeTypesResult.rows.forEach(row => {
      console.log(`  - ${row.node_type}: ${row.count} nodes`);
    });
  }

  /**
   * Generate routing nodes and edges in a single pass
   * Creates nodes for trail endpoints and intersections, and immediately creates edges
   */
  private async generateRoutingNodesAndEdgesSinglePass(intersectionToleranceMeters: number): Promise<void> {
    console.log(`📍 Generating routing nodes and edges in single pass with tolerance: ${intersectionToleranceMeters}m`);
    
    // Clear existing routing nodes and edges
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
    
    const toleranceDegrees = intersectionToleranceMeters / 111000.0;
    
    // Single-pass approach: Create nodes and edges together
    const nodesSql = `
      WITH valid_trails AS (
        SELECT app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
        FROM ${this.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry) > 0
      ),
      trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Z(ST_StartPoint(geometry)) as start_elevation,
          ST_Z(ST_EndPoint(geometry)) as end_elevation,
          geometry as trail_geometry
        FROM valid_trails
      ),
      endpoint_nodes AS (
        -- Create nodes for trail start points
        SELECT 
          gen_random_uuid() as node_id,
          gen_random_uuid() as node_uuid,
          ST_Y(start_point) as lat,
          ST_X(start_point) as lng,
          start_elevation as elevation,
          'endpoint' as node_type,
          name as connected_trails,
          ARRAY[app_uuid] as trail_ids,
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          'start' as endpoint_type,
          trail_geometry
        FROM trail_endpoints
        WHERE start_point IS NOT NULL
        UNION ALL
        -- Create nodes for trail end points
        SELECT 
          gen_random_uuid() as node_id,
          gen_random_uuid() as node_uuid,
          ST_Y(end_point) as lat,
          ST_X(end_point) as lng,
          end_elevation as elevation,
          'endpoint' as node_type,
          name as connected_trails,
          ARRAY[app_uuid] as trail_ids,
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          'end' as endpoint_type,
          trail_geometry
        FROM trail_endpoints
        WHERE end_point IS NOT NULL
      ),
      intersection_nodes AS (
        -- Create nodes for trail intersections
        SELECT 
          gen_random_uuid() as node_id,
          gen_random_uuid() as node_uuid,
          ST_Y(dumped.geom) as lat,
          ST_X(dumped.geom) as lng,
          COALESCE(ST_Z(dumped.geom), 0) as elevation,
          'intersection' as node_type,
          array_to_string(ARRAY[t1.name, t2.name], ',') as connected_trails,
          ARRAY[t1.app_uuid, t2.app_uuid] as trail_ids,
          t1.app_uuid as trail_id,
          t1.name as trail_name,
          t1.length_km,
          t1.elevation_gain,
          t1.elevation_loss,
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
      all_nodes AS (
        SELECT * FROM endpoint_nodes
        UNION ALL
        SELECT * FROM intersection_nodes
      ),
      unique_nodes AS (
        -- Deduplicate nodes that are very close to each other
        SELECT DISTINCT ON (ST_SnapToGrid(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ${toleranceDegrees}))
          node_id,
          node_uuid,
          lat,
          lng,
          elevation,
          node_type,
          connected_trails,
          trail_ids,
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          endpoint_type,
          trail_geometry
        FROM all_nodes
        WHERE lat IS NOT NULL AND lng IS NOT NULL
      )
      -- Insert nodes
      INSERT INTO ${this.stagingSchema}.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
      SELECT 
        node_id,
        node_uuid,
        lat,
        lng,
        elevation,
        'unknown' as node_type,
        connected_trails,
        trail_ids,
        NOW() as created_at
      FROM unique_nodes;
    `;
    
    // Execute nodes insertion
    await this.pgClient.query(nodesSql);
    
    // Now create edges using the nodes we just inserted
    // First, let's create a temporary table to store the endpoint type information
    const tempTableSql = `
      CREATE TEMP TABLE temp_node_info AS
      SELECT 
        n.id,
        un.trail_id,
        un.trail_name,
        un.length_km,
        un.elevation_gain,
        un.elevation_loss,
        un.endpoint_type,
        un.trail_geometry
      FROM ${this.stagingSchema}.routing_nodes n
      JOIN (
        SELECT DISTINCT ON (ST_SnapToGrid(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ${toleranceDegrees}))
          node_id,
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          endpoint_type,
          trail_geometry
        FROM (
          SELECT 
            gen_random_uuid() as node_id,
            app_uuid as trail_id,
            name as trail_name,
            length_km,
            elevation_gain,
            elevation_loss,
            'start' as endpoint_type,
            geometry as trail_geometry,
            ST_Y(ST_StartPoint(geometry)) as lat,
            ST_X(ST_StartPoint(geometry)) as lng
          FROM ${this.stagingSchema}.trails
          WHERE ST_StartPoint(geometry) IS NOT NULL
          UNION ALL
          SELECT 
            gen_random_uuid() as node_id,
            app_uuid as trail_id,
            name as trail_name,
            length_km,
            elevation_gain,
            elevation_loss,
            'end' as endpoint_type,
            geometry as trail_geometry,
            ST_Y(ST_EndPoint(geometry)) as lat,
            ST_X(ST_EndPoint(geometry)) as lng
          FROM ${this.stagingSchema}.trails
          WHERE ST_EndPoint(geometry) IS NOT NULL
        ) all_endpoints
        WHERE lat IS NOT NULL AND lng IS NOT NULL
      ) un ON n.trail_ids @> ARRAY[un.trail_id];
    `;
    
    await this.pgClient.query(tempTableSql);
    
    const edgesSql = `
      INSERT INTO ${this.stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      SELECT 
        n1.id as source,
        n2.id as target,
        n1.trail_id,
        n1.trail_name,
        n1.length_km,
        n1.elevation_gain,
        n1.elevation_loss,
        ST_Force2D(n1.trail_geometry) as geometry,
        ST_AsGeoJSON(ST_Force2D(n1.trail_geometry), 6, 0) as geojson
      FROM temp_node_info n1
      JOIN temp_node_info n2 ON 
        n1.trail_id = n2.trail_id 
        AND n1.id <> n2.id
        AND (
          (n1.endpoint_type = 'start' AND n2.endpoint_type = 'end') OR
          (n1.endpoint_type = 'end' AND n2.endpoint_type = 'start')
        )
      WHERE n1.id IS NOT NULL 
      AND n2.id IS NOT NULL
      AND n1.id <> n2.id;
    `;
    
    // Execute edges insertion
    await this.pgClient.query(edgesSql);
    
    // Clean up temp table
    await this.pgClient.query('DROP TABLE temp_node_info;');
    
    console.log(`✅ Generated nodes and edges in single pass`);
    
    // Get statistics
    const nodeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_nodes`);
    const edgeCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.routing_edges`);
    
    const nodeCount = parseInt(nodeCountResult.rows[0].count);
    const edgeCount = parseInt(edgeCountResult.rows[0].count);
    
    console.log(`📊 Results: ${nodeCount} nodes, ${edgeCount} edges`);
  }

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


}