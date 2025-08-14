#!/usr/bin/env node
import { Pool } from 'pg';
import axios from 'axios';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface CPWFeature {
  attributes: {
    OBJECTID: number;
    name: string;
    type: string;
    length_mi_: number;
    hiking: string;
    surface: string;
    [key: string]: any;
  };
  geometry: {
    paths: number[][][];
  };
}

interface CPWResponse {
  features: CPWFeature[];
  exceededTransferLimit?: boolean;
}

interface CPWInsertResult {
  totalFeatures: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

class CPWGeoJSONToDB {
  private pgClient: Pool;
  private readonly baseUrl = 'https://services.arcgis.com/Il8dzHtQyBAJ2Isa/arcgis/rest/services/CPWAdminData/FeatureServer/0';
  private readonly batchSize = 1000;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async downloadAndInsertAll(): Promise<CPWInsertResult> {
    console.log('🏔️ Downloading CPW data as GeoJSON and inserting to database...');
    
    const result: CPWInsertResult = {
      totalFeatures: 0,
      inserted: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Create cotrex schema and table
      await this.createCotrexSchema();
      
      // Get total feature count
      const totalFeatures = await this.getTotalFeatureCount();
      result.totalFeatures = totalFeatures;
      
      console.log(`📊 Total features to download: ${totalFeatures}`);

      // Download and insert in batches
      let offset = 0;
      while (offset < totalFeatures) {
        console.log(`📥 Downloading batch ${Math.floor(offset / this.batchSize) + 1}/${Math.ceil(totalFeatures / this.batchSize)}...`);
        
        const batch = await this.downloadBatch(offset, this.batchSize);
        const batchResult = await this.insertBatch(batch);
        
        result.inserted += batchResult.inserted;
        result.skipped += batchResult.skipped;
        result.errors.push(...batchResult.errors);
        
        console.log(`   ✅ Batch complete: ${batchResult.inserted} inserted, ${batchResult.skipped} skipped`);
        
        offset += this.batchSize;
        
        // Small delay to be respectful to the API
        await this.sleep(100);
      }

      // Create indexes
      await this.createIndexes();
      
      // Generate summary
      await this.generateSummary(result);

      console.log('✅ CPW GeoJSON processing complete!');
      console.log(`📊 Results: ${result.inserted} inserted, ${result.skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      console.error('❌ Error processing GeoJSON:', error.message);
      result.errors.push(error.message || 'Unknown error');
    }

    return result;
  }

  private async createCotrexSchema(): Promise<void> {
    console.log('🗄️ Creating cotrex schema...');
    
    const createSchemaSQL = `
      CREATE SCHEMA IF NOT EXISTS cotrex;
    `;

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS cotrex.trails (
        id SERIAL PRIMARY KEY,
        cpw_objectid INTEGER UNIQUE,
        name VARCHAR(255),
        trail_type VARCHAR(100),
        length_miles DECIMAL(10,3),
        difficulty VARCHAR(50),
        surface_type VARCHAR(100),
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await this.pgClient.query(createSchemaSQL);
    await this.pgClient.query(createTableSQL);
  }

  private async getTotalFeatureCount(): Promise<number> {
    try {
      const response = await axios.get(`${this.baseUrl}/query`, {
        params: {
          where: '1=1',
          returnCountOnly: true,
          f: 'json'
        },
        timeout: 30000
      });

      return response.data.count || 0;
    } catch (error: any) {
      console.error('Error getting feature count:', error.message);
      return 0;
    }
  }

  private async downloadBatch(offset: number, limit: number): Promise<CPWFeature[]> {
    try {
      const response = await axios.get<CPWResponse>(`${this.baseUrl}/query`, {
        params: {
          where: '1=1',
          outFields: '*',
          returnGeometry: true,
          f: 'json',
          resultOffset: offset,
          resultRecordCount: limit
        },
        timeout: 60000
      });

      return response.data.features || [];
    } catch (error: any) {
      console.error(`Error downloading batch at offset ${offset}:`, error.message);
      return [];
    }
  }

  private async insertBatch(features: CPWFeature[]): Promise<{ inserted: number; skipped: number; errors: string[] }> {
    const result = { inserted: 0, skipped: 0, errors: [] };

    for (const feature of features) {
      try {
        const inserted = await this.insertFeature(feature);
        if (inserted) {
          result.inserted++;
        } else {
          result.skipped++;
        }
      } catch (error: any) {
        result.errors.push(`Error inserting feature ${feature.attributes.OBJECTID}: ${error.message || 'Unknown error'}`);
      }
    }

    return result;
  }

  private async insertFeature(feature: CPWFeature): Promise<boolean> {
    try {
      // Convert geometry from ArcGIS format to WKT
      const wkt = this.convertGeometryToWKT(feature.geometry);
      
      const insertSQL = `
        INSERT INTO cotrex.trails (cpw_objectid, name, trail_type, length_miles, difficulty, surface_type, geometry)
        VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326))
        ON CONFLICT (cpw_objectid) DO UPDATE SET
          name = EXCLUDED.name,
          trail_type = EXCLUDED.trail_type,
          length_miles = EXCLUDED.length_miles,
          difficulty = EXCLUDED.difficulty,
          surface_type = EXCLUDED.surface_type,
          geometry = EXCLUDED.geometry,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id;
      `;

      const values = [
        feature.attributes.OBJECTID,
        feature.attributes.name || 'Unknown Trail',
        feature.attributes.type || 'Unknown',
        feature.attributes.length_mi_ || 0,
        feature.attributes.hiking || 'Unknown',
        feature.attributes.surface || 'Unknown',
        wkt
      ];

      const result = await this.pgClient.query(insertSQL, values);
      return (result.rowCount || 0) > 0;
    } catch (error: any) {
      console.error(`Error inserting feature ${feature.attributes.OBJECTID}:`, error.message);
      return false;
    }
  }

  private convertGeometryToWKT(geometry: any): string {
    try {
      if (!geometry.paths || !geometry.paths[0]) {
        throw new Error('Invalid geometry structure');
      }

      // ArcGIS geometry is in Web Mercator (EPSG:3857), we need to convert to WGS84
      // For now, we'll use the coordinates as-is and let PostGIS handle the conversion
      const path = geometry.paths[0];
      const coordinates = path.map((coord: number[]) => {
        // Convert from Web Mercator to WGS84
        const x = coord[0];
        const y = coord[1];
        
        // Web Mercator to WGS84 conversion
        const lon = (x / 20037508.34) * 180;
        const lat = (Math.atan(Math.exp(y * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
        
        // Add elevation (0) if not present
        return coord.length >= 3 ? [lon, lat, coord[2]] : [lon, lat, 0];
      });

      const wktCoords = coordinates.map((coord: number[]) => `${coord[0]} ${coord[1]} ${coord[2]}`).join(',');
      return `LINESTRING Z (${wktCoords})`;
    } catch (error: any) {
      console.warn('Error converting geometry:', error.message);
      return 'LINESTRING Z (0 0 0)'; // Fallback geometry
    }
  }

  private async createIndexes(): Promise<void> {
    console.log('🔍 Creating indexes...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cotrex_trails_geometry ON cotrex.trails USING GIST (geometry);',
      'CREATE INDEX IF NOT EXISTS idx_cotrex_trails_name ON cotrex.trails (name);',
      'CREATE INDEX IF NOT EXISTS idx_cotrex_trails_type ON cotrex.trails (trail_type);',
      'CREATE INDEX IF NOT EXISTS idx_cotrex_trails_difficulty ON cotrex.trails (difficulty);'
    ];

    for (const indexSQL of indexes) {
      try {
        await this.pgClient.query(indexSQL);
      } catch (error: any) {
        console.warn(`Warning: Could not create index: ${error.message || 'Unknown error'}`);
      }
    }
  }

  private async generateSummary(result: CPWInsertResult): Promise<void> {
    console.log('📊 Generating summary...');
    
    // Get table statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_trails,
        COUNT(DISTINCT trail_type) as unique_types,
        COUNT(DISTINCT difficulty) as unique_difficulties,
        AVG(length_miles) as avg_length_miles,
        MIN(length_miles) as min_length_miles,
        MAX(length_miles) as max_length_miles
      FROM cotrex.trails;
    `;

    const statsResult = await this.pgClient.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log('\n📊 Import Summary:');
    console.log('==================');
    console.log(`Total features downloaded: ${result.totalFeatures}`);
    console.log(`Successfully inserted: ${result.inserted}`);
    console.log(`Skipped (duplicates): ${result.skipped}`);
    console.log(`Errors: ${result.errors.length}`);
    
    console.log('\nDatabase Statistics:');
    console.log(`Total trails in cotrex.trails: ${stats.total_trails}`);
    console.log(`Unique trail types: ${stats.unique_types}`);
    console.log(`Unique difficulties: ${stats.unique_difficulties}`);
    console.log(`Average length: ${parseFloat(stats.avg_length_miles).toFixed(2)} miles`);
    console.log(`Length range: ${parseFloat(stats.min_length_miles).toFixed(2)} - ${parseFloat(stats.max_length_miles).toFixed(2)} miles`);
    
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.slice(0, 10).forEach(error => console.log(`  - ${error}`));
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more errors`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  console.log('🏔️ CPW GeoJSON to Database Tool');
  console.log('================================');
  
  const processor = new CPWGeoJSONToDB();
  
  try {
    const result = await processor.downloadAndInsertAll();
    console.log('\n✅ Processing complete!');
    console.log(`📊 Final results: ${result.inserted} inserted, ${result.skipped} skipped, ${result.errors.length} errors`);
  } finally {
    await processor.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
