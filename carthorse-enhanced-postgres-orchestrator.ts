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
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
dotenv.config();
import { AtomicTrailInserter, TrailInsertData } from './carthorse-postgres-atomic-insert';
import { OSMPostgresLoader, createOSMPostgresLoader } from './carthorse-osm-postgres-loader';
import * as process from 'process';



// Import proper coordinate types to prevent lat/lng confusion
import type { 
  Coordinate3D, 
  Coordinate2D, 
  BoundingBox,
  GeoJSONCoordinate,
  LeafletCoordinate 
} from './src/types/index';

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
}

interface IntersectionPoint {
  coordinate: GeoJSONCoordinate; // [lng, lat, elevation?] - GeoJSON format
  idx: number;
  distance: number;
  visitorTrailId: number;
  visitorTrailName: string;
}

interface TrailSegment {
  originalTrailId: number;
  segmentNumber: number;
  appUuid: string;
  name: string;
  trailType: string;
  surface: string;
  difficulty: string;
  sourceTags: string;
  osmId: string;
  elevationGain: number;
  elevationLoss: number;
  maxElevation: number;
  minElevation: number;
  avgElevation: number;
  lengthKm: number;
  source: string;
  geometry: string;
  bboxMinLng: number;
  bboxMaxLng: number;
  bboxMinLat: number;
  bboxMaxLat: number;
}

interface RoutingNode {
  id: number;
  nodeUuid: string;
  lat: number;
  lng: number;
  elevation: number;
  nodeType: string;
  connectedTrails: string;
}

interface RoutingEdge {
  fromNodeId: number;
  toNodeId: number;
  trailId: string;
  trailName: string;
  distanceKm: number;
  elevationGain: number;
}

class EnhancedPostgresOrchestrator {
  private pgClient: Client;
  private config: EnhancedOrchestratorConfig;
  private stagingSchema: string;
  private splitPoints: Map<number, IntersectionPoint[]> = new Map();
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
    this.pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
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
      await this.pgClient.connect();
      console.log('✅ Connected to PostgreSQL master database');

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
      await this.copyRegionDataToStaging();

      // Step 4: Detect intersections
      await this.detectIntersections();

      // Step 5: Split trails at intersections
      await this.splitTrailsAtIntersections();

      // Step 6: Build routing graph
      await this.buildRoutingGraph();

      // Step 7: Export to SpatiaLite
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

      -- Intersection points table
      CREATE TABLE ${this.stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINTZ, 4326),
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

  private async copyRegionDataToStaging(): Promise<void> {
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
    await this.pgClient.query(`
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
    `, [this.config.region]);
    
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
      const elevationHash = this.hashString(`${trail.elevation_gain}-${trail.elevation_loss}-${trail.max_elevation}-${trail.min_elevation}-${trail.avg_elevation}`);
      const metadataHash = this.hashString(`${trail.name}-${trail.trail_type}-${trail.surface}-${trail.difficulty}-${trail.source_tags}`);
      
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

    // Find intersection points using PostGIS
    const result = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.intersection_points (point, trail1_id, trail2_id, distance_meters)
      SELECT DISTINCT 
        ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
        t1.id as trail1_id,
        t2.id as trail2_id,
        ST_Distance(t1.geometry, t2.geometry) as distance_meters
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON (
        t1.id < t2.id AND 
        ST_Intersects(t1.geometry, t2.geometry) AND
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point' AND
        ST_Distance(t1.geometry, t2.geometry) <= $1
      )
    `, [this.config.intersectionTolerance]);

    console.log(`✅ Found ${result.rowCount} intersection points`);

    // Load intersection data into memory for processing
    const intersections = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.intersection_points
      ORDER BY trail1_id, trail2_id
    `);

    // Group intersections by trail
    for (const intersection of intersections.rows) {
      const point = intersection.point;
      const coords = point.match(/POINT\(([^)]+)\)/);
      if (coords) {
        const [lng, lat] = coords[1].split(' ').map(Number);
        
        // Add to trail1
        if (!this.splitPoints.has(intersection.trail1_id)) {
          this.splitPoints.set(intersection.trail1_id, []);
        }
        this.splitPoints.get(intersection.trail1_id)!.push({
          coordinate: [lng, lat] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
          visitorTrailId: intersection.trail2_id, visitorTrailName: ''
        });

        // Add to trail2
        if (!this.splitPoints.has(intersection.trail2_id)) {
          this.splitPoints.set(intersection.trail2_id, []);
        }
        this.splitPoints.get(intersection.trail2_id)!.push({
          coordinate: [lng, lat] as GeoJSONCoordinate, idx: -1, distance: intersection.distance_meters,
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
    const coordsMatch = geomText.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/);
    if (!coordsMatch) return [];

    const coords = coordsMatch[1].split(',').map((coord: string) => {
      const [lng, lat] = coord.trim().split(' ').map(Number);
      return [lng, lat];
    });

    // Find closest coordinate indices for each intersection point
    const splitIndices: { idx: number; point: IntersectionPoint | null }[] = [];
    for (const intersection of intersections) {
      let minDist = Infinity;
      let minIdx = -1;

      for (let i = 0; i < coords.length; i++) {
        const dist = this.calculateDistance(intersection.coordinate, coords[i] as Coordinate2D);
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

    const coords = coordsMatch[1].split(',').map((coord: string) => {
      const parts = coord.trim().split(' ').map(Number);
      // Handle 2D (lng, lat) or 3D (lng, lat, elevation) coordinates
      if (parts.length === 2) {
        return [parts[0], parts[1]]; // [lng, lat]
      } else if (parts.length === 3) {
        return [parts[0], parts[1], parts[2]]; // [lng, lat, elevation]
      } else {
        throw new Error(`Invalid coordinate format: ${coord}`);
      }
    });

    const segments = [];
    const hasZ = coords[0].length === 3; // Check if we have Z coordinates

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
    console.log('🔗 Building routing graph...');
    
    // Clear existing routing data
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_edges`);
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.routing_nodes`);

    // Get all split trails (or original trails if no splits occurred)
    let trailsQuery = `
      SELECT id, app_uuid, name, ST_AsText(geometry) as geometry_text, length_km, elevation_gain
      FROM ${this.stagingSchema}.split_trails 
      WHERE geometry IS NOT NULL
    `;
    
    let trails = await this.pgClient.query(trailsQuery);
    
    // If no split trails exist, use original trails
    if (trails.rows.length === 0) {
      console.log('ℹ️  No split trails found, using original trails for routing graph...');
      trailsQuery = `
        SELECT id, app_uuid, name, ST_AsText(geometry) as geometry_text, length_km, elevation_gain
        FROM ${this.stagingSchema}.trails 
        WHERE geometry IS NOT NULL
      `;
      trails = await this.pgClient.query(trailsQuery);
    }

    console.log(`📊 Building routing graph from ${trails.rows.length} trails...`);

    const nodeMap = new Map<string, number>();
    let nodeId = 1;
    const nodes: RoutingNode[] = [];
    const edges: RoutingEdge[] = [];

    for (const trail of trails.rows) {
      const geomText = trail.geometry_text;
      const coordsMatch = geomText.match(/LINESTRING\(([^)]+)\)/);
      if (!coordsMatch) {
        console.warn(`⚠️  Skipping trail ${trail.app_uuid} - invalid geometry format`);
        continue;
      }

      const coords = coordsMatch[1].split(',').map((coord: string) => {
        const parts = coord.trim().split(' ').map(Number);
        const lng = parts[0];
        const lat = parts[1];
        const elevation = parts.length >= 3 ? parts[2] : 0;
        return [lng, lat, elevation] as [number, number, number];
      });

      if (coords.length < 2) {
        console.warn(`⚠️  Skipping trail ${trail.app_uuid} - insufficient coordinates`);
        continue;
      }

      // Create nodes for start and end points of each trail
      const startCoord = coords[0];
      const endCoord = coords[coords.length - 1];
      
      const [startLng, startLat, startElev] = startCoord;
      const [endLng, endLat, endElev] = endCoord;

      const startNodeId = this.getOrCreateNode(nodeMap, nodes, startLat, startLng, startElev, nodeId++);
      const endNodeId = this.getOrCreateNode(nodeMap, nodes, endLat, endLng, endElev, nodeId++);

      // Calculate distance
      const distanceKm = this.calculateDistance([startLng, startLat], [endLng, endLat]) / 1000;

      edges.push({
        fromNodeId: startNodeId,
        toNodeId: endNodeId,
        trailId: trail.app_uuid,
        trailName: trail.name,
        distanceKm,
        elevationGain: trail.elevation_gain || 0
      });

      // Also create intermediate nodes for better routing (every 10th point to avoid too many nodes)
      for (let i = 10; i < coords.length - 10; i += 10) {
        const [lng, lat, elev] = coords[i];
        this.getOrCreateNode(nodeMap, nodes, lat, lng, elev, nodeId++);
      }
    }

    console.log(`📊 Created ${nodes.length} routing nodes and ${edges.length} routing edges`);

    // Insert nodes
    let insertedNodes = 0;
    for (const node of nodes) {
      try {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [node.id, node.nodeUuid, node.lat, node.lng, node.elevation, node.nodeType, node.connectedTrails]);
        insertedNodes++;
      } catch (error) {
        console.error(`❌ Error inserting node ${node.id}:`, error);
      }
    }

    // Insert edges
    let insertedEdges = 0;
    for (const edge of edges) {
      try {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [edge.fromNodeId, edge.toNodeId, edge.trailId, edge.trailName, edge.distanceKm, edge.elevationGain]);
        insertedEdges++;
      } catch (error) {
        console.error(`❌ Error inserting edge ${edge.fromNodeId}->${edge.toNodeId}:`, error);
      }
    }

    console.log(`✅ Successfully inserted ${insertedNodes} routing nodes and ${insertedEdges} routing edges`);
    
    // Verify the data was inserted correctly
    const nodeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_nodes`);
    const edgeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.routing_edges`);
    
    console.log(`🔍 Verification: ${nodeCount.rows[0].count} nodes and ${edgeCount.rows[0].count} edges in staging`);
    
    if (nodeCount.rows[0].count === 0) {
      console.warn('⚠️  Warning: No routing nodes were created. This may cause API issues.');
    }
  }

  private getOrCreateNode(nodeMap: Map<string, number>, nodes: RoutingNode[], lat: number, lng: number, elevation: number, nodeId: number): number {
    const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
    if (nodeMap.has(key)) {
      return nodeMap.get(key)!;
    }

    nodeMap.set(key, nodeId);
    nodes.push({
      id: nodeId,
      nodeUuid: uuidv4(),
      lat,
      lng,
      elevation,
      nodeType: 'intersection',
      connectedTrails: '[]'
    });

    return nodeId;
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

    // Create SpatiaLite database
    const spatialiteDb = new Database(this.config.outputPath);
    
    // Load SpatiaLite extension
    const SPATIALITE_PATH = process.platform === 'darwin'
      ? '/opt/homebrew/lib/mod_spatialite'
      : '/usr/lib/x86_64-linux-gnu/mod_spatialite';
    
    try {
      spatialiteDb.loadExtension(SPATIALITE_PATH);
      console.log('✅ SpatiaLite loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load SpatiaLite:', error);
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
    const splitTrails = await this.pgClient.query(`
      SELECT 
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        ST_AsText(geometry) as geometry_text
      FROM ${this.stagingSchema}.split_trails
      ORDER BY original_trail_id, segment_number
    `);

    if (splitTrails.rows.length > 0) {
      trailsToExport = splitTrails.rows;
      console.log(`📊 Exporting ${splitTrails.rows.length} split trails...`);
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
        const hasElevationData = trail.elevation_gain !== null && trail.elevation_gain !== 0 &&
                                trail.elevation_loss !== null && trail.elevation_loss !== 0 &&
                                trail.max_elevation !== null && trail.max_elevation !== 0 &&
                                trail.min_elevation !== null && trail.min_elevation !== 0 &&
                                trail.avg_elevation !== null && trail.avg_elevation !== 0;
        
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
          console.warn(`⚠️ Trail ${trail.app_uuid} has missing or invalid geometry_text: ${trail.geometry_text}`);
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
    const mainBbox = {
      minLng: mainBboxResult.rows[0].min_lng,
      maxLng: mainBboxResult.rows[0].max_lng,
      minLat: mainBboxResult.rows[0].min_lat,
      maxLat: mainBboxResult.rows[0].max_lat
    };
    console.log('📊 Calculated main bbox from PostGIS geometry:', mainBbox);
    
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
      const center = (r.center_lng && r.center_lat) ? 
        { lng: r.center_lng, lat: r.center_lat } : 
        null;
      
      // Build metadata object
      const metadata = {
        source: r.metadata_source || 'Calculated during export from trail data',
        lastUpdated: r.metadata_last_updated || new Date().toISOString(),
        version: r.metadata_version || '1.0.0',
        coverage: r.metadata_coverage || `${this.config.region} region`,
        trailCount: r.metadata_trail_count || 'dynamic'
      };
      
      // Handle initial_view_bbox logic
      let initialViewBbox;
      if (r.initial_view_bbox === null || r.initial_view_bbox === undefined) {
        // Calculate 25% bbox from the main bbox
        const bboxWidth = mainBbox.maxLng - mainBbox.minLng;
        const bboxHeight = mainBbox.maxLat - mainBbox.minLat;
        const centerLng = mainBbox.minLng + bboxWidth / 2;
        const centerLat = mainBbox.minLat + bboxHeight / 2;
        const quarterWidth = bboxWidth * 0.25;
        const quarterHeight = bboxHeight * 0.25;
        
        const calculatedBbox = {
          minLng: centerLng - quarterWidth / 2,
          maxLng: centerLng + quarterWidth / 2,
          minLat: centerLat - quarterHeight / 2,
          maxLat: centerLat + quarterHeight / 2
        };
        
        initialViewBbox = JSON.stringify(calculatedBbox);
        console.log('📊 Calculated 25% initial_view_bbox from main bbox:', calculatedBbox);
      } else {
        // Copy existing initial_view_bbox as-is
        initialViewBbox = typeof r.initial_view_bbox === 'object' ? JSON.stringify(r.initial_view_bbox) : r.initial_view_bbox;
        console.log('📊 Using existing initial_view_bbox from Postgres:', r.initial_view_bbox);
      }
      
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

    spatialiteDb.close();
    
    // Report database size
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
      fs.writeFileSync(absPath, content, 'utf8');
      console.log(`🔄 Updated DATABASE_PATH in ${absPath}`);
    }

    // --- STRICT POST-EXPORT VALIDATION: FAIL IMMEDIATELY ON ANY ISSUES ---
    console.log('\n🔍 Performing strict data integrity validation...');
    const sqlite3 = require('better-sqlite3');
    const db = new sqlite3(this.config.outputPath, { readonly: true });
    
    // Check total trails
    const total = db.prepare('SELECT COUNT(*) as n FROM trails').get().n;
    if (total === 0) {
      console.error('❌ CRITICAL: No trails found in exported database!');
      console.error('   This indicates a complete export failure.');
      db.close();
      process.exit(1);
    }
    
    // Check for missing elevation data (any elevation field null or zero)
    const missingElevation = db.prepare(`
      SELECT COUNT(*) as n FROM trails
      WHERE elevation_gain IS NULL OR elevation_gain = 0
         OR elevation_loss IS NULL OR elevation_loss = 0
         OR max_elevation IS NULL OR max_elevation = 0
         OR min_elevation IS NULL OR min_elevation = 0
         OR avg_elevation IS NULL OR avg_elevation = 0
    `).get().n;
    
    // Check for missing geometry data
    const missingGeometry = db.prepare(`
      SELECT COUNT(*) as n FROM trails
      WHERE geometry IS NULL
    `).get().n;
    
    // Check for invalid geometry (empty or malformed)
    const invalidGeometry = db.prepare(`
      SELECT COUNT(*) as n FROM trails
      WHERE geometry = '' OR geometry = 'NULL' OR length(geometry) < 10
    `).get().n;
    
    // Check for missing required fields
    const missingRequiredFields = db.prepare(`
      SELECT COUNT(*) as n FROM trails
      WHERE name IS NULL OR name = '' 
         OR app_uuid IS NULL OR app_uuid = ''
         OR trail_type IS NULL OR trail_type = ''
    `).get().n;
    
    // Check for invalid coordinates in geometry
    const invalidCoordinates = db.prepare(`
      SELECT COUNT(*) as n FROM trails
      WHERE bbox_min_lng IS NULL OR bbox_max_lng IS NULL 
         OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL
         OR bbox_min_lng >= bbox_max_lng 
         OR bbox_min_lat >= bbox_max_lat
    `).get().n;
    
    db.close();
    
    // Report validation results
    console.log(`📊 [Validation] Total trails: ${total}`);
    console.log(`📊 [Validation] Trails missing elevation data: ${missingElevation}`);
    console.log(`📊 [Validation] Trails missing geometry: ${missingGeometry}`);
    console.log(`📊 [Validation] Trails with invalid geometry: ${invalidGeometry}`);
    console.log(`📊 [Validation] Trails missing required fields: ${missingRequiredFields}`);
    console.log(`📊 [Validation] Trails with invalid coordinates: ${invalidCoordinates}`);
    
    // STRICT FAILURE CONDITIONS - ANY ISSUE CAUSES IMMEDIATE FAILURE
    const totalIssues = missingElevation + missingGeometry + invalidGeometry + missingRequiredFields + invalidCoordinates;
    
    if (totalIssues > 0) {
      if (this.config.skipIncompleteTrails) {
        console.log('\n⚠️  VALIDATION WARNING (--skip-incomplete-trails enabled):');
        console.log('   Some trails have incomplete data, but export will proceed.');
        
        if (missingElevation > 0) {
          console.log(`   - ${missingElevation} trails missing elevation data (skipped during export)`);
        }
        if (missingGeometry > 0) {
          console.log(`   - ${missingGeometry} trails missing geometry data (skipped during export)`);
        }
        if (invalidGeometry > 0) {
          console.log(`   - ${invalidGeometry} trails have invalid geometry (skipped during export)`);
        }
        if (missingRequiredFields > 0) {
          console.log(`   - ${missingRequiredFields} trails missing required fields (skipped during export)`);
        }
        if (invalidCoordinates > 0) {
          console.log(`   - ${invalidCoordinates} trails have invalid coordinates (skipped during export)`);
        }
        
        console.log('✅ Database export completed with incomplete trails skipped.');
        console.log('✅ Database is ready for deployment.');
      } else {
        console.error('\n❌ CRITICAL VALIDATION FAILURE!');
        console.error('   Export contains incomplete or invalid data.');
        console.error('   Database will NOT be deployed to prevent user-facing issues.');
        console.error('   Use --skip-incomplete-trails to export only complete trails.');
        
        if (missingElevation > 0) {
          console.error(`   - ${missingElevation} trails missing elevation data`);
        }
        if (missingGeometry > 0) {
          console.error(`   - ${missingGeometry} trails missing geometry data`);
        }
        if (invalidGeometry > 0) {
          console.error(`   - ${invalidGeometry} trails have invalid geometry`);
        }
        if (missingRequiredFields > 0) {
          console.error(`   - ${missingRequiredFields} trails missing required fields`);
        }
        if (invalidCoordinates > 0) {
          console.error(`   - ${invalidCoordinates} trails have invalid coordinates`);
        }
        
        console.error('\n💡 Troubleshooting:');
        console.error('   1. Check source data in PostgreSQL for completeness');
        console.error('   2. Verify elevation calculation pipeline');
        console.error('   3. Ensure geometry processing is working correctly');
        console.error('   4. Review staging table data before export');
        console.error('   5. Use --skip-incomplete-trails to export only complete trails');
        
        // Clean up the invalid database
        try {
          fs.unlinkSync(this.config.outputPath);
          console.log('🗑️  Removed invalid database file');
        } catch (e) {
          console.warn('⚠️  Could not remove invalid database file');
        }
        
        process.exit(1);
      }
    } else {
      console.log('✅ All trails have complete and valid data.');
      console.log('✅ Database integrity validation passed.');
      console.log('✅ Database is ready for deployment.');
    }
  }

  private async buildMasterDatabase(): Promise<void> {
    console.log('🏗️ Building master database from OSM extract...');
    
    try {
      // Create OSM PostgreSQL loader for the region
      const osmLoader = createOSMPostgresLoader(this.config.region);
      
      // Load OSM data into PostgreSQL (if not already loaded)
      await osmLoader.loadOSMData();
      
      // Extract trails from PostgreSQL OSM data
      const osmTrails = await osmLoader.extractTrails();
      console.log(`✅ Found ${osmTrails.length} trails from PostgreSQL OSM data`);
      
      // Process trails through atomic inserter
      const atomicInserter = new AtomicTrailInserter('trail_master_db');
      await atomicInserter.connect();
      
      let processed = 0;
      let inserted = 0;
      let failed = 0;
      
      for (const osmTrail of osmTrails) {
        processed++;
        
        try {
          console.log(`📍 Processing trail ${processed}/${osmTrails.length}: ${osmTrail.name}`);
          
          const result = await atomicInserter.insertTrailAtomically(osmTrail);
          
          if (result.success) {
            inserted++;
            console.log(`✅ Inserted: ${osmTrail.name}`);
          } else {
            failed++;
            console.log(`❌ Failed: ${osmTrail.name} - ${result.error}`);
            if (result.validation_errors) {
              console.log(`   Validation errors: ${result.validation_errors.join(', ')}`);
            }
          }
          
        } catch (error) {
          failed++;
          console.error(`❌ Error processing trail: ${error}`);
        }
      }
      
      await atomicInserter.disconnect();
      
      // Clean up OSM schema (optional - can keep for reuse)
      // await osmLoader.cleanup();
      
      console.log(`\n📊 Master database build complete:`);
      console.log(`   - Processed: ${processed} trails`);
      console.log(`   - Inserted: ${inserted} trails`);
      console.log(`   - Failed: ${failed} trails`);
      
    } catch (error) {
      console.error('❌ Master database build failed:', error);
      throw error;
    }
  }



  private convertStagingTrailToInsertData(trail: any): TrailInsertData | null {
    if (!trail.geometry_text || !trail.geometry_text.startsWith('LINESTRING')) {
      return null;
    }
    
    if (!trail.name || !trail.osm_id) {
      return null;
    }
    
    // Parse geometry text to extract coordinates
    const coordinates = this.parseGeometryText(trail.geometry_text);
    
    if (coordinates.length < 2) {
      return null;
    }
    
    // Parse source tags
    let sourceTags = {};
    try {
      sourceTags = JSON.parse(trail.source_tags || '{}');
    } catch (error) {
      console.warn(`⚠️  Could not parse source tags for ${trail.name}`);
    }
    
    return {
      osm_id: trail.osm_id,
      name: trail.name,
      trail_type: trail.trail_type || 'hiking',
      surface: trail.surface || 'unknown',
      difficulty: trail.difficulty || 'unknown',
      coordinates,
      source_tags: sourceTags,
      region: trail.region || this.config.region
    };
  }

  private parseGeometryText(geometryText: string): number[][] {
    // Parse LINESTRING Z format: "LINESTRING Z (lng1 lat1 elev1, lng2 lat2 elev2, ...)"
    const match = geometryText.match(/LINESTRING Z? \(([^)]+)\)/);
    if (!match) {
      throw new Error(`Invalid geometry format: ${geometryText}`);
    }

    const coordinateStrings = match[1]!.split(',');
    return coordinateStrings.map(coordStr => {
      const parts = coordStr.trim().split(' ');
      if (parts.length < 2) {
        throw new Error(`Invalid coordinate format: ${coordStr}`);
      }
      
      const lng = parseFloat(parts[0]!);
      const lat = parseFloat(parts[1]!);
      const elevation = parts.length >= 3 ? parseFloat(parts[2]!) : 0;
      
      if (isNaN(lng) || isNaN(lat)) {
        throw new Error(`Invalid coordinate values: ${coordStr}`);
      }
      
      return [lng, lat, elevation];
    });
  }

  private async cleanupStaging(): Promise<void> {
    console.log(`🧹 Cleaning up staging environment: ${this.stagingSchema}`);
    await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
    console.log('✅ Staging environment cleaned up');
  }

  private calculateDistance(coord1: GeoJSONCoordinate, coord2: Coordinate2D): number {
    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private simplifyGeometry(geometryText: string, tolerance: number): string {
    // Path simplification to reduce database size
    // This reduces coordinate density while preserving trail shape
    
    try {
      // Parse the geometry and apply simplification
      const lines: string[] = geometryText.split(',');
      
      if (lines.length <= 4) {
        // Too few points to simplify meaningfully
        return geometryText;
      }

      // Simple coordinate reduction (every nth point)
      const reductionFactor = Math.max(1, Math.floor(lines.length * tolerance));
      const simplifiedLines: string[] = [];
      
      for (let i = 0; i < lines.length; i += reductionFactor) {
        const line = lines[i];
        if (line) {
          simplifiedLines.push(line);
        }
      }
      
      // Always include the last point
      const lastSimplified = simplifiedLines[simplifiedLines.length - 1];
      const lastOriginal = lines[lines.length - 1];
      if (lastSimplified !== lastOriginal && lastOriginal) {
        simplifiedLines.push(lastOriginal);
      }

      return simplifiedLines.join(',');
      
    } catch (error) {
      console.warn(`⚠️  Geometry simplification failed, using original: ${error}`);
      return geometryText;
    }
  }

  private simplifyGeometryWithCounts(geometryText: string, tolerance: number): { simplified: string, originalPoints: number, simplifiedPoints: number } {
    // Path simplification to reduce database size
    // This reduces coordinate density while preserving trail shape
    try {
      // Parse the geometry and apply simplification
      const lines: string[] = geometryText.split(',');
      const originalPoints = lines.length;
      if (lines.length <= 4) {
        // Too few points to simplify meaningfully
        return { simplified: geometryText, originalPoints, simplifiedPoints: originalPoints };
      }
      // Simple coordinate reduction (every nth point)
      const reductionFactor = Math.max(1, Math.floor(lines.length * tolerance));
      const simplifiedLines: string[] = [];
      for (let i = 0; i < lines.length; i += reductionFactor) {
        const line = lines[i];
        if (line) {
          simplifiedLines.push(line);
        }
      }
      // Always include the last point
      const lastSimplified = simplifiedLines[simplifiedLines.length - 1];
      const lastOriginal = lines[lines.length - 1];
      if (lastSimplified !== lastOriginal && lastOriginal) {
        simplifiedLines.push(lastOriginal);
      }
      return { simplified: simplifiedLines.join(','), originalPoints, simplifiedPoints: simplifiedLines.length };
    } catch (error) {
      console.warn(`⚠️  Geometry simplification failed, using original: ${error}`);
      return { simplified: geometryText, originalPoints: 0, simplifiedPoints: 0 };
    }
  }

  private estimateDatabaseSize(trails: any[]): number {
    // Estimate database size based on coordinate count and trail count
    let totalCoordinates = 0;
    
    for (const trail of trails) {
      if (trail.geometry_text && trail.geometry_text.startsWith('LINESTRING')) {
        // Count coordinates in LINESTRING
        const coordMatch = trail.geometry_text.match(/LINESTRING\(([^)]+)\)/);
        if (coordMatch) {
          const coords = coordMatch[1].split(',').length;
          totalCoordinates += coords;
        }
      }
    }
    
    // Rough estimation: each coordinate ~50 bytes, plus metadata
    const estimatedSizeBytes = (totalCoordinates * 50) + (trails.length * 1000);
    return estimatedSizeBytes / (1024 * 1024); // Convert to MB
  }

  private calculateAdaptiveTolerance(trails: any[], targetSizeMB: number): number {
    const currentSizeMB = this.estimateDatabaseSize(trails);
    console.log(`📊 Current estimated size: ${currentSizeMB.toFixed(2)} MB`);
    console.log(`🎯 Target size: ${targetSizeMB} MB`);
    
    if (currentSizeMB <= targetSizeMB) {
      console.log(`✅ Current size is already within target`);
      return this.config.simplifyTolerance;
    }
    
    // Calculate reduction factor needed
    const reductionFactor = currentSizeMB / targetSizeMB;
    const newTolerance = this.config.simplifyTolerance * reductionFactor;
    
    console.log(`🔧 Adjusting tolerance from ${this.config.simplifyTolerance} to ${newTolerance.toFixed(6)}`);
    return newTolerance;
  }

  public async updateApiRegionsJson(region: string, newServiceUrl: string): Promise<void> {
    console.log(`🔍 Checking api-regions.json for region: ${region}`);
    
    const apiRegionsPath = path.resolve(__dirname, '../../../api-service/config/api-regions.json');
    if (!fs.existsSync(apiRegionsPath)) {
      console.warn(`⚠️ api-regions.json not found at ${apiRegionsPath}`);
      return;
    }
    
    try {
      const apiRegionsContent = fs.readFileSync(apiRegionsPath, 'utf8');
      const apiRegions = JSON.parse(apiRegionsContent);
      
      const regionEntry = apiRegions.regions.find((r: any) => r.id === region);
      if (!regionEntry) {
        console.warn(`⚠️ Region '${region}' not found in api-regions.json`);
        return;
      }
      
      const currentUrl = regionEntry.apiUrl;
      if (currentUrl === newServiceUrl) {
        console.log(`✅ api-regions.json already has correct URL for ${region}: ${currentUrl}`);
        return;
      }
      
      console.log(`🔄 Updating api-regions.json for ${region}:`);
      console.log(`   Old: ${currentUrl}`);
      console.log(`   New: ${newServiceUrl}`);
      
      regionEntry.apiUrl = newServiceUrl;
      
      fs.writeFileSync(apiRegionsPath, JSON.stringify(apiRegions, null, 2), 'utf8');
      console.log(`✅ Updated api-regions.json for ${region}`);
      
    } catch (error) {
      console.error(`❌ Failed to update api-regions.json: ${error}`);
    }
  }
}

// --- CLI Interface ---
function getArg(flag: string, defaultValue: string | null): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return defaultValue;
  return process.argv[index + 1] || defaultValue;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const region = getArg('--region', null);
  const spatialiteDbExport = getArg('--spatialite-db-export', null);
  const simplifyTolerance = parseFloat(getArg('--simplify-tolerance', '0.001') || '0.001');
  if (isNaN(simplifyTolerance) || simplifyTolerance < 0) {
    console.error('❌ --simplify-tolerance must be a non-negative number, got: ' + getArg('--simplify-tolerance', '0.001'));
    process.exit(1);
  }
  const intersectionTolerance = parseFloat(getArg('--intersection-tolerance', '3') || '3');
  if (isNaN(intersectionTolerance) || intersectionTolerance < 0) {
    console.error('❌ --intersection-tolerance must be a non-negative number, got: ' + getArg('--intersection-tolerance', '3'));
    process.exit(1);
  }
  const replace = hasFlag('--replace');
  const validate = hasFlag('--validate');
  const verbose = hasFlag('--verbose');
  const skipBackup = hasFlag('--skip-backup');
  const skipIncompleteTrails = hasFlag('--skip-incomplete-trails');
  const deploy = hasFlag('--deploy');

  if (!region) {
    console.error('❌ Region is required. Use --region <region>');
    console.log('Usage: npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region <region> --spatialite-db-export <path> [options]');
    process.exit(1);
  }

  if (!spatialiteDbExport) {
    console.error('❌ SpatiaLite database export path is required. Use --spatialite-db-export <path>');
    console.log('Usage: npx ts-node carthorse-enhanced-postgres-orchestrator.ts --region <region> --spatialite-db-export <path> [options]');
    console.log('Example: --spatialite-db-export ./data/boulder.db');
    process.exit(1);
  }

  // Resolve the SpatiaLite export path
  let outputPath = spatialiteDbExport;
  if (!path.isAbsolute(outputPath)) {
    outputPath = path.resolve(process.cwd(), outputPath);
  }
  
  // Ensure the output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`📁 Created output directory: ${outputDir}`);
    } catch (error) {
      console.error(`❌ Failed to create output directory ${outputDir}:`, error);
      process.exit(1);
    }
  }
  
  console.log(`📤 SpatiaLite export will be saved to: ${outputPath}`);

  const buildMaster = hasFlag('--build-master');
  const targetSizeArg = getArg('--target-size', null);
  const targetSizeMB = targetSizeArg ? parseFloat(targetSizeArg) : null;
  if (targetSizeArg && (isNaN(parseFloat(targetSizeArg)) || parseFloat(targetSizeArg) <= 0)) {
    console.error('❌ --target-size must be a positive number, got: ' + targetSizeArg);
    process.exit(1);
  }
  const maxSpatiaLiteDbSizeArg = getArg('--max-spatialite-db-size', null);
  if (!maxSpatiaLiteDbSizeArg) {
    console.error('❌ --max-spatialite-db-size is required.');
    process.exit(1);
  }
  const maxSpatiaLiteDbSizeMB = parseFloat(maxSpatiaLiteDbSizeArg);
  if (isNaN(maxSpatiaLiteDbSizeMB) || maxSpatiaLiteDbSizeMB <= 0) {
    console.error('❌ --max-spatialite-db-size must be a positive number, got: ' + maxSpatiaLiteDbSizeArg);
    process.exit(1);
  }
  
  const config: EnhancedOrchestratorConfig = {
    region,
    outputPath,
    simplifyTolerance,
    intersectionTolerance,
    replace,
    validate,
    verbose,
    skipBackup,
    buildMaster,
    targetSizeMB,
    maxSpatiaLiteDbSizeMB,
    skipIncompleteTrails
  };

  const orchestrator = new EnhancedPostgresOrchestrator(config);
  await orchestrator.run();

  // --- Build and deploy if requested ---
  if (deploy) {
    console.log(`\n🚢 [DEPLOY] Building and deploying container for region: ${region}`);
    console.log(`🔧 [DEPLOY] Environment: GCP_PROJECT=${process.env.GCP_PROJECT}, GCP_REGION=${process.env.GCP_REGION}`);
    
    if (!process.env.GCP_PROJECT) {
      console.error('❌ [DEPLOY] GCP_PROJECT environment variable is not set');
      process.exit(1);
    }
    if (!process.env.GCP_REGION) {
      console.error('❌ [DEPLOY] GCP_REGION environment variable is not set');
      process.exit(1);
    }
    const imageTag = `gcr.io/${process.env.GCP_PROJECT}/gainiac-${region}:latest`;
    console.log(`🔨 [DEPLOY] Building Docker image: ${imageTag}`);
    // --- Pass REGION as build-arg and fail if not set ---
    if (!region) {
      console.error('❌ [DEPLOY] REGION build-arg is required but not set.');
      process.exit(1);
    }
    const buildResult = spawnSync('docker', [
      'build',
      '--platform', 'linux/amd64',
      '-f', 'api-service/Dockerfile',
      '-t', imageTag,
      '--build-arg', `REGION=${region}`,
      '.'
    ], { 
      stdio: 'inherit',
      env: { ...process.env }
    });
    if (buildResult.status !== 0) {
      console.error('❌ [DEPLOY] Docker build failed');
      process.exit(1);
    }
    // 2. Deploy to Cloud Run
    const deployScript = './scripts/deploy-to-cloudrun.sh';
    console.log(`🚀 [DEPLOY] Deploying to Cloud Run using: ${deployScript}`);
    const deployResult = spawnSync(deployScript, [
      region,
      '--service', `gainiac-${region}`,
      '--project', process.env.GCP_PROJECT,
      '--region', process.env.GCP_REGION,
      '--force'
    ], {
      stdio: 'inherit',
      env: { ...process.env }
    });
    if (deployResult.status !== 0) {
      console.error('❌ [DEPLOY] Cloud Run deploy failed');
      process.exit(1);
    }
    // 3. Get the actual service URL and update api-regions.json if needed
    console.log(`🔍 [DEPLOY] Getting actual service URL for ${region}...`);
    const serviceUrlResult = spawnSync('gcloud', [
      'run', 'services', 'describe', `gainiac-${region}`,
      '--region', process.env.GCP_REGION,
      '--format', 'value(status.url)'
    ], { 
      stdio: 'pipe',
      env: { ...process.env }
    });
    
    if (serviceUrlResult.status === 0) {
      const actualServiceUrl = serviceUrlResult.stdout.toString().trim();
      console.log(`🌐 [DEPLOY] Actual service URL: ${actualServiceUrl}`);
      
      // Update api-regions.json if needed
      await orchestrator.updateApiRegionsJson(region, actualServiceUrl);
    } else {
      console.warn(`⚠️  [DEPLOY] Could not get service URL for ${region}`);
    }
    
    console.log('✅ [DEPLOY] Build and deploy complete!');
  }
}

if (require.main === module) {
  main().catch(console.error);
}