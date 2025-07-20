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

import { Client } from 'pg';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
dotenv.config();
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
}

// Helper function for type-safe tuple validation
function isValidNumberTuple(arr: (number | undefined)[], length: number): arr is [number, number, number] {
  return arr.length === length && arr.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function parseWktCoords(wkt: string): [number, number, number][] {
  return wkt.split(',').map((coord: string): [number, number, number] | undefined => {
    const nums = coord.trim().split(' ').map((n) => {
      const val = Number(n);
      return Number.isFinite(val) ? val : undefined;
    });
    if (nums.length === 3 && nums.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const lng = nums[0] as number;
      const lat = nums[1] as number;
      const elev = nums[2] as number;
      return [lng, lat, elev];
    }
    if (nums.length === 2 && nums.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const lng = nums[0] as number;
      const lat = nums[1] as number;
      return [lng, lat, 0];
    }
    return undefined;
  }).filter((c: [number, number, number] | undefined): c is [number, number, number] => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'number' && Number.isFinite(v)));
}

export class EnhancedPostgresOrchestrator {
  private pgClient: Client;
  private config: EnhancedOrchestratorConfig;
  private stagingSchema: string;
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
    
    this.pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
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
      if (user !== 'tester') {
        console.warn(`⚠️  WARNING: Test environment using user '${user}' instead of 'tester'`);
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
      } catch (err) {
        clearInterval(waitingInterval);
        console.error('❌ Failed to connect to PostgreSQL:', err);
        throw err;
      }

      // Step 1.5: Build master database if requested
      if (this.config.buildMaster) {
        await this.buildMasterDatabase();
        console.log('\n🎉 Master database build completed successfully!');
        console.log('\a'); // Play system bell sound
        return; // Exit after building master database
      }

      // Step 2: Create staging environment
      await this.createStagingEnvironment();

      // Step 3: Copy region data to staging
      if (this.config.bbox) {
        console.log('Using CLI-provided bbox for export:', this.config.bbox);
        // Use bbox to filter trails and as main bbox
        this.regionBbox = {
          minLng: this.config.bbox[0],
          minLat: this.config.bbox[1],
          maxLng: this.config.bbox[2],
          maxLat: this.config.bbox[3],
          trailCount: 0 // Will be updated after filtering
        };
        // Strict validation: fail if bbox is invalid
        if ([this.regionBbox.minLng, this.regionBbox.maxLng, this.regionBbox.minLat, this.regionBbox.maxLat].some(v => v === null || v === undefined || isNaN(v))) {
          throw new Error('❌ Provided bbox is invalid: ' + JSON.stringify(this.config.bbox));
        }
        await this.copyRegionDataToStaging(this.config.bbox);
      } else {
        await this.copyRegionDataToStaging();
      }

      // After copying region data to staging, log trail count and bbox
      const trailCountResult = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`Trail count in staging for region ${this.config.region}:`, trailCountResult.rows[0].count);
      if (this.regionBbox) {
        console.log('Region bbox used for export:', this.regionBbox);
      }

      // Step 4: Detect intersections
      await this.detectIntersections();

      // Step 5: Always split trails at intersections (no skipping/caching)
      await this.splitTrailsAtIntersections();

      // Step 6: Always build routing graph from split trails
      await this.buildRoutingGraph();

      // Step 7: Always export to SpatiaLite (nodes/edges/trails)
      await this.exportToSpatiaLite();

      // Step 8: Cleanup staging
      await this.cleanupStaging();

      console.log('\n🎉 Enhanced orchestrator completed successfully!');
      console.log(`📁 Deployment database ready: ${this.config.outputPath}`);

    } catch (error) {
      console.error('❌ Enhanced orchestrator failed:', error);
      // Always cleanup on error
      await this.cleanupStaging();
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
    
    // Create staging schema
    await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);

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
        created_at TIMESTAMP DEFAULT NOW()
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

    // Create indexes
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_staging_trails_osm_id ON ${this.stagingSchema}.trails(osm_id);
      CREATE INDEX IF NOT EXISTS idx_staging_trails_bbox ON ${this.stagingSchema}.trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
      CREATE INDEX IF NOT EXISTS idx_staging_trails_geometry ON ${this.stagingSchema}.trails USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_staging_split_trails_geometry ON ${this.stagingSchema}.split_trails USING GIST(geometry);
      CREATE INDEX IF NOT EXISTS idx_staging_intersection_points_point ON ${this.stagingSchema}.intersection_points USING GIST(point);
    `);

    console.log('✅ Staging environment created');
  }

  private async copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void> {
    console.log(`📋 Copying ${this.config.region} data to staging...`);
    
    // Validate that region exists in the database before copying
    const regionExists = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM trails WHERE region = $1
    `, [this.config.region]);
    
    if (regionExists.rows[0].count === 0) {
      console.error(`❌ No trails found for region: ${this.config.region}`);
      console.error('   Please ensure the region exists in the database before running the orchestrator.');
      process.exit(1);
    }
    
    // Copy region data to staging, storing both geometry and geometry_text
    let query = `
      INSERT INTO ${this.stagingSchema}.trails (
        id, app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, region, geometry, geometry_text
      )
      SELECT 
        id, app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, region, geometry, ST_AsText(geometry) as geometry_text
      FROM trails 
      WHERE region = $1
    `;
    const params = [this.config.region];

    if (bbox) {
      query += ` AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))`;
      params.push(String(bbox[0]), String(bbox[1]), String(bbox[2]), String(bbox[3]));
    }

    await this.pgClient.query(query, params);
    
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
    
    try {
      // Update the regions table in PostgreSQL
      await this.pgClient.query(`
        UPDATE regions 
        SET 
          bbox_min_lng = $1,
          bbox_max_lng = $2,
          bbox_min_lat = $3,
          bbox_max_lat = $4,
          trail_count = $5,
          last_updated = NOW()
        WHERE region_name = $6
      `, [
        this.regionBbox.minLng,
        this.regionBbox.maxLng,
        this.regionBbox.minLat,
        this.regionBbox.maxLat,
        this.regionBbox.trailCount,
        this.config.region
      ]);

      console.log(`✅ Updated region configuration for ${this.config.region}`);
      console.log(`   - New bbox: ${this.regionBbox.minLng.toFixed(6)}°W to ${this.regionBbox.maxLng.toFixed(6)}°W, ${this.regionBbox.minLat.toFixed(6)}°N to ${this.regionBbox.maxLat.toFixed(6)}°N`);
      console.log(`   - Trail count: ${this.regionBbox.trailCount}`);
      
    } catch (error) {
      console.log('⚠️  Could not update region configuration (regions table may not exist):', error);
    }
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
    console.log('🔍 Detecting trail intersections...');
    
    // Clear existing intersection data
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);

    // FIXED: Use 2D intersection detection for speed, but preserve 3D elevation data
    const result = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.intersection_points (point, point_3d, trail1_id, trail2_id, distance_meters)
      SELECT DISTINCT 
        intersection_point_2d,
        intersection_point_3d,
        trail1_id,
        trail2_id,
        distance_meters
      FROM (
        -- Case 1: Exact geometric intersections (trails cross) - 2D detection, 3D elevation
        SELECT 
          ST_Force2D(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) as intersection_point_2d,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point_3d,
          t1.id as trail1_id,
          t2.id as trail2_id,
          0 as distance_meters
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON (
          t1.id < t2.id AND 
          ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) AND
          ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) = 'ST_Point'
        )
        
        UNION ALL
        
        -- Case 2: Near-miss intersections (trails come close but don't cross) - 2D detection, interpolate 3D elevation
        SELECT 
          ST_ClosestPoint(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_point_2d,
          ST_Force3D(ST_ClosestPoint(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)), 0) as intersection_point_3d,
          t1.id as trail1_id,
          t2.id as trail2_id,
          ST_Distance(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as distance_meters
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON (
          t1.id < t2.id AND 
          NOT ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) AND
          ST_DWithin(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry), $1)
        )
      ) intersections
      WHERE distance_meters <= $1
    `, [this.config.intersectionTolerance]);

    console.log(`✅ Found ${result.rowCount} intersection points (exact + near-miss)`);

    // Load intersection data into memory for processing
    const intersections = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.intersection_points
      ORDER BY trail1_id, trail2_id
    `);

    // Group intersections by trail (use 3D points for elevation data)
    for (const intersection of intersections.rows) {
      const point3d = intersection.point_3d;
      const coords3d = point3d.match(/POINTZ?\(([^)]+)\)/);
      if (coords3d) {
        const parts = coords3d[1].split(' ');
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const elevation = parts.length > 2 ? parseFloat(parts[2]) : 0;
        
        // Add to trail1
        if (!this.splitPoints.has(intersection.trail1_id)) {
          this.splitPoints.set(intersection.trail1_id, []);
        }
        this.splitPoints.get(intersection.trail1_id)!.push({
          coordinate: [lng, lat, elevation] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
          visitorTrailId: intersection.trail2_id, visitorTrailName: ''
        });

        // Add to trail2
        if (!this.splitPoints.has(intersection.trail2_id)) {
          this.splitPoints.set(intersection.trail2_id, []);
        }
        this.splitPoints.get(intersection.trail2_id)!.push({
          coordinate: [lng, lat, elevation] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
          visitorTrailId: intersection.trail1_id, visitorTrailName: ''
        });
      }
    }

    // Get trail names for visitor trails
    for (const [trailId, points] of this.splitPoints) {
      for (const point of points) {
        const result = await this.pgClient.query(`
          SELECT name FROM ${this.stagingSchema}.trails WHERE id = $1
        `, [point.visitorTrailId]);
        if (result.rows.length > 0) {
          point.visitorTrailName = result.rows[0].name;
        }
      }
    }
  }

  private async splitTrailsAtIntersections(): Promise<void> {
    console.log('✂️  Splitting trails at intersections...');
    
    // Check if we can use cached splits
    const changedTrails = await this.getChangedTrails();
    
    if (changedTrails.length === 0) {
      console.log('✅ No trail changes detected - using cached splits');
      return;
    }
    
    console.log(`🔄 Processing ${changedTrails.length} changed trails...`);
    
    // Clear existing split trails for changed trails only
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.split_trails 
      WHERE original_trail_id IN (SELECT id FROM ${this.stagingSchema}.trails WHERE app_uuid = ANY($1))
    `, [changedTrails]);

    // Fetch trails from staging as WKT for splitting
    const trails = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
    `);

    let totalSegments = 0;

    for (const trail of trails.rows) {
      const intersections = this.splitPoints.get(trail.id) || [];
      
      if (intersections.length === 0) {
        // No intersections, copy trail as-is
        await this.insertSplitTrail(trail, 1, trail.geometry_text);
        totalSegments++;
        continue;
      }

      // Find split points along the trail geometry
      const splitPoints = await this.findSplitPointsAlongTrail(trail, intersections);
      
      if (splitPoints.length < 2) {
        // No meaningful splits, copy trail as-is
        await this.insertSplitTrail(trail, 1, trail.geometry_text);
        totalSegments++;
        continue;
      }

      // Split trail at points
      const segments: string[] = [];
      for (let i = 0; i < splitPoints.length - 1; i++) {
        const segment = segments[i];
        if (segment) {
          await this.insertSplitTrail(trail, i + 1, segment);
        }
        totalSegments++;
      }
    }

    console.log(`✅ Created ${totalSegments} trail segments for changed trails`);
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

  private async findSplitPointsAlongTrail(trail: any, intersections: IntersectionPoint[]): Promise<any[]> {
    // Use geometry_text (WKT)
    const geomText = trail.geometry_text;
    const coordsMatch = geomText.match(/LINESTRING(?: Z)?\s*\(([^)]+)\)/);
    if (!coordsMatch) return [];

    const coords: [number, number, number][] = coordsMatch && typeof coordsMatch[1] === 'string' ? parseWktCoords(coordsMatch[1]) : [];

    // Find closest coordinate indices for each intersection point
    const splitIndices: { idx: number; point: IntersectionPoint | null }[] = [];
    for (const intersection of intersections) {
      let minDist = Infinity;
      let minIdx = -1;

      for (let i = 0; i < coords.length; i++) {
        // Only pass [lng, lat] as Coordinate2D
        const coord = coords[i];
        if (!coord) continue;
        const [lng, lat] = coord;
        const dist = this.calculateDistance([intersection.coordinate[0], intersection.coordinate[1]], [lng, lat]);
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      }

      if (minDist <= this.config.intersectionTolerance) {
        splitIndices.push({ idx: minIdx, point: intersection });
      }
    }

    // Sort by index and add start/end points
    splitIndices.sort((a, b) => a.idx - b.idx);
    
    if (splitIndices.length > 0 && splitIndices[0] && splitIndices[splitIndices.length - 1]) {
      if (splitIndices[0].idx !== 0) splitIndices.unshift({ idx: 0, point: null });
      const lastIndex = splitIndices[splitIndices.length - 1];
      if (lastIndex && lastIndex.idx !== coords.length - 1) {
        splitIndices.push({ idx: coords.length - 1, point: null });
      }
    }

    return splitIndices;
  }

  private async splitTrailAtPoints(trail: any, splitPoints: any[]): Promise<string[]> {
    // Use geometry_text (WKT)
    const geomText = trail.geometry_text;
    // Handle both LINESTRING and LINESTRING Z formats
    const coordsMatch = geomText.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/);
    if (!coordsMatch) return [];

    const coords: [number, number, number][] = coordsMatch ? parseWktCoords(coordsMatch[1]) : [];

    const segments = [];
    const hasZ = coords.length > 0 && coords[0] && coords[0].length === 3; // Check if we have Z coordinates

    for (let i = 0; i < splitPoints.length - 1; i++) {
      const startIdx = splitPoints[i].idx;
      const endIdx = splitPoints[i + 1].idx;
      
      if (endIdx <= startIdx) continue;

      const segmentCoords = coords.slice(startIdx, endIdx + 1);
      if (segmentCoords.length < 2) continue;

      // Generate WKT with or without Z coordinates
      let segmentWkt;
      if (hasZ) {
        segmentWkt = `LINESTRING Z(${segmentCoords.map((coord: [number, number, number]) => `${coord[0]} ${coord[1]} ${coord[2]}`).join(',')})`;
      } else {
        segmentWkt = `LINESTRING(${segmentCoords.map((coord: [number, number, number]) => `${coord[0]} ${coord[1]}`).join(',')})`;
      }
      segments.push(segmentWkt);
    }

    return segments;
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
    console.log('🔗 Building routing graph using PostGIS (2D detection, 3D elevation)...');
    
    // Clear existing routing data
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);

    // Check if split trails exist, otherwise use original trails
    let trailsTable = 'split_trails';
    let trails: { rows: any[] } = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trails 
      WHERE geometry IS NOT NULL
    `);
    
    if (trails.rows[0].count === 0) {
      console.log('ℹ️  No split trails found, using original trails for routing graph...');
      trailsTable = 'trails';
    } else {
      console.log(`ℹ️  Using ${trails.rows[0].count} split trails for routing graph...`);
    }

    console.log(`📊 Building routing graph from ${trailsTable}...`);

    // Create routing nodes using PostGIS - ONLY at intersections and endpoints
    const nodeResult = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
      WITH intersection_points AS (
        -- Get intersection points with 3D elevation (these are the primary nodes)
        SELECT 
          ST_X(point_3d) as lng,
          ST_Y(point_3d) as lat,
          ST_Z(point_3d) as elevation,
          array_agg(DISTINCT t1.app_uuid) as connected_trails,
          'intersection' as node_type
        FROM ${this.stagingSchema}.intersection_points ip
        JOIN ${this.stagingSchema}.${trailsTable} t1 ON ip.trail1_id = t1.id
        GROUP BY point_3d
        
        UNION ALL
        
        SELECT 
          ST_X(point_3d) as lng,
          ST_Y(point_3d) as lat,
          ST_Z(point_3d) as elevation,
          array_agg(DISTINCT t2.app_uuid) as connected_trails,
          'intersection' as node_type
        FROM ${this.stagingSchema}.intersection_points ip
        JOIN ${this.stagingSchema}.${trailsTable} t2 ON ip.trail2_id = t2.id
        GROUP BY point_3d
      ),
      trail_endpoints AS (
        -- Get start and end points of all trails with 3D elevation
        SELECT 
          app_uuid,
          ST_X(ST_StartPoint(geometry)) as lng,
          ST_Y(ST_StartPoint(geometry)) as lat,
          ST_Z(ST_StartPoint(geometry)) as elevation,
          'start' as point_type
        FROM ${this.stagingSchema}.${trailsTable} 
        WHERE geometry IS NOT NULL
        
        UNION ALL
        
        SELECT 
          app_uuid,
          ST_X(ST_EndPoint(geometry)) as lng,
          ST_Y(ST_EndPoint(geometry)) as lat,
          ST_Z(ST_EndPoint(geometry)) as elevation,
          'end' as point_type
        FROM ${this.stagingSchema}.${trailsTable} 
        WHERE geometry IS NOT NULL
      ),
      all_points AS (
        -- First, add intersection points (these are the most important)
        SELECT 
          lng, lat, elevation, connected_trails, node_type
        FROM intersection_points
        
        UNION ALL
        
        -- Then add endpoint points, but only if they're not already covered by intersections
        SELECT 
          te.lng, te.lat, te.elevation, 
          ARRAY[te.app_uuid] as connected_trails,
          'endpoint' as node_type
        FROM trail_endpoints te
        WHERE NOT EXISTS (
          SELECT 1 FROM intersection_points ip 
          WHERE ST_DWithin(
            ST_SetSRID(ST_Point(te.lng, te.lat), 4326), 
            ST_SetSRID(ST_Point(ip.lng, ip.lat), 4326), 
            0.001
          )
        )
      ),
      grouped_points AS (
        -- Group points by location (2D grouping, keep 3D elevation)
        SELECT 
          lng, lat, elevation,
          array_agg(DISTINCT trail_uuid) as connected_trails,
          CASE 
            WHEN array_length(array_agg(DISTINCT trail_uuid), 1) > 1 THEN 'intersection'
            ELSE 'endpoint'
          END as node_type
        FROM (
          SELECT 
            lng, lat, elevation,
            unnest(connected_trails) as trail_uuid
          FROM all_points
        ) expanded
        GROUP BY lng, lat, elevation
      )
      SELECT 
        gen_random_uuid()::text as node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        array_to_string(connected_trails, ',') as connected_trails
      FROM grouped_points
      RETURNING *
    `);

    console.log(`✅ Created ${nodeResult.rowCount} routing nodes using PostGIS`);

    // Create routing edges using PostGIS
    const edgeResult = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
      WITH trail_segments AS (
        SELECT 
          t.app_uuid,
          t.name,
          t.elevation_gain,
          t.length_km,
          ST_StartPoint(t.geometry) as start_point,
          ST_EndPoint(t.geometry) as end_point
        FROM ${this.stagingSchema}.${trailsTable} t
        WHERE t.geometry IS NOT NULL
      ),
      node_mapping AS (
        SELECT 
          id,
          ST_SetSRID(ST_Point(lng, lat), 4326) as point
        FROM ${this.stagingSchema}.routing_nodes
      )
      SELECT 
        n1.id as from_node_id,
        n2.id as to_node_id,
        ts.app_uuid as trail_id,
        ts.name as trail_name,
        ts.length_km as distance_km,
        ts.elevation_gain
      FROM trail_segments ts
      JOIN node_mapping n1 ON ST_DWithin(ts.start_point, n1.point, 0.001)
      JOIN node_mapping n2 ON ST_DWithin(ts.end_point, n2.point, 0.001)
      WHERE n1.id != n2.id
      RETURNING *
    `);

    console.log(`✅ Created ${edgeResult.rowCount} routing edges using PostGIS`);
    
    // Verify the data was inserted correctly
    const nodeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`);
    const edgeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`);
    
    console.log(`🔍 Verification: ${nodeCount.rows[0].count} nodes and ${edgeCount.rows[0].count} edges in staging`);
    
    if (nodeCount.rows[0].count === 0) {
      console.warn('⚠️  Warning: No routing nodes were created. This may cause API issues.');
    }
    
    // Add extra logging for node/edge sample
    const nodeSample = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes LIMIT 3`);
    const edgeSample = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_edges LIMIT 3`);
    console.log('🔎 Sample routing nodes:', nodeSample.rows);
    console.log('🔎 Sample routing edges:', edgeSample.rows);
  }

  private async exportToSpatiaLite(): Promise<void> {
    console.log('📤 Exporting processed data to SpatiaLite...');
    
    // Ensure output directory exists
    const outputDir = path.dirname(this.config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Verify database is in the correct location for Docker container
    const expectedContainerPath = path.resolve(__dirname, '../../../api-service/data', `${this.config.region}.db`);
    if (this.config.outputPath !== expectedContainerPath) {
      console.warn(`⚠️  Database will be created at: ${this.config.outputPath}`);
      console.warn(`   Docker container expects: ${expectedContainerPath}`);
      console.warn(`   This may cause deployment issues. Consider using the default path.`);
    } else {
      console.log(`✅ Database will be created in correct location for Docker container: ${this.config.outputPath}`);
    }

    // Remove existing database if replace mode or if it exists (to prevent unique constraint violations)
    if ((this.config.replace || fs.existsSync(this.config.outputPath)) && fs.existsSync(this.config.outputPath)) {
      console.log(`🗑️  Removing existing database: ${this.config.outputPath}`);
      fs.unlinkSync(this.config.outputPath);
    }

    // Create SpatiaLite database with error handling
    let spatialiteDb: DatabaseType;
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

    // Create tables
    spatialiteDb.exec(`
      CREATE TABLE IF NOT EXISTS trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS routing_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS routing_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER,
        to_node_id INTEGER,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        description TEXT
      );
    `);

    // Create spatial column for trails
    spatialiteDb.exec(`
      SELECT AddGeometryColumn('trails', 'geometry', 4326, 'LINESTRING', 3)
    `);

    // Create indexes
    spatialiteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id);
      CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
      CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes(lat, lng);
      CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);
    `);

    // Insert schema version
    spatialiteDb.exec(`
      INSERT OR REPLACE INTO schema_version (version, description) 
      VALUES (7, 'Enhanced PostgreSQL processed: split trails with routing graph and elevation field')
    `);

    // Export trails (either split trails or original trails if no splits occurred)
    let trailsToExport;
    const splitTrailsExport = await this.pgClient.query(`
      SELECT 
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        ST_AsText(geometry) as geometry_text
      FROM ${this.stagingSchema}.split_trails
      ORDER BY original_trail_id, segment_number
    `);

    if (splitTrailsExport.rows.length > 0) {
      trailsToExport = splitTrailsExport.rows;
      console.log(`📊 Exporting ${splitTrailsExport.rows.length} split trails...`);
    } else {
      // No splits occurred, export original trails
      const originalTrails = await this.pgClient.query(`
        SELECT 
          app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          ST_AsText(geometry) as geometry_text
        FROM ${this.stagingSchema}.trails
        ORDER BY id
      `);
      trailsToExport = originalTrails.rows;
      console.log(`📊 Exporting ${originalTrails.rows.length} original trails (no splits occurred)...`);
    }

    // Apply adaptive simplification if target size is specified
    if (this.config.targetSizeMB) {
      console.log(`🎯 Applying adaptive simplification for target size: ${this.config.targetSizeMB} MB`);
      const adaptiveTolerance = this.calculateAdaptiveTolerance(trailsToExport, this.config.targetSizeMB);
      
      // Apply simplification to all trails
      for (const trail of trailsToExport) {
        if (trail.geometry_text && trail.geometry_text.startsWith('LINESTRING')) {
          const { simplified, originalPoints, simplifiedPoints } = this.simplifyGeometryWithCounts(trail.geometry_text, adaptiveTolerance);
          if (this.config.verbose && originalPoints !== simplifiedPoints) {
            console.log(`Simplified ${trail.name} from ${originalPoints} points to ${simplifiedPoints} points.`);
          }
          trail.geometry_text = simplified;
        }
      }
      
      const finalSizeMB = this.estimateDatabaseSize(trailsToExport);
      console.log(`📊 Final estimated size after simplification: ${finalSizeMB.toFixed(2)} MB`);
    }

    // Before exporting, print detailed export filtering info
    console.log(`\n[Export] Exporting trails for region: ${this.config.region}`);
    const regionTrails = await this.pgClient.query(`SELECT app_uuid, region FROM ${this.stagingSchema}.trails`);
    console.log(`[Export] Found ${regionTrails.rows.length} trails in staging.trails. Sample:`);
    console.log(regionTrails.rows.slice(0, 5));
    const splitTrails = await this.pgClient.query(`SELECT app_uuid, original_trail_id, segment_number, name FROM ${this.stagingSchema}.split_trails`);
    console.log(`[Export] Found ${splitTrails.rows.length} split trails in staging.split_trails. Sample:`);
    console.log(splitTrails.rows.slice(0, 5));

    // Before exporting, check for duplicate app_uuid values
    const uuids = trailsToExport.map(t => t.app_uuid);
    const duplicates = uuids.filter((uuid, i, arr) => arr.indexOf(uuid) !== i);
    if (duplicates.length > 0) {
      console.error('❌ Duplicate app_uuid values found before export:', duplicates);
      process.exit(1);
    }

    const insertTrail = spatialiteDb.prepare(`
      INSERT INTO trails (
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Direct export of validated data from staging to SpatiaLite
    console.log('📤 Exporting validated trails directly to SpatiaLite...');
    
    // Filter out incomplete trails if flag is set
    let filteredTrails = trailsToExport;
    if (this.config.skipIncompleteTrails) {
      const originalCount = trailsToExport.length;
      filteredTrails = trailsToExport.filter(trail => {
        // Check if trail has complete elevation data
        const hasElevationData = trail.elevationGain !== null && trail.elevationGain !== 0 &&
                                trail.elevationLoss !== null && trail.elevationLoss !== 0 &&
                                trail.maxElevation !== null && trail.maxElevation !== 0 &&
                                trail.minElevation !== null && trail.minElevation !== 0 &&
                                trail.avgElevation !== null && trail.avgElevation !== 0;
        
        // Check if trail has valid geometry
        const hasValidGeometry = trail.geometry_text && trail.geometry_text.startsWith('LINESTRING');
        
        // Check if trail has required fields
        const hasRequiredFields = trail.name && trail.name.trim() !== '' &&
                                trail.app_uuid && trail.app_uuid.trim() !== '';
        
        return hasElevationData && hasValidGeometry && hasRequiredFields;
      });
      
      const skippedCount = originalCount - filteredTrails.length;
      if (skippedCount > 0) {
        console.log(`⏭️  Skipped ${skippedCount} incomplete trails (${filteredTrails.length} complete trails remaining)`);
      }
    }
    
    let processed = 0;
    let exported = 0;
    let failed = 0;
    
    for (const trail of filteredTrails) {
      processed++;
      console.log(`📍 Exporting trail ${processed}/${filteredTrails.length}: ${trail.name} (${trail.app_uuid})`);
      
      try {
        // Insert trail data directly from staging
        insertTrail.run(
          trail.app_uuid, trail.osm_id, trail.name, trail.trail_type, trail.surface, trail.difficulty, trail.source_tags,
          trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat,
          trail.length_km, trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation
        );

        // Insert geometry (always use geometry_text from ST_AsText(geometry))
        if (trail.geometry_text && trail.geometry_text.startsWith('LINESTRING')) {
          const updateGeom = spatialiteDb.prepare(`
            UPDATE trails SET geometry = GeomFromText(?, 4326) WHERE app_uuid = ?
          `);
          updateGeom.run(trail.geometry_text, trail.app_uuid);
          exported++;
          console.log(`✅ Exported: ${trail.name} (elevation: ${trail.elevation_gain}m, length: ${trail.length_km.toFixed(2)}km)`);
        } else {
          failed++;
          console.warn(`⚠️ Trail ${trail.app_uuid} has missing or invalid geometryText: ${trail.geometry_text}`);
        }
      } catch (error) {
        failed++;
        console.error(`❌ Error exporting trail: ${error}`);
      }
    }
    
    console.log(`✅ Successfully exported ${exported} trails to SpatiaLite`);
    if (failed > 0) {
      console.warn(`⚠️ Failed to export ${failed} trails`);
    }

    // Export routing nodes
    const routingNodes = await this.pgClient.query(`
      SELECT node_uuid, lat, lng, elevation, node_type, connected_trails
      FROM ${this.stagingSchema}.routing_nodes
    `);

    console.log(`📊 Exporting ${routingNodes.rows.length} routing nodes...`);
    
    // Debug: Check if nodes exist in staging
    const nodeCountCheck = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`);
    console.log(`🔍 Debug: Found ${nodeCountCheck.rows[0].count} nodes in staging.routing_nodes`);
    
    if (routingNodes.rows.length === 0) {
      console.warn('⚠️  No routing nodes found in staging. This may indicate a routing graph build failure.');
      // Show sample of what's in staging
      const nodeSample = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_nodes LIMIT 5`);
      console.log('🔍 Sample nodes in staging:', nodeSample.rows);
    }

    const insertNode = spatialiteDb.prepare(`
      INSERT INTO routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const node of routingNodes.rows) {
      insertNode.run(node.node_uuid, node.lat, node.lng, node.elevation, node.node_type, node.connected_trails);
    }

    // Export routing edges
    const routingEdges = await this.pgClient.query(`
      SELECT from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain
      FROM ${this.stagingSchema}.routing_edges
    `);

    console.log(`📊 Exporting ${routingEdges.rows.length} routing edges...`);
    
    // Debug: Check if edges exist in staging
    const edgeCountCheck = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`);
    console.log(`🔍 Debug: Found ${edgeCountCheck.rows[0].count} edges in staging.routing_edges`);
    
    if (routingEdges.rows.length === 0) {
      console.warn('⚠️  No routing edges found in staging. This may indicate a routing graph build failure.');
      // Show sample of what's in staging
      const edgeSample = await this.pgClient.query(`SELECT * FROM ${this.stagingSchema}.routing_edges LIMIT 5`);
      console.log('🔍 Sample edges in staging:', edgeSample.rows);
    }

    const insertEdge = spatialiteDb.prepare(`
      INSERT INTO routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const edge of routingEdges.rows) {
      insertEdge.run(edge.from_node_id, edge.to_node_id, edge.trail_id, edge.trail_name, edge.distance_km, edge.elevation_gain);
    }

    // Create regions table (stores both main bbox and optional initial_view_bbox)
    spatialiteDb.exec(`
      CREATE TABLE IF NOT EXISTS regions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        bbox TEXT,
        initial_view_bbox TEXT,
        center TEXT,
        metadata TEXT
      );
    `);

    // --- MAIN BBOX LOGIC ---
    let mainBbox;
    if (this.config.bbox) {
      // Use CLI-provided bbox as main bbox
      mainBbox = {
        minLng: this.config.bbox[0],
        minLat: this.config.bbox[1],
        maxLng: this.config.bbox[2],
        maxLat: this.config.bbox[3]
      };
      console.log('📊 Using CLI-provided bbox as main bbox:', mainBbox);
      // Strict validation
      if ([mainBbox.minLng, mainBbox.maxLng, mainBbox.minLat, mainBbox.maxLat].some(v => v === null || v === undefined || isNaN(v))) {
        throw new Error('❌ Main bbox is invalid: ' + JSON.stringify(mainBbox));
      }
    } else {
      // Calculate main bbox from PostGIS geometry for the region
      const bboxQuery = `
        SELECT 
          ST_XMin(extent) AS min_lng,
          ST_XMax(extent) AS max_lng,
          ST_YMin(extent) AS min_lat,
          ST_YMax(extent) AS max_lat
        FROM (
          SELECT ST_Extent(geometry) AS extent
          FROM ${this.stagingSchema}.trails
          WHERE geometry IS NOT NULL
        ) AS bbox;
      `;
      const mainBboxResult = await this.pgClient.query(bboxQuery);
      if (!mainBboxResult.rows.length || mainBboxResult.rows[0].min_lng === null || mainBboxResult.rows[0].max_lng === null || mainBboxResult.rows[0].min_lat === null || mainBboxResult.rows[0].max_lat === null) {
        throw new Error('No trail geometry found to calculate main bbox');
      }
      mainBbox = {
        minLng: mainBboxResult.rows[0].min_lng,
        maxLng: mainBboxResult.rows[0].max_lng,
        minLat: mainBboxResult.rows[0].min_lat,
        maxLat: mainBboxResult.rows[0].max_lat
      };
      console.log('📊 Calculated main bbox from PostGIS geometry:', mainBbox);
      if ([mainBbox.minLng, mainBbox.maxLng, mainBbox.minLat, mainBbox.maxLat].some(v => v === null || v === undefined || isNaN(v))) {
        throw new Error('❌ Main bbox is invalid: ' + JSON.stringify(mainBbox));
      }
    }
    // --- END MAIN BBOX LOGIC ---

    // Fetch region metadata from Postgres
    const regionMeta = await this.pgClient.query(`
      SELECT 
        region_key as id,
        name, 
        description, 
        initial_view_bbox,
        center_lng,
        center_lat,
        metadata_source,
        metadata_last_updated,
        metadata_version,
        metadata_coverage,
        metadata_trail_count
      FROM regions 
      WHERE region_key = $1
    `, [this.config.region]);
    
    if (regionMeta.rows.length) {
      const r = regionMeta.rows[0];
      // Build center object
      const center = (r.center_lng !== undefined && r.center_lat !== undefined && r.center_lng !== null && r.center_lat !== null)
        ? { lng: r.center_lng, lat: r.center_lat } : null;
      // Build metadata object
      const metadata = {
        source: r.metadata_source || 'Calculated during export from trail data',
        lastUpdated: r.metadata_last_updated || new Date().toISOString(),
        version: r.metadata_version || '1.0.0',
        coverage: r.metadata_coverage || `${this.config.region} region`,
        trailCount: r.metadata_trail_count || 'dynamic'
      };
      // Handle initial_view_bbox logic
      const validInitialViewBbox = getValidInitialViewBbox(r.initial_view_bbox, mainBbox);
      // Strict validation
      if ([validInitialViewBbox.minLng, validInitialViewBbox.maxLng, validInitialViewBbox.minLat, validInitialViewBbox.maxLat].some(v => v === null || v === undefined || isNaN(v))) {
        throw new Error('❌ initial_view_bbox is invalid: ' + JSON.stringify(validInitialViewBbox));
      }
      const initialViewBbox = JSON.stringify(validInitialViewBbox);
      console.log('📊 Exporting initial_view_bbox:', validInitialViewBbox);
      spatialiteDb.prepare(`
        INSERT OR REPLACE INTO regions (id, name, description, bbox, initial_view_bbox, center, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        r.id,
        r.name,
        r.description,
        JSON.stringify(mainBbox),
        initialViewBbox,
        center ? JSON.stringify(center) : null,
        JSON.stringify(metadata)
      );
      console.log('✅ Exported region metadata to SQLite with calculated main bbox');
    } else {
      console.warn('⚠️ No region metadata found in Postgres for export');
    }
    
    // Ensure database is properly closed
    console.log('🔒 Closing SQLite database connection...');
    spatialiteDb.close();
    
    // Longer delay to ensure file is fully released and all operations are complete
    console.log('⏳ Waiting for database operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Report database size
    console.log(`📊 Checking database file: ${this.config.outputPath}`);
    if (!fs.existsSync(this.config.outputPath)) {
      console.error('❌ Database file does not exist after export!');
      throw new Error('Database file was not created successfully');
    }
    
    const stats = fs.statSync(this.config.outputPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`📊 Database size: ${sizeMB} MB`);
    
    // Check if database size exceeds configured limit and ask for confirmation
    const sizeMBFloat = parseFloat(sizeMB);
    if (sizeMBFloat > this.config.maxSpatiaLiteDbSizeMB) {
      console.log(`\n⚠️  Database size (${sizeMB} MB) exceeds ${this.config.maxSpatiaLiteDbSizeMB}MB limit!`);
      console.log('   This will result in a large container that may take time to push.');
      console.log('   Consider:');
      console.log('   1. Increasing --simplify-tolerance to reduce geometry complexity');
      console.log('   2. Using --target-size to automatically optimize for smaller size');
      console.log('   3. Using --max-spatialite-db-size to increase the limit');
      console.log('   4. Reviewing trail data for excessive detail or coverage area');
      
      // Check if running in non-interactive mode
      if (!process.stdin.isTTY) {
        console.log(`   Non-interactive mode detected. Proceeding with export...`);
      } else {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>((resolve) => {
          rl.question('   Continue with export? (y/N): ', resolve);
        });
        rl.close();
        
        if (!answer.toLowerCase().startsWith('y')) {
          console.log('   Export cancelled by user.');
          
          // Clean up the oversized database
          try {
            fs.unlinkSync(this.config.outputPath);
            console.log('🗑️  Removed oversized database file');
          } catch (e) {
            console.warn('⚠️  Could not remove oversized database file');
          }
          
          process.exit(0);
        }
      }
      
      console.log('   Proceeding with export...');
    }
    
    if (sizeMBFloat > 50) {
      console.warn(`⚠️  Database size (${sizeMB} MB) exceeds 50 MB target`);
      console.log(`💡 Consider increasing --simplify-tolerance to reduce size`);
    } else {
      console.log(`✅ Database size (${sizeMB} MB) is within 50 MB target`);
    }
    
    console.log('✅ Export to SpatiaLite completed');

    // --- Auto-update environment files with new DATABASE_PATH ---
    const dbPath = this.config.outputPath;
    const envFiles = [
      '../../.env.api.local',
      '../../.env.local',
      '../../fly.toml',
      '../../fly.production.toml',
    ];
    for (const relPath of envFiles) {
      const absPath = path.resolve(__dirname, relPath);
      if (!fs.existsSync(absPath)) continue;
      let content = fs.readFileSync(absPath, 'utf8');
      if (absPath.endsWith('.toml')) {
        // Update DATABASE_PATH in TOML
        if (content.match(/^DATABASE_PATH\s*=.*$/m)) {
          content = content.replace(/^DATABASE_PATH\s*=.*$/m, `DATABASE_PATH = \"${dbPath}\"`);
        } else {
          content += `\nDATABASE_PATH = \"${dbPath}\"\n`;
        }
      } else {
        // Update DATABASE_PATH in .env
        if (content.match(/^DATABASE_PATH=.*$/m)) {
          content = content.replace(/^DATABASE_PATH=.*$/m, `DATABASE_PATH=${dbPath}`);
        } else {
          content += `\nDATABASE_PATH=${dbPath}\n`;
        }
      }
      
      // Write the updated content back to the file
      fs.writeFileSync(absPath, content);
    }
    console.log('✅ Auto-updated environment files with new DATABASE_PATH');
  }

  private async buildMasterDatabase(): Promise<void> {
    // Placeholder for master database building
    console.log('📊 Master database building not implemented in this version');
  }

  private async cleanupStaging(): Promise<void> {
    // Clean up staging schema
    try {
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
      console.log('✅ Cleaned up staging environment');
    } catch (error) {
      console.warn('⚠️ Error cleaning up staging environment:', error);
    }
  }

  private calculateDistance(point1: [number, number], point2: [number, number]): number {
    const [lng1, lat1] = point1;
    const [lng2, lat2] = point2;
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  private calculateAdaptiveTolerance(trails: any[], targetSizeMB: number | null): number {
    if (!targetSizeMB) return this.config.simplifyTolerance;
    
    // Simple adaptive tolerance calculation
    const currentTolerance = this.config.simplifyTolerance;
    const trailCount = trails.length;
    const estimatedSizePerTrail = 0.1; // MB per trail estimate
    const estimatedSize = trailCount * estimatedSizePerTrail;
    
    if (estimatedSize > targetSizeMB) {
      return currentTolerance * 1.5; // Increase tolerance to reduce size
    }
    return currentTolerance;
  }

  private simplifyGeometryWithCounts(geometryText: string, tolerance: number): {
    simplified: string;
    originalPoints: number;
    simplifiedPoints: number;
  } {
    // Simple geometry simplification using PostGIS ST_Simplify
    const simplified = `ST_Simplify(ST_GeomFromText('${geometryText}', 4326), ${tolerance})`;
    
    // Count points in original geometry
    const originalPoints = (geometryText.match(/[0-9.-]+ [0-9.-]+/g) || []).length;
    
    // Estimate simplified points (rough approximation)
    const simplifiedPoints = Math.max(2, Math.floor(originalPoints * 0.7));
    
    return {
      simplified,
      originalPoints,
      simplifiedPoints
    };
  }

  private estimateDatabaseSize(trails: any[]): number {
    // Rough estimation of database size in MB
    const baseSize = 1; // Base size in MB
    const sizePerTrail = 0.01; // MB per trail
    return baseSize + (trails.length * sizePerTrail);
  }
}