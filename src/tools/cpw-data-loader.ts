#!/usr/bin/env node
/**
 * CPW Data Loader
 * 
 * Downloads all Colorado Parks & Wildlife administrative trail data
 * and stores it in a dedicated 'cotrex' schema in trail_master_db.
 * This provides a complete dataset for use as a data source.
 */

import { Pool } from 'pg';
import axios from 'axios';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface CPWFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: number[][];
  };
  properties: {
    OBJECTID?: number;
    NAME?: string;
    TYPE?: string;
    LENGTH_MILES?: number;
    ELEVATION_GAIN_FT?: number;
    ELEVATION_LOSS_FT?: number;
    MAX_ELEVATION_FT?: number;
    MIN_ELEVATION_FT?: number;
    SURFACE?: string;
    DIFFICULTY?: string;
    REGION?: string;
    COUNTY?: string;
    MANAGEMENT_AGENCY?: string;
    [key: string]: any;
  };
}

interface CPWResponse {
  type: string;
  features: CPWFeature[];
  totalFeatures?: number;
  exceededTransferLimit?: boolean;
}

class CPWDataLoader {
  private readonly baseUrl = 'https://services.arcgis.com/Il8dzHtQyBAJ2Isa/arcgis/rest/services/CPWAdminData/FeatureServer/0';
  private pgClient: Pool;
  
  constructor() {
    const dbConfig = getDatabasePoolConfig();
    this.pgClient = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      max: dbConfig.max,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
    });
  }

  /**
   * Main method to load all CPW data
   */
  async loadAllCPWData(): Promise<void> {
    console.log('🏔️ Starting CPW Data Loader for Colorado Parks & Wildlife...');
    
    try {
      // Step 1: Create cotrex schema
      await this.createCotrexSchema();
      
      // Step 2: Get total feature count
      const totalFeatures = await this.getTotalFeatureCount();
      console.log(`📊 Total CPW features available: ${totalFeatures}`);
      
      // Step 3: Download all features in batches
      await this.downloadAllFeatures(totalFeatures);
      
      // Step 4: Create indexes for performance
      await this.createIndexes();
      
      // Step 5: Generate summary statistics
      await this.generateSummary();
      
      console.log('✅ CPW data loading completed successfully!');
      
    } catch (error) {
      console.error('❌ CPW data loading failed:', error);
      throw error;
    } finally {
      await this.pgClient.end();
    }
  }

  /**
   * Create the cotrex schema and tables
   */
  private async createCotrexSchema(): Promise<void> {
    console.log('📁 Creating cotrex schema...');
    
    // Drop and recreate schema
    await this.pgClient.query('DROP SCHEMA IF EXISTS cotrex CASCADE');
    await this.pgClient.query('CREATE SCHEMA cotrex');
    
    // Create trails table
    await this.pgClient.query(`
      CREATE TABLE cotrex.trails (
        id SERIAL PRIMARY KEY,
        app_uuid UUID DEFAULT gen_random_uuid(),
        cpw_objectid INTEGER UNIQUE,
        name TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        region TEXT,
        county TEXT,
        management_agency TEXT,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        source_tags JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create metadata table
    await this.pgClient.query(`
      CREATE TABLE cotrex.metadata (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        description TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('✅ Cotrex schema created');
  }

  /**
   * Get total feature count from CPW API
   */
  private async getTotalFeatureCount(): Promise<number> {
    console.log('🔍 Getting total feature count...');
    
    const queryParams = new URLSearchParams({
      f: 'json',
      where: '1=1',
      returnCountOnly: 'true'
    });
    
    const response = await axios.get(`${this.baseUrl}/query?${queryParams.toString()}`, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Carthorse-CPW-Loader/1.0'
      }
    });
    
    const count = response.data.count || 0;
    console.log(`📊 Total features: ${count}`);
    return count;
  }

  /**
   * Download all features in batches
   */
  private async downloadAllFeatures(totalFeatures: number): Promise<void> {
    console.log('📥 Downloading all CPW features...');
    
    const batchSize = 1000; // ArcGIS REST API limit
    const totalBatches = Math.ceil(totalFeatures / batchSize);
    
    let totalProcessed = 0;
    let totalInserted = 0;
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const offset = batch * batchSize;
      console.log(`🔄 Processing batch ${batch + 1}/${totalBatches} (offset: ${offset})`);
      
      try {
        const batchResult = await this.downloadBatch(offset, batchSize);
        totalProcessed += batchResult.processed;
        totalInserted += batchResult.inserted;
        
        console.log(`   ✅ Batch ${batch + 1}: ${batchResult.processed} processed, ${batchResult.inserted} inserted`);
        
        // Small delay to be respectful to the API
        await this.sleep(100);
        
      } catch (error) {
        console.error(`❌ Batch ${batch + 1} failed:`, error);
        // Continue with next batch
      }
    }
    
    console.log(`📊 Download Summary:`);
    console.log(`   📥 Total processed: ${totalProcessed}`);
    console.log(`   ✅ Total inserted: ${totalInserted}`);
  }

  /**
   * Download a single batch of features
   */
  private async downloadBatch(offset: number, limit: number): Promise<{ processed: number; inserted: number }> {
    const queryParams = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      resultOffset: offset.toString(),
      resultRecordCount: limit.toString(),
      outSR: '4326'
    });
    
    const response = await axios.get(`${this.baseUrl}/query?${queryParams.toString()}`, {
      timeout: 60000, // Longer timeout for large batches
      headers: {
        'User-Agent': 'Carthorse-CPW-Loader/1.0'
      }
    });
    
    const cpwData: CPWResponse = response.data;
    const features = cpwData.features || [];
    
    let processed = 0;
    let inserted = 0;
    
    for (const feature of features) {
      try {
        if (await this.insertFeature(feature)) {
          inserted++;
        }
        processed++;
      } catch (error) {
        console.warn(`⚠️ Failed to process feature ${feature.properties.OBJECTID}:`, error);
        processed++;
      }
    }
    
    return { processed, inserted };
  }

  /**
   * Insert a single CPW feature
   */
  private async insertFeature(feature: CPWFeature): Promise<boolean> {
    // Skip features without geometry or name
    if (!feature.geometry || !feature.properties.NAME) {
      return false;
    }

    // Convert coordinates to 3D if needed
    const coordinates3D = feature.geometry.coordinates.map(coord => {
      if (coord.length === 2) {
        return [...coord, 0]; // Add Z=0 for 2D coordinates
      } else if (coord.length === 3) {
        return coord; // Keep 3D coordinates as-is
      } else {
        throw new Error(`Invalid coordinate dimension: ${coord.length}`);
      }
    });

    // Convert units (miles to km, feet to meters)
    const lengthKm = (feature.properties.LENGTH_MILES || 0) * 1.60934;
    const elevationGain = (feature.properties.ELEVATION_GAIN_FT || 0) * 0.3048;
    const elevationLoss = (feature.properties.ELEVATION_LOSS_FT || 0) * 0.3048;
    const maxElevation = (feature.properties.MAX_ELEVATION_FT || 0) * 0.3048;
    const minElevation = (feature.properties.MIN_ELEVATION_FT || 0) * 0.3048;

    // Skip very short trails
    if (lengthKm < 0.01) {
      return false;
    }

    const geometryWkt = `LINESTRING Z (${coordinates3D.map(coord => coord.join(' ')).join(', ')})`;
    
    // Calculate bounding box
    const lngs = coordinates3D.map(coord => coord[0]);
    const lats = coordinates3D.map(coord => coord[1]);
    const bboxMinLng = Math.min(...lngs);
    const bboxMaxLng = Math.max(...lngs);
    const bboxMinLat = Math.min(...lats);
    const bboxMaxLat = Math.max(...lats);

    await this.pgClient.query(`
      INSERT INTO cotrex.trails (
        cpw_objectid,
        name,
        trail_type,
        surface,
        difficulty,
        geometry,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        region,
        county,
        management_agency,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        source_tags
      ) VALUES (
        $1, $2, $3, $4, $5, ST_GeomFromText($6, 4326), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT (cpw_objectid) DO UPDATE SET
        name = EXCLUDED.name,
        trail_type = EXCLUDED.trail_type,
        surface = EXCLUDED.surface,
        difficulty = EXCLUDED.difficulty,
        geometry = EXCLUDED.geometry,
        length_km = EXCLUDED.length_km,
        elevation_gain = EXCLUDED.elevation_gain,
        elevation_loss = EXCLUDED.elevation_loss,
        max_elevation = EXCLUDED.max_elevation,
        min_elevation = EXCLUDED.min_elevation,
        avg_elevation = EXCLUDED.avg_elevation,
        region = EXCLUDED.region,
        county = EXCLUDED.county,
        management_agency = EXCLUDED.management_agency,
        bbox_min_lng = EXCLUDED.bbox_min_lng,
        bbox_max_lng = EXCLUDED.bbox_max_lng,
        bbox_min_lat = EXCLUDED.bbox_min_lat,
        bbox_max_lat = EXCLUDED.bbox_max_lat,
        source_tags = EXCLUDED.source_tags,
        updated_at = NOW()
    `, [
      feature.properties.OBJECTID,
      feature.properties.NAME,
      feature.properties.TYPE || 'hiking',
      feature.properties.SURFACE || 'unknown',
      feature.properties.DIFFICULTY || 'unknown',
      geometryWkt,
      lengthKm,
      elevationGain,
      elevationLoss,
      maxElevation,
      minElevation,
      (maxElevation + minElevation) / 2,
      feature.properties.REGION,
      feature.properties.COUNTY,
      feature.properties.MANAGEMENT_AGENCY,
      bboxMinLng,
      bboxMaxLng,
      bboxMinLat,
      bboxMaxLat,
      JSON.stringify(feature.properties)
    ]);

    return true;
  }

  /**
   * Create indexes for performance
   */
  private async createIndexes(): Promise<void> {
    console.log('🔍 Creating indexes for performance...');
    
    await this.pgClient.query(`
      CREATE INDEX idx_cotrex_trails_geometry ON cotrex.trails USING GIST (geometry);
      CREATE INDEX idx_cotrex_trails_region ON cotrex.trails (region);
      CREATE INDEX idx_cotrex_trails_county ON cotrex.trails (county);
      CREATE INDEX idx_cotrex_trails_type ON cotrex.trails (trail_type);
      CREATE INDEX idx_cotrex_trails_bbox ON cotrex.trails (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
    `);
    
    console.log('✅ Indexes created');
  }

  /**
   * Generate summary statistics
   */
  private async generateSummary(): Promise<void> {
    console.log('📊 Generating summary statistics...');
    
    const stats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(DISTINCT region) as regions,
        COUNT(DISTINCT county) as counties,
        COUNT(DISTINCT trail_type) as trail_types,
        SUM(length_km) as total_length_km,
        AVG(length_km) as avg_length_km,
        MIN(length_km) as min_length_km,
        MAX(length_km) as max_length_km
      FROM cotrex.trails
    `);
    
    const summary = stats.rows[0];
    
    // Store metadata
    await this.pgClient.query(`
      INSERT INTO cotrex.metadata (key, value, description) VALUES
        ('total_trails', $1, 'Total number of trails'),
        ('regions', $2, 'Number of regions'),
        ('counties', $3, 'Number of counties'),
        ('trail_types', $4, 'Number of trail types'),
        ('total_length_km', $5, 'Total trail length in kilometers'),
        ('avg_length_km', $6, 'Average trail length in kilometers'),
        ('min_length_km', $7, 'Minimum trail length in kilometers'),
        ('max_length_km', $8, 'Maximum trail length in kilometers'),
        ('last_updated', NOW()::text, 'Last update timestamp')
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `, [
      summary.total_trails,
      summary.regions,
      summary.counties,
      summary.trail_types,
      summary.total_length_km,
      summary.avg_length_km,
      summary.min_length_km,
      summary.max_length_km
    ]);
    
    console.log('📊 CPW Data Summary:');
    console.log(`   🛤️ Total trails: ${summary.total_trails}`);
    console.log(`   🗺️ Regions: ${summary.regions}`);
    console.log(`   🏘️ Counties: ${summary.counties}`);
    console.log(`   🏔️ Trail types: ${summary.trail_types}`);
    console.log(`   📏 Total length: ${summary.total_length_km?.toFixed(1)} km`);
    console.log(`   📏 Average length: ${summary.avg_length_km?.toFixed(2)} km`);
    console.log(`   📏 Length range: ${summary.min_length_km?.toFixed(2)} - ${summary.max_length_km?.toFixed(2)} km`);
  }

  /**
   * Utility function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
async function main(): Promise<void> {
  console.log('🚀 CPW Data Loader Starting...');
  console.log('=' .repeat(50));
  
  const loader = new CPWDataLoader();
  
  try {
    await loader.loadAllCPWData();
    console.log('🎉 CPW data loading completed successfully!');
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Use cotrex.trails as a data source in your backfill services');
    console.log('   2. Query by region, county, or trail type');
    console.log('   3. Integrate with your existing trail processing pipeline');
    console.log('');
    console.log('💡 Example queries:');
    console.log('   SELECT * FROM cotrex.trails WHERE region = \'Boulder\';');
    console.log('   SELECT * FROM cotrex.trails WHERE county = \'Boulder\';');
    console.log('   SELECT * FROM cotrex.trails WHERE trail_type = \'hiking\';');
    
  } catch (error) {
    console.error('💥 CPW data loading failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
