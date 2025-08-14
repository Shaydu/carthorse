#!/usr/bin/env node
import { Pool } from 'pg';
import * as fs from 'fs';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface GeoJSONFeature {
  type: string;
  properties: {
    OBJECTID: number;
    name: string;
    type: string;
    length_mi_: number;
    hiking: string;
    surface: string;
    [key: string]: any;
  };
  geometry: {
    type: string;
    coordinates: number[][];
  };
}

interface GeoJSONData {
  type: string;
  features: GeoJSONFeature[];
}

interface CPWInsertResult {
  totalFeatures: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

class CPWLocalGeoJSONToDB {
  private pgClient: Pool;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async processGeoJSONFile(filePath: string): Promise<CPWInsertResult> {
    console.log(`🏔️ Processing GeoJSON file: ${filePath}`);
    
    const result: CPWInsertResult = {
      totalFeatures: 0,
      inserted: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read and parse GeoJSON file
      console.log('📖 Reading GeoJSON file...');
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const geojsonData: GeoJSONData = JSON.parse(fileContent);
      
      if (!geojsonData.features || !Array.isArray(geojsonData.features)) {
        throw new Error('Invalid GeoJSON: no features array found');
      }

      result.totalFeatures = geojsonData.features.length;
      console.log(`📊 Found ${result.totalFeatures} features in GeoJSON file`);

      // Create cotrex schema and table
      await this.createCotrexSchema();
      
      // Process features in batches
      const batchSize = 1000;
      for (let i = 0; i < geojsonData.features.length; i += batchSize) {
        const batch = geojsonData.features.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(geojsonData.features.length / batchSize);
        
        console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} features)...`);
        
        const batchResult = await this.insertBatch(batch);
        result.inserted += batchResult.inserted;
        result.skipped += batchResult.skipped;
        result.errors.push(...batchResult.errors);
        
        console.log(`   ✅ Batch complete: ${batchResult.inserted} inserted, ${batchResult.skipped} skipped`);
      }

      // Create indexes
      await this.createIndexes();
      
      // Generate summary
      await this.generateSummary(result);

      console.log('✅ GeoJSON processing complete!');
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

  private async insertBatch(features: GeoJSONFeature[]): Promise<{ inserted: number; skipped: number; errors: string[] }> {
    const result: { inserted: number; skipped: number; errors: string[] } = { inserted: 0, skipped: 0, errors: [] };

    for (const feature of features) {
      try {
        const inserted = await this.insertFeature(feature);
        if (inserted) {
          result.inserted++;
        } else {
          result.skipped++;
        }
      } catch (error: any) {
        result.errors.push(`Error inserting feature ${feature.properties.OBJECTID}: ${error.message || 'Unknown error'}`);
      }
    }

    return result;
  }

  private async insertFeature(feature: GeoJSONFeature): Promise<boolean> {
    try {
      // Convert geometry to WKT
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
        feature.properties.OBJECTID,
        feature.properties.name || 'Unknown Trail',
        feature.properties.type || 'Unknown',
        feature.properties.length_mi_ || 0,
        feature.properties.hiking || 'Unknown',
        feature.properties.surface || 'Unknown',
        wkt
      ];

      const result = await this.pgClient.query(insertSQL, values);
      return (result.rowCount || 0) > 0;
    } catch (error: any) {
      console.error(`Error inserting feature ${feature.properties.OBJECTID}:`, error.message);
      return false;
    }
  }

  private convertGeometryToWKT(geometry: any): string {
    try {
      if (geometry.type !== 'LineString' || !geometry.coordinates || !Array.isArray(geometry.coordinates)) {
        throw new Error('Invalid LineString geometry');
      }

      const coordinates = geometry.coordinates.map((coord: number[]) => {
        // Ensure we have 3D coordinates (add elevation 0 if missing)
        return coord.length >= 3 ? coord : [...coord, 0];
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
    console.log(`Total features in GeoJSON: ${result.totalFeatures}`);
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

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  const filePath = process.argv[2] || 'COTREX_Trails.geojson';
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.log('Usage: npx ts-node src/tools/cpw-local-geojson-to-db.ts [path-to-geojson-file]');
    process.exit(1);
  }

  console.log('🏔️ CPW Local GeoJSON to Database Tool');
  console.log('=====================================');
  
  const processor = new CPWLocalGeoJSONToDB();
  
  try {
    const result = await processor.processGeoJSONFile(filePath);
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
