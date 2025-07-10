#!/usr/bin/env ts-node
/**
 * Atomic Trail Insertion System
 * 
 * This system ensures complete trail records are created atomically using PostgreSQL transactions.
 * It prevents the half-baked data issues that plagued SQLite/SpatiaLite by ensuring all
 * required data is present and valid before committing to the database.
 * 
 * Usage:
 *   npx ts-node carthorse-postgres-atomic-insert.ts --db <database_name>
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { ElevationFallbackService, ElevationFallbackConfig } from './elevation-fallback';
import * as dotenv from 'dotenv';
dotenv.config();

interface TrailInsertData {
  osm_id: string;
  name: string;
  trail_type: string;
  surface?: string;
  difficulty?: string;
  coordinates: number[][];
  source_tags: Record<string, string>;
  region: string;
}

interface CompleteTrailRecord {
  app_uuid: string;
  osm_id: string;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  geometry: string; // WKT format
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  length_km: number;
  bbox_min_lng: number;
  bbox_max_lng: number;
  bbox_min_lat: number;
  bbox_max_lat: number;
  source_tags: string; // JSON string
  region: string;
  coordinate_count: number;
  has_3d_geometry: boolean;
  elevation_data_complete: boolean;
  validation_passed: boolean;
}

interface InsertResult {
  success: boolean;
  trail_id?: string;
  error?: string;
  validation_errors?: string[];
  data_quality?: {
    has_3d_geometry: boolean;
    elevation_data_complete: boolean;
    coordinate_count: number;
    length_km: number;
    elevation_gain: number;
  };
  elevation_report?: {
    original_missing: boolean;
    fixed: boolean;
    source?: 'TIFF' | 'USGS_3DEP' | 'SRTM30m' | 'SRTM90m' | 'OpenTopoData';
    coordinates_processed: number;
    coordinates_with_elevation: number;
    elevation_range?: { min: number; max: number; gain: number };
    sources_used: Array<{ source: string; coordinates_found: number; total_coordinates: number }>;
  };
}

// Type for OpenTopoData API response
interface OpenTopoDataResponse {
  results: Array<{ elevation: number }>
}

interface USGS3DEPResponse {
  values: Array<{ value: number }>
}

// Source data directory (set via env or default)
const SOURCE_DATA_DIR = process.env.SOURCE_DATA_DIR || '/path/to/source-data';
// Elevation TIFF directory constant
const ELEVATION_TIFF_DIR = process.env.ELEVATION_TIFF_DIR || path.join(SOURCE_DATA_DIR, 'elevation-data');

class AtomicTrailInserter {
  private client: Client;
  private dbName: string;
  private tiffFiles: Map<string, any> = new Map();
  private elevationCache: Map<string, number> = new Map();
  private elevationFallback: ElevationFallbackService;

  constructor(dbName: string, useFallbackElevation: boolean = false) {
    this.dbName = dbName;
    this.client = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || dbName || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
    
    // Initialize elevation fallback service
    this.elevationFallback = new ElevationFallbackService({
      enabled: useFallbackElevation,
      timeoutMs: 5000,
      cacheResults: true
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      console.log('✅ Connected to PostgreSQL database');
      
      // Test PostGIS
      const result = await this.client.query('SELECT PostGIS_Version()');
      console.log('🌍 PostGIS version:', result.rows[0].postgis_version);
      
      // Load TIFF files for elevation data
      await this.loadTiffFiles();
    } catch (error) {
      console.error('❌ Failed to connect to PostgreSQL:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.end();
    console.log('🔒 Disconnected from PostgreSQL');
  }

  async loadTiffFiles(): Promise<void> {
    console.log('🗻 Loading TIFF files for elevation data...');
    const tiffDir = ELEVATION_TIFF_DIR;
    console.log(`🔍 Looking for TIFF files in: ${tiffDir}`);
    
    if (!fs.existsSync(tiffDir)) {
      console.error('❌ CRITICAL: TIFF directory not found!');
      console.error(`   Expected location: ${tiffDir}`);
      console.error('   Elevation data is required for trail processing.');
      console.error('   Please ensure TIFF files are available before processing.');
      throw new Error('TIFF directory not found - elevation data required');
    }
    
    console.log(`✅ TIFF directory found: ${tiffDir}`);

    const files = fs.readdirSync(tiffDir).filter(f => f.endsWith('.tif'));
    console.log(`📁 Found ${files.length} TIFF files`);

    for (const file of files) {
      try {
        const filePath = path.join(tiffDir, file);
        console.log(`📖 Loading ${file} into memory...`);
        
        const nodeBuffer = fs.readFileSync(filePath);
        const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
        const GeoTIFF = await import('geotiff');
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        
        const bbox = await this.getTiffBBox(image);
        this.tiffFiles.set(file, {
          image,
          filePath,
          bbox
        });
        
        console.log(`✅ Loaded ${file} - Coverage: ${bbox.minLng.toFixed(2)}°W to ${bbox.maxLng.toFixed(2)}°W, ${bbox.minLat.toFixed(2)}°N to ${bbox.maxLat.toFixed(2)}°N`);
      } catch (error) {
        console.error(`❌ Failed to load ${file}:`, error);
        console.error(`   Error details:`, error.message);
        console.error(`   Stack trace:`, error.stack);
      }
    }
    
    console.log(`📊 TIFF loading summary:`);
    console.log(`   - Total files found: ${files.length}`);
    console.log(`   - Successfully loaded: ${this.tiffFiles.size}`);
    console.log(`   - Failed to load: ${files.length - this.tiffFiles.size}`);
    console.log(`   - Loaded files: ${Array.from(this.tiffFiles.keys()).join(', ')}`);
    
    if (this.tiffFiles.size === 0) {
      console.error('❌ CRITICAL: No TIFF files were loaded successfully!');
      console.error('   Elevation data is required for trail processing.');
      console.error('   Please check that TIFF files are valid and accessible.');
      throw new Error('No TIFF files loaded - elevation data required');
    }
  }

  private async getTiffBBox(image: any): Promise<any> {
    const bbox = image.getBoundingBox();
    
    // Check if the coordinates are in Web Mercator (EPSG:3857) or WGS84 (EPSG:4326)
    // Web Mercator coordinates are typically very large (millions)
    // WGS84 coordinates are typically small (-180 to 180 for lng, -90 to 90 for lat)
    
    const isWebMercator = Math.abs(bbox[0]) > 1000 || Math.abs(bbox[1]) > 1000;
    
    if (isWebMercator) {
      // Convert Web Mercator to WGS84
      const minLng = (bbox[0] * 180) / (20037508.34);
      const minLat = (Math.atan(Math.exp(bbox[1] * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
      const maxLng = (bbox[2] * 180) / (20037508.34);
      const maxLat = (Math.atan(Math.exp(bbox[3] * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
      
      return {
        minLng,
        minLat,
        maxLng,
        maxLat
      };
    } else {
      // Already in WGS84 - GeoTIFF bounding box is [minX, minY, maxX, maxY] 
      // where X = longitude, Y = latitude
      // But we need to ensure the bounds are in the correct order
      const minLng = Math.min(bbox[0], bbox[2]);
      const maxLng = Math.max(bbox[0], bbox[2]);
      const minLat = Math.min(bbox[1], bbox[3]);
      const maxLat = Math.max(bbox[1], bbox[3]);
      
      return {
        minLng,
        minLat,
        maxLng,
        maxLat
      };
    }
  }

  private isCoordinateInTiffBounds(lng: number, lat: number, tiffBBox: any): boolean {
    return lng >= tiffBBox.minLng && lng <= tiffBBox.maxLng &&
           lat >= tiffBBox.minLat && lat <= tiffBBox.maxLat;
  }

  private async getElevationFromTiff(lng: number, lat: number): Promise<number | null> {
    const cacheKey = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    
    if (this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }

    console.log(`[DEBUG] Checking elevation for coordinate [${lng}, ${lat}] against ${this.tiffFiles.size} TIFF files`);
    
    for (const [filename, tiffData] of this.tiffFiles) {
      if (this.isCoordinateInTiffBounds(lng, lat, tiffData.bbox)) {
        try {
          const elevation = await this.readElevationFromTiff(tiffData.image, lng, lat);
          if (elevation !== null) {
            this.elevationCache.set(cacheKey, elevation);
            return elevation;
          }
        } catch (error) {
          console.error(`Error reading elevation from ${filename}:`, error);
        }
      } else {
        console.log(`[DEBUG] Coordinate [${lng}, ${lat}] not in ${filename} bounds: ${tiffData.bbox.minLng}°W to ${tiffData.bbox.maxLng}°W, ${tiffData.bbox.minLat}°N to ${tiffData.bbox.maxLat}°N`);
      }
    }
    
    return null;
  }

  private async readElevationFromTiff(image: any, lng: number, lat: number): Promise<number | null> {
    try {
      const width = image.getWidth();
      const height = image.getHeight();
      
      // Use the same bounds calculation as getTiffBBox for consistency
      const tiffBBox = await this.getTiffBBox(image);
      const bbox = [tiffBBox.minLng, tiffBBox.minLat, tiffBBox.maxLng, tiffBBox.maxLat];
      
      // Convert lat/lng to pixel coordinates using the correct bbox
      const pixelX = Math.floor(((lng - bbox[0]) / (bbox[2] - bbox[0])) * width);
      const pixelY = Math.floor(((bbox[3] - lat) / (bbox[3] - bbox[1])) * height);
      
      if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
        return null;
      }
      
      const data = await image.readRasters({
        samples: [0],
        window: [pixelX, pixelY, pixelX + 1, pixelY + 1]
      });
      
      const elevation = data[0][0];
      return elevation !== undefined && elevation !== null ? elevation : null;
    } catch (error) {
      return null;
    }
  }

  private async getElevationFromUSGS3DEP(lng: number, lat: number): Promise<number | null> {
    const cacheKey = `usgs3dep:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }
    try {
      const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSample?geometry={"x":${lng},"y":${lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json() as USGS3DEPResponse;
      if (data && Array.isArray(data.values) && data.values.length > 0) {
        const elevation = data.values[0].value;
        if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
          this.elevationCache.set(cacheKey, elevation);
          return elevation;
        }
      }
    } catch (err) {
      console.error(`[USGS3DEP] Error fetching elevation for [${lng}, ${lat}]:`, err);
    }
    return null;
  }

  private async getElevationFromSRTM30m(lng: number, lat: number): Promise<number | null> {
    const cacheKey = `srtm30m:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }
    try {
      const url = `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json() as OpenTopoDataResponse;
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const elevation = data.results[0].elevation;
        if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
          this.elevationCache.set(cacheKey, elevation);
          return elevation;
        }
      }
    } catch (err) {
      console.error(`[SRTM30m] Error fetching elevation for [${lng}, ${lat}]:`, err);
    }
    return null;
  }

  private async getElevationFromOpenTopoData(lng: number, lat: number): Promise<number | null> {
    const cacheKey = `opentopo:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }
    try {
      const url = `https://api.opentopodata.org/v1/srtm90m?locations=${lat},${lng}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json() as OpenTopoDataResponse;
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const elevation = data.results[0].elevation;
        if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
          this.elevationCache.set(cacheKey, elevation);
          return elevation;
        }
      }
    } catch (err) {
      console.error(`[OpenTopoData] Error fetching elevation for [${lng}, ${lat}]:`, err);
    }
    return null;
  }

  async processTrailElevation(coordinates: number[][]): Promise<{
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
    elevations: number[];
    coordinates3D: number[][];
  }> {
    const elevations: number[] = [];
    const coordinates3D: number[][] = [];
    let validElevationCount = 0;
    
    for (const [lng, lat] of coordinates) {
      // Try TIFF first (highest priority)
      const tiffElevation = await this.getElevationFromTiff(lng, lat);
      
      // Use fallback service if enabled
      const { elevation, source } = await this.elevationFallback.getElevationWithFallback(lng, lat, tiffElevation);
      
      if (elevation !== null && elevation > 0) {
        elevations.push(elevation);
        coordinates3D.push([lng, lat, elevation]);
        validElevationCount++;
      } else {
        console.log(`[DEBUG] Coordinate: [${lng}, ${lat}] -> No elevation data available from any source`);
      }
    }
    
    // If we don't have enough valid elevation data, fail
    if (validElevationCount < 2) {
      console.error(`❌ CRITICAL: Insufficient elevation data for trail!`);
      console.error(`   Only ${validElevationCount} valid elevation points out of ${coordinates.length} coordinates`);
      console.error(`   Trail coordinates may be outside all coverage areas`);
      console.error(`   First few coordinates: ${coordinates.slice(0, 3).map(([lng, lat]) => `[${lng}, ${lat}]`).join(', ')}`);
      throw new Error(`Insufficient elevation data: only ${validElevationCount} valid points out of ${coordinates.length}`);
    }
    
    // Calculate elevation statistics
    let elevation_gain = 0;
    let elevation_loss = 0;
    let max_elevation = Math.max(...elevations);
    let min_elevation = Math.min(...elevations);
    let avg_elevation = elevations.reduce((sum, elev) => sum + elev, 0) / elevations.length;
    
    // Calculate gain/loss
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) {
        elevation_gain += diff;
      } else {
        elevation_loss += Math.abs(diff);
      }
    }
    
    return {
      elevation_gain: Math.round(elevation_gain),
      elevation_loss: Math.round(elevation_loss),
      max_elevation: Math.round(max_elevation),
      min_elevation: Math.round(min_elevation),
      avg_elevation: Math.round(avg_elevation),
      elevations,
      coordinates3D
    };
  }

  private calculateBBox(coordinates: number[][]): {
    bbox_min_lng: number;
    bbox_max_lng: number;
    bbox_min_lat: number;
    bbox_max_lat: number;
  } {
    const lngs = coordinates.map(coord => coord[0]);
    const lats = coordinates.map(coord => coord[1]);
    
    return {
      bbox_min_lng: Math.min(...lngs),
      bbox_max_lng: Math.max(...lngs),
      bbox_min_lat: Math.min(...lats),
      bbox_max_lat: Math.max(...lats)
    };
  }

  private calculateLength(coordinates: number[][]): number {
    let length = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const [lng1, lat1] = coordinates[i - 1];
      const [lng2, lat2] = coordinates[i];
      length += this.haversineDistance(lat1, lng1, lat2, lng2);
    }
    return length;
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private validateTrailData(trailData: CompleteTrailRecord): string[] {
    const errors: string[] = [];
    
    // Required field validation
    if (!trailData.name || trailData.name.trim() === '') {
      errors.push('Trail name is required');
    }
    
    if (!trailData.osm_id || trailData.osm_id.trim() === '') {
      errors.push('OSM ID is required');
    }
    
    if (!trailData.geometry || trailData.geometry.trim() === '') {
      errors.push('Geometry is required');
    }
    
    // Geometry validation
    if (trailData.coordinate_count < 2) {
      errors.push('Trail must have at least 2 coordinate points');
    }
    
    if (!trailData.has_3d_geometry) {
      errors.push('Trail must have 3D geometry with elevation data');
    }
    
    // Elevation data validation
    if (!trailData.elevation_data_complete) {
      errors.push('Complete elevation data is required (gain, loss, min, max, avg)');
    }
    
    if (trailData.elevation_gain < 0) {
      errors.push('Elevation gain cannot be negative');
    }
    
    if (trailData.elevation_loss < 0) {
      errors.push('Elevation loss cannot be negative');
    }
    
    if (trailData.max_elevation < trailData.min_elevation) {
      errors.push('Max elevation cannot be less than min elevation');
    }
    
    if (trailData.avg_elevation < trailData.min_elevation || trailData.avg_elevation > trailData.max_elevation) {
      errors.push('Average elevation must be between min and max elevation');
    }
    
    // Length validation
    if (trailData.length_km <= 0) {
      errors.push('Trail length must be greater than 0');
    }
    
    // BBox validation
    if (trailData.bbox_min_lng >= trailData.bbox_max_lng) {
      errors.push('Invalid bounding box: min_lng >= max_lng');
    }
    
    if (trailData.bbox_min_lat >= trailData.bbox_max_lat) {
      errors.push('Invalid bounding box: min_lat >= max_lat');
    }
    
    return errors;
  }

  async insertTrailAtomically(trailData: TrailInsertData): Promise<InsertResult> {
    try {
      // Start transaction
      await this.client.query('BEGIN');
      
      console.log(`🔍 Processing trail: ${trailData.name} (OSM: ${trailData.osm_id})`);
      
      // Step 1: Process elevation data
      console.log('   📈 Processing elevation data...');
      const elevationData = await this.processTrailElevation(trailData.coordinates);
      
      // Step 2: Calculate derived data
      console.log('   📐 Calculating derived data...');
      const bbox = this.calculateBBox(trailData.coordinates);
      const length_km = this.calculateLength(trailData.coordinates);
      
      // Step 3: Create 3D geometry
      console.log('   🗺️ Creating 3D geometry...');
      const coordinates3D = elevationData.coordinates3D;
      const geometryWkt = `LINESTRING Z (${coordinates3D.map(coord => `${coord[0]} ${coord[1]} ${coord[2]}`).join(', ')})`;
      
      // Step 4: Validate geometry using PostGIS
      console.log('   ✅ Validating geometry...');
      const geometryValidation = await this.client.query(`
        SELECT 
          ST_IsValid(ST_GeomFromText($1, 4326)) as is_valid,
          ST_NDims(ST_GeomFromText($1, 4326)) as dimensions,
          ST_NPoints(ST_GeomFromText($1, 4326)) as point_count,
          ST_GeometryType(ST_GeomFromText($1, 4326)) as geometry_type
      `, [geometryWkt]);
      
      const geomValid = geometryValidation.rows[0];
      
      // Step 5: Build complete trail record
      const completeTrail: CompleteTrailRecord = {
        app_uuid: uuidv4(),
        osm_id: trailData.osm_id,
        name: trailData.name,
        trail_type: trailData.trail_type,
        surface: trailData.surface || 'unknown',
        difficulty: trailData.difficulty || 'unknown',
        geometry: geometryWkt,
        elevation_gain: elevationData.elevation_gain,
        elevation_loss: elevationData.elevation_loss,
        max_elevation: elevationData.max_elevation,
        min_elevation: elevationData.min_elevation,
        avg_elevation: elevationData.avg_elevation,
        length_km,
        bbox_min_lng: bbox.bbox_min_lng,
        bbox_max_lng: bbox.bbox_max_lng,
        bbox_min_lat: bbox.bbox_min_lat,
        bbox_max_lat: bbox.bbox_max_lat,
        source_tags: JSON.stringify(trailData.source_tags),
        region: trailData.region,
        coordinate_count: coordinates3D.length,
        has_3d_geometry: geomValid.dimensions === 3,
        elevation_data_complete: elevationData.elevation_gain > 0 && elevationData.max_elevation > 0,
        validation_passed: false
      };
      
      // Step 6: Validate complete record
      console.log('   🔍 Validating complete record...');
      const validationErrors = this.validateTrailData(completeTrail);
      
      if (validationErrors.length > 0) {
        console.log(`   ❌ Validation failed: ${validationErrors.join(', ')}`);
        await this.client.query('ROLLBACK');
        return {
          success: false,
          error: 'Validation failed',
          validation_errors: validationErrors
        };
      }
      
      // Step 7: Upsert (insert or update by osm_id)
      console.log('   💾 Upserting complete record...');
      const upsertQuery = `
        INSERT INTO trails (
          app_uuid, osm_id, source, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          length_km, source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, region
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, ST_GeomFromText($19, 4326), $20)
        ON CONFLICT (osm_id) DO UPDATE SET
          app_uuid = EXCLUDED.app_uuid,
          source = EXCLUDED.source,
          name = EXCLUDED.name,
          trail_type = EXCLUDED.trail_type,
          surface = EXCLUDED.surface,
          difficulty = EXCLUDED.difficulty,
          elevation_gain = EXCLUDED.elevation_gain,
          elevation_loss = EXCLUDED.elevation_loss,
          max_elevation = EXCLUDED.max_elevation,
          min_elevation = EXCLUDED.min_elevation,
          avg_elevation = EXCLUDED.avg_elevation,
          length_km = EXCLUDED.length_km,
          source_tags = EXCLUDED.source_tags,
          bbox_min_lng = EXCLUDED.bbox_min_lng,
          bbox_max_lng = EXCLUDED.bbox_max_lng,
          bbox_min_lat = EXCLUDED.bbox_min_lat,
          bbox_max_lat = EXCLUDED.bbox_max_lat,
          geometry = EXCLUDED.geometry,
          region = EXCLUDED.region
        RETURNING app_uuid
      `;
      const upsertResult = await this.client.query(upsertQuery, [
        completeTrail.app_uuid,
        completeTrail.osm_id,
        'osm',
        completeTrail.name,
        completeTrail.trail_type,
        completeTrail.surface,
        completeTrail.difficulty,
        completeTrail.elevation_gain,
        completeTrail.elevation_loss,
        completeTrail.max_elevation,
        completeTrail.min_elevation,
        completeTrail.avg_elevation,
        completeTrail.length_km,
        completeTrail.source_tags,
        completeTrail.bbox_min_lng,
        completeTrail.bbox_max_lng,
        completeTrail.bbox_min_lat,
        completeTrail.bbox_max_lat,
        completeTrail.geometry,
        completeTrail.region
      ]);
      // Step 8: Commit transaction
      await this.client.query('COMMIT');
      console.log(`   ✅ Successfully upserted trail: ${completeTrail.name} (${upsertResult.rows[0].app_uuid})`);
      return {
        success: true,
        trail_id: upsertResult.rows[0].app_uuid,
        data_quality: {
          has_3d_geometry: completeTrail.has_3d_geometry,
          elevation_data_complete: completeTrail.elevation_data_complete,
          coordinate_count: completeTrail.coordinate_count,
          length_km: completeTrail.length_km,
          elevation_gain: completeTrail.elevation_gain
        }
      };
      
    } catch (error) {
      // Rollback transaction on any error
      await this.client.query('ROLLBACK');
      console.error(`   ❌ Transaction failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async insertTrailsBatch(trails: TrailInsertData[]): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: InsertResult[];
  }> {
    console.log(`🚀 Starting batch insertion of ${trails.length} trails...`);
    
    const results: InsertResult[] = [];
    let successful = 0;
    let failed = 0;
    
    for (let i = 0; i < trails.length; i++) {
      const trail = trails[i];
      console.log(`\n📍 Processing trail ${i + 1}/${trails.length}: ${trail.name}`);
      
      const result = await this.insertTrailAtomically(trail);
      results.push(result);
      
      if (result.success) {
        successful++;
        console.log(`✅ Trail ${i + 1} inserted successfully`);
      } else {
        failed++;
        console.log(`❌ Trail ${i + 1} failed: ${result.error}`);
        if (result.validation_errors) {
          console.log(`   Validation errors: ${result.validation_errors.join(', ')}`);
        }
      }
    }
    
    console.log(`\n📊 Batch insertion complete:`);
    console.log(`   - Total: ${trails.length}`);
    console.log(`   - Successful: ${successful}`);
    console.log(`   - Failed: ${failed}`);
    
    return {
      total: trails.length,
      successful,
      failed,
      results
    };
  }

  /**
   * Process specific trails by OSM IDs
   */
  async processTrailsByOsmIds(osmIds: string[]): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: InsertResult[];
  }> {
    console.log(`🎯 Processing ${osmIds.length} specific trails by OSM IDs...`);
    
    const results: InsertResult[] = [];
    let successful = 0;
    let failed = 0;
    
    for (let i = 0; i < osmIds.length; i++) {
      const osmId = osmIds[i];
      console.log(`\n📍 Processing trail ${i + 1}/${osmIds.length}: OSM ID ${osmId}`);
      
      try {
        // Fetch trail data from database by OSM ID
        const trailQuery = `
          SELECT 
            osm_id, name, trail_type, surface, difficulty,
            ST_AsText(geometry) as geometry_text,
            source_tags, region
          FROM trails 
          WHERE osm_id = $1
        `;
        
        const trailResult = await this.client.query(trailQuery, [osmId]);
        
        if (trailResult.rows.length === 0) {
          console.log(`❌ Trail with OSM ID ${osmId} not found in database`);
          failed++;
          results.push({
            success: false,
            error: `Trail with OSM ID ${osmId} not found`
          });
          continue;
        }
        
        const trailRow = trailResult.rows[0];
        
        // Parse geometry to get coordinates
        const geometryMatch = trailRow.geometry_text.match(/LINESTRING(?: Z)?\s*\(([^)]+)\)/);
        if (!geometryMatch) {
          console.log(`❌ Invalid geometry for trail ${osmId}`);
          console.log(`   Raw geometry: ${trailRow.geometry_text}`);
          failed++;
          results.push({
            success: false,
            error: `Invalid geometry for trail ${osmId}`
          });
          continue;
        }
        
        const coordPairs = geometryMatch[1].split(',').map(pair => pair.trim());
        const coordinates = coordPairs.map(pair => {
          const coords = pair.split(' ').map(Number);
          return [coords[0], coords[1]]; // [lng, lat]
        });
        
        console.log(`   ✅ Parsed ${coordinates.length} coordinates from geometry`);
        
        // Create trail data for processing
        const trailData: TrailInsertData = {
          osm_id: trailRow.osm_id,
          name: trailRow.name,
          trail_type: trailRow.trail_type,
          surface: trailRow.surface,
          difficulty: trailRow.difficulty,
          coordinates,
          source_tags: typeof trailRow.source_tags === 'string' 
            ? JSON.parse(trailRow.source_tags) 
            : trailRow.source_tags,
          region: trailRow.region
        };
        
        // Process trail with elevation data
        const result = await this.insertTrailAtomically(trailData);
        results.push(result);
        
        if (result.success) {
          successful++;
          console.log(`✅ Trail ${osmId} processed successfully`);
        } else {
          failed++;
          console.log(`❌ Trail ${osmId} failed: ${result.error}`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing trail ${osmId}:`, error);
        failed++;
        results.push({
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(`\n📊 Processing complete:`);
    console.log(`   - Total: ${osmIds.length}`);
    console.log(`   - Successful: ${successful}`);
    console.log(`   - Failed: ${failed}`);
    
    return {
      total: osmIds.length,
      successful,
      failed,
      results
    };
  }
}

// Example usage
async function main() {
  const args = process.argv.slice(2);
  const dbName = args.find(arg => !arg.startsWith('--')) || 'trail_master_db';
  const useFallbackElevation = args.includes('--use-fallback-elevation-sources');
  
  // Parse OSM IDs from command line (comma-separated)
  const osmIdsArg = args.find(arg => arg.startsWith('--osm-ids='));
  const osmIds = osmIdsArg ? osmIdsArg.split('=')[1].split(',').map(id => id.trim()) : null;
  
  console.log('🚀 Atomic Trail Insertion System');
  console.log('================================');
  console.log(`📊 Database: ${dbName}`);
  console.log(`🗻 Fallback elevation sources: ${useFallbackElevation ? 'ENABLED' : 'DISABLED'}`);
  if (osmIds) {
    console.log(`🎯 Processing specific OSM IDs: ${osmIds.join(', ')}`);
  } else {
    console.log(`🎯 Processing all trails in database`);
  }
  
  const inserter = new AtomicTrailInserter(dbName, useFallbackElevation);
  
  try {
    await inserter.connect();
    await inserter.loadTiffFiles();
    
    if (osmIds) {
      // Process specific trails by OSM IDs
      const result = await inserter.processTrailsByOsmIds(osmIds);
      
      console.log('\n📊 Processing Summary:');
      console.log(`   - Total trails: ${result.total}`);
      console.log(`   - Successful: ${result.successful}`);
      console.log(`   - Failed: ${result.failed}`);
      
      // Show cache statistics if fallback is enabled
      if (useFallbackElevation) {
        const cacheStats = inserter['elevationFallback'].getCacheStats();
        console.log(`   - Elevation cache hits: ${cacheStats.size}`);
      }
      
    } else {
      // Example trail data for testing
      const sampleTrail: TrailInsertData = {
        osm_id: '123456789',
        name: 'Sample Trail',
        trail_type: 'hiking',
        surface: 'dirt',
        difficulty: 'moderate',
        coordinates: [
          [-105.2705, 40.0150],
          [-105.2706, 40.0151],
          [-105.2707, 40.0152]
        ],
        source_tags: {
          'highway': 'path',
          'surface': 'dirt'
        },
        region: 'boulder'
      };
      
      const result = await inserter.insertTrailAtomically(sampleTrail);
      
      if (result.success) {
        console.log('✅ Trail inserted successfully!');
        console.log('Data quality:', result.data_quality);
      } else {
        console.log('❌ Trail insertion failed:', result.error);
        if (result.validation_errors) {
          console.log('Validation errors:', result.validation_errors);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await inserter.disconnect();
  }
}

if (require.main === module) {
  main();
}

export { AtomicTrailInserter, TrailInsertData, CompleteTrailRecord, InsertResult }; 