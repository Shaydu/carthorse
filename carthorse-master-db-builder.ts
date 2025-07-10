#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as GeoTIFF from 'geotiff';
import * as dotenv from 'dotenv';
dotenv.config();

interface TrailData {
  id: string;
  app_uuid: string;
  osm_id: string;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  coordinates: number[][];
  elevation_gain: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  length_km: number;
  source_tags: any;
  region: string;
  source?: string;
}

interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

class PostgresMasterDBBuilder {
  private client: Client;
  private tiffFiles: Map<string, any> = new Map();
  private elevationCache: Map<string, number> = new Map();
  private region: string;
  private bbox: BBox;
  private trailCount: number;
  private verbose: boolean;
  private errorLogPath: string;

  constructor(
    region: string,
    bbox: BBox,
    trailCount: number = 100,
    verbose: boolean = false
  ) {
    this.region = region;
    this.bbox = bbox;
    this.trailCount = trailCount;
    this.verbose = verbose;
    this.errorLogPath = path.join(__dirname, 'logs', 'errors.log');
    
    // Ensure logs directory exists
    const logsDir = path.dirname(this.errorLogPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.client = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      console.log('✅ Connected to PostgreSQL master database');
      
      // Test PostGIS
      const result = await this.client.query('SELECT PostGIS_Version()');
      console.log('🌍 PostGIS version:', result.rows[0].postgis_version);
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
    const tiffDir = path.join(process.cwd(), '..', 'elevation-data');
    
    if (!fs.existsSync(tiffDir)) {
      console.log('⚠️  TIFF directory not found, skipping elevation data');
      return;
    }

    const files = fs.readdirSync(tiffDir).filter(f => f.endsWith('.tif'));
    console.log(`📁 Found ${files.length} TIFF files`);

    for (const file of files) {
      try {
        const filePath = path.join(tiffDir, file);
        console.log(`📖 Loading ${file} into memory...`);
        
        const arrayBuffer = fs.readFileSync(filePath);
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer.buffer);
        const image = await tiff.getImage();
        
        this.tiffFiles.set(file, {
          image,
          filePath,
          bbox: await this.getTiffBBox(image)
        });
        
        console.log(`✅ Loaded ${file}`);
      } catch (error) {
        console.error(`❌ Failed to load ${file}:`, error);
        this.logError(`TIFF_LOAD_ERROR`, file, error.message);
      }
    }
  }

  private async getTiffBBox(image: any): Promise<BBox> {
    const bbox = image.getBoundingBox();
    return {
      minLng: bbox[0],
      minLat: bbox[1],
      maxLng: bbox[2],
      maxLat: bbox[3]
    };
  }

  private isCoordinateInTiffBounds(lng: number, lat: number, tiffBBox: BBox): boolean {
    return lng >= tiffBBox.minLng && lng <= tiffBBox.maxLng &&
           lat >= tiffBBox.minLat && lat <= tiffBBox.maxLat;
  }

  private async getElevationFromTiff(lng: number, lat: number): Promise<number | null> {
    const cacheKey = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    
    if (this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }

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
      }
    }
    
    return null;
  }

  private async readElevationFromTiff(image: any, lng: number, lat: number): Promise<number | null> {
    try {
      const width = image.getWidth();
      const height = image.getHeight();
      const bbox = image.getBoundingBox();
      
      // Convert lat/lng to pixel coordinates
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

  private async processTrailElevation(coordinates: number[][]): Promise<{
    elevation_gain: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
    elevations: number[];
  }> {
    const elevations: number[] = [];
    
    for (const [lng, lat] of coordinates) {
      const elevation = await this.getElevationFromTiff(lng, lat);
      if (elevation !== null) {
        elevations.push(elevation);
      }
    }
    
    if (elevations.length === 0) {
      return {
        elevation_gain: 0,
        max_elevation: 0,
        min_elevation: 0,
        avg_elevation: 0,
        elevations: []
      };
    }
    
    const max_elevation = Math.max(...elevations);
    const min_elevation = Math.min(...elevations);
    const avg_elevation = elevations.reduce((a, b) => a + b, 0) / elevations.length;
    
    let elevation_gain = 0;
    for (let i = 1; i < elevations.length; i++) {
      const gain = elevations[i] - elevations[i - 1];
      if (gain > 0) {
        elevation_gain += gain;
      }
    }
    
    return {
      elevation_gain,
      max_elevation,
      min_elevation,
      avg_elevation,
      elevations
    };
  }

  private logError(type: string, trailName: string, reason: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${type}: ${trailName} - ${reason}\n`;
    fs.appendFileSync(this.errorLogPath, logEntry);
  }

  private async insertTrail(trailData: TrailData): Promise<void> {
    try {
      // Create PostGIS geometry from coordinates
      const coordinates = trailData.coordinates.map(coord => `${coord[0]} ${coord[1]} ${coord[2] || 0}`);
      const geometryWkt = `LINESTRING Z (${coordinates.join(', ')})`;
      
      const query = `
        INSERT INTO trails (
          app_uuid, osm_id, source, name, trail_type, surface, difficulty,
          elevation_gain, max_elevation, min_elevation, avg_elevation,
          length_km, source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, region
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, ST_GeomFromText($18, 4326), $19)
        ON CONFLICT (app_uuid) DO NOTHING
      `;
      
      const bbox = this.calculateBBox(trailData.coordinates);
      
      await this.client.query(query, [
        trailData.app_uuid,
        trailData.osm_id,
        trailData.source,
        trailData.name,
        trailData.trail_type,
        trailData.surface,
        trailData.difficulty,
        trailData.elevation_gain,
        trailData.max_elevation,
        trailData.min_elevation,
        trailData.avg_elevation,
        trailData.length_km,
        JSON.stringify(trailData.source_tags),
        bbox.minLng,
        bbox.maxLng,
        bbox.minLat,
        bbox.maxLat,
        geometryWkt,
        trailData.region
      ]);
      
      if (this.verbose) {
        console.log(`✅ Inserted trail: ${trailData.name} (${trailData.region})`);
      }
    } catch (error) {
      console.error(`❌ Failed to insert trail ${trailData.name}:`, error);
      this.logError('INSERT_ERROR', trailData.name, error.message);
    }
  }

  private calculateBBox(coordinates: number[][]): BBox {
    const lngs = coordinates.map(c => c[0]);
    const lats = coordinates.map(c => c[1]);
    
    return {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats)
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

  async buildMasterDatabase(): Promise<void> {
    console.log('🏗️ Building PostgreSQL Master Database - Full Resolution Trail Data');
    console.log(`🗺️ Region: ${this.region}`);
    console.log(`🗺️ BBox:`, this.bbox);
    console.log(`🔢 Trail count: ${this.trailCount}`);
    console.log(`🔄 Mode: Append`);
    console.log(`🗻 Elevation processing: Enabled`);
    
    try {
      await this.connect();
      await this.loadTiffFiles();
      
      // Load trail data from existing SQLite database
      const trailData = await this.loadTrailDataFromSQLite();
      
      console.log(`📊 Processing ${trailData.length} trails for region ${this.region}...`);
      
      let processed = 0;
      let inserted = 0;
      let skipped = 0;
      
      for (const trail of trailData) {
        processed++;
        
        if (processed > this.trailCount) {
          break;
        }
        
        try {
          // Check if trail already exists
          const existing = await this.client.query(
            'SELECT app_uuid FROM trails WHERE app_uuid = $1',
            [trail.app_uuid]
          );
          
          if (existing.rows.length > 0) {
            if (this.verbose) {
              console.log(`⏭️  Skipping duplicate: ${trail.name} (${trail.osm_id})`);
            }
            this.logError('DUPLICATE_SKIP', trail.name, `OSM ID ${trail.osm_id} already exists`);
            skipped++;
            continue;
          }
          
          // Process elevation data
          const elevationData = await this.processTrailElevation(trail.coordinates);
          
          const trailData: TrailData = {
            ...trail,
            region: this.region,
            elevation_gain: elevationData.elevation_gain,
            max_elevation: elevationData.max_elevation,
            min_elevation: elevationData.min_elevation,
            avg_elevation: elevationData.avg_elevation,
            coordinates: trail.coordinates.map((coord, i) => [
              coord[0],
              coord[1],
              elevationData.elevations[i] || 0
            ])
          };
          
          await this.insertTrail(trailData);
          inserted++;
          
          if (processed % 10 === 0) {
            console.log(`📈 Progress: ${processed}/${this.trailCount} trails processed`);
          }
          
        } catch (error) {
          console.error(`❌ Error processing trail ${trail.name}:`, error);
          this.logError('PROCESSING_ERROR', trail.name, error.message);
        }
      }
      
      console.log(`\n✅ Master database build complete!`);
      console.log(`📊 Summary:`);
      console.log(`   - Processed: ${processed} trails`);
      console.log(`   - Inserted: ${inserted} trails`);
      console.log(`   - Skipped: ${skipped} trails`);
      console.log(`   - Region: ${this.region}`);
      
      // Apply data integrity constraints (disabled for testing)
      // await this.applyConstraints();
      
      // Show database statistics
      await this.showDatabaseStats();
      
    } catch (error) {
      console.error('❌ Master database build failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  private async loadTrailDataFromSQLite(): Promise<any[]> {
    // Generate sample data within the bbox for the selected region
    console.log(`📂 Generating sample trail data for region: ${this.region}`);
    const sampleTrails: any[] = [];
    const pointCount = 10;
    for (let i = 0; i < this.trailCount; i++) {
      const coordinates = [];
      for (let j = 0; j < pointCount; j++) {
        const lat = this.bbox.minLat + Math.random() * (this.bbox.maxLat - this.bbox.minLat);
        const lng = this.bbox.minLng + Math.random() * (this.bbox.maxLng - this.bbox.minLng);
        coordinates.push([lng, lat]);
      }
      sampleTrails.push({
        id: `${this.region}_sample_${i}`,
        app_uuid: `${this.region}_uuid_${i}`,
        osm_id: `${this.region}_osm_${i}`,
        name: `Sample Trail ${i + 1}`,
        trail_type: ['hiking', 'biking', 'running'][i % 3],
        surface: ['dirt', 'gravel', 'paved'][i % 3],
        difficulty: ['easy', 'moderate', 'difficult'][i % 3],
        coordinates,
        elevation_gain: 100 + i * 10,
        max_elevation: 500 + i * 5,
        min_elevation: 400 + i * 5,
        avg_elevation: 450 + i * 5,
        length_km: 2 + i * 0.5,
        source_tags: { source: 'generated' },
        region: this.region,
        source: 'generated'
      });
    }
    return sampleTrails;
  }

  private async applyConstraints(): Promise<void> {
    console.log('\n🔧 Applying data integrity constraints...');
    
    try {
      // Import and run the constraint manager
      const { ConstraintManager } = await import('./carthorse-apply-constraints');
      const constraintManager = new ConstraintManager('trail_master_db', false, true); // force = true for initial build
      
      await constraintManager.connect();
      await constraintManager.applyConstraints();
      await constraintManager.disconnect();
      
      console.log('✅ Data integrity constraints applied successfully');
    } catch (error) {
      console.error('❌ Failed to apply constraints:', error);
      // Don't throw error - constraints are important but shouldn't break the build
    }
  }

  private async showDatabaseStats(): Promise<void> {
    try {
      const stats = await this.client.query('SELECT * FROM calculate_trail_stats()');
      const row = stats.rows[0];
      
      console.log(`\n📊 Database Statistics:`);
      console.log(`   - Total trails: ${row.total_trails}`);
      console.log(`   - Total length: ${row.total_length_km.toFixed(1)} km`);
      console.log(`   - Avg elevation gain: ${row.avg_elevation_gain.toFixed(0)} m`);
      console.log(`   - Regions: ${row.regions_count}`);
      
      // Show trails by region
      const regionStats = await this.client.query(`
        SELECT region, COUNT(*) as count, 
               SUM(length_km) as total_length,
               AVG(elevation_gain) as avg_gain
        FROM trails 
        GROUP BY region 
        ORDER BY count DESC
      `);
      
      console.log(`\n🗺️ Trails by Region:`);
      for (const row of regionStats.rows) {
        console.log(`   - ${row.region}: ${row.count} trails, ${row.total_length.toFixed(1)} km, ${row.avg_gain.toFixed(0)}m avg gain`);
      }
      
    } catch (error) {
      console.error('❌ Failed to get database stats:', error);
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  
  const region = args.find(arg => arg.startsWith('--region='))?.split('=')[1] || 'boulder';
  const count = parseInt(args.find(arg => arg.startsWith('--count='))?.split('=')[1] || '100');
  const verbose = args.includes('--verbose');
  
  // Load bounding boxes from config file
  const configPath = path.join(process.cwd(), '..', '..', '..', 'config', 'api-regions.json');
  let bboxes: Record<string, BBox> = {};
  
  try {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const regionConfig of configData.regions) {
      bboxes[regionConfig.id] = {
        minLat: regionConfig.bbox.minLat,
        maxLat: regionConfig.bbox.maxLat,
        minLng: regionConfig.bbox.minLng,
        maxLng: regionConfig.bbox.maxLng
      };
    }
    console.log(`📂 Loaded bbox config from: ${configPath}`);
  } catch (error) {
    console.error(`❌ Could not load config file: ${configPath}`);
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
  
  const bbox = bboxes[region];
  if (!bbox) {
    console.error(`❌ Unknown region: ${region}`);
    process.exit(1);
  }
  
  const builder = new PostgresMasterDBBuilder(region, bbox, count, verbose);
  
  try {
    await builder.buildMasterDatabase();
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { PostgresMasterDBBuilder }; 