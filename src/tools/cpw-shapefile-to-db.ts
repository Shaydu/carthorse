#!/usr/bin/env node
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import extract from 'extract-zip';
import { execSync } from 'child_process';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface CPWTrail {
  cpw_objectid: number;
  name: string;
  trail_type: string;
  length_miles: number;
  difficulty: string;
  surface_type: string;
  geometry: string; // WKT format
  coordinates: number[][]; // 3D coordinates
}

interface CPWInsertResult {
  totalFeatures: number;
  inserted: number;
  skipped: number;
  errors: (string | undefined)[];
}

class CPWShapefileToDB {
  private pgClient: Pool;
  private readonly tempDir = 'data/cpw-shapefile-temp';

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async processShapefileToDB(zipPath: string): Promise<CPWInsertResult> {
    console.log('🏔️ Processing CPW shapefile to database...');
    
    const result: CPWInsertResult = {
      totalFeatures: 0,
      inserted: 0,
      skipped: 0,
      errors: []
    };

    // Create temp directory
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    try {
      let shapefilePath: string;
      
      if (zipPath.endsWith('.zip')) {
        // Extract zip file
        console.log('📦 Extracting shapefile from zip...');
        const extractedPath = await this.extractZipFile(zipPath);
        
        // Find shapefile
        const foundShapefile = this.findShapefile(extractedPath);
        if (!foundShapefile) {
          throw new Error('No shapefile found in zip');
        }
        shapefilePath = foundShapefile;
      } else if (zipPath.endsWith('.shp')) {
        // Direct shapefile path
        console.log('📁 Using direct shapefile path...');
        shapefilePath = zipPath;
      } else {
        throw new Error('File must be either a .zip or .shp file');
      }

      console.log(`📁 Found shapefile: ${path.basename(shapefilePath)}`);

      // Create cotrex schema and table
      await this.createCotrexSchema();
      
      // Get total feature count
      const totalFeatures = await this.getFeatureCount(shapefilePath);
      result.totalFeatures = totalFeatures;
      
      console.log(`📊 Total features to process: ${totalFeatures}`);

      // Process features in batches
      const batchSize = 100; // Smaller batch size for testing
      const maxFeatures = Math.min(totalFeatures, 1000); // Limit to first 1000 features for testing
      for (let offset = 0; offset < maxFeatures; offset += batchSize) {
        const batch = await this.extractBatch(shapefilePath, offset, batchSize);
        const batchResult = await this.insertBatch(batch);
        
        result.inserted += batchResult.inserted;
        result.skipped += batchResult.skipped;
        result.errors.push(...batchResult.errors);
        
        console.log(`   Processed ${offset + batch.length}/${totalFeatures} features (${result.inserted} inserted, ${result.skipped} skipped)`);
      }

      // Create indexes
      await this.createIndexes();
      
      // Generate summary
      await this.generateSummary(result);

      console.log('✅ CPW shapefile processing complete!');
      console.log(`📊 Results: ${result.inserted} inserted, ${result.skipped} skipped, ${result.errors.length} errors`);

    } catch (error: any) {
      console.error('❌ Error processing shapefile:', error);
      result.errors.push(error.message || 'Unknown error');
    } finally {
      // Cleanup
      await this.cleanup();
    }

    return result;
  }

  private async extractZipFile(zipPath: string): Promise<string> {
    const extractedPath = path.resolve(path.join(this.tempDir, 'extracted'));
    
    if (!fs.existsSync(extractedPath)) {
      fs.mkdirSync(extractedPath, { recursive: true });
    }

    await extract(zipPath, { dir: extractedPath });
    return extractedPath;
  }

  private findShapefile(directory: string): string | null {
    const findShapefileRecursive = (dir: string): string | null => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          const found = findShapefileRecursive(fullPath);
          if (found) return found;
        } else if (item.endsWith('.shp')) {
          return fullPath;
        }
      }
      return null;
    };

    return findShapefileRecursive(directory);
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

  private async getFeatureCount(shapefilePath: string): Promise<number> {
    try {
      const output = execSync(`ogrinfo -so "${shapefilePath}" "${path.basename(shapefilePath, '.shp')}"`, { encoding: 'utf8' });
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes('Feature Count:')) {
          const count = parseInt(line.split(':')[1].trim());
          console.log(`📊 Found ${count} features in shapefile`);
          return count;
        }
      }
      console.warn('⚠️ Could not find feature count in ogrinfo output');
      return 0;
    } catch (error: any) {
      console.error('Error getting feature count:', error.message);
      return 0;
    }
  }

  private async extractBatch(shapefilePath: string, offset: number, limit: number): Promise<CPWTrail[]> {
    try {
      // Use ogr2ogr to extract features as GeoJSON
      const tempGeoJSONPath = path.join(this.tempDir, `batch-${offset}.geojson`);
      
      execSync(`ogr2ogr -f GeoJSON -skip ${offset} -limit ${limit} -t_srs EPSG:4326 "${tempGeoJSONPath}" "${shapefilePath}"`, {
        stdio: 'pipe',
        cwd: path.dirname(shapefilePath)
      });

      // Read and parse GeoJSON
      const geojsonData = JSON.parse(fs.readFileSync(tempGeoJSONPath, 'utf8'));
      const trails: CPWTrail[] = [];

      for (const feature of geojsonData.features) {
        try {
          const trail = this.parseFeature(feature);
          if (trail) {
            trails.push(trail);
          }
        } catch (error: any) {
          console.warn(`Warning: Could not parse feature: ${error.message || 'Unknown error'}`);
        }
      }

      // Cleanup temp file
      fs.unlinkSync(tempGeoJSONPath);

      return trails;
    } catch (error) {
      console.error('Error extracting batch:', error);
      return [];
    }
  }

  private parseFeature(feature: any): CPWTrail | null {
    try {
      const properties = feature.properties;
      const geometry = feature.geometry;

      if (!properties || !geometry || geometry.type !== 'LineString') {
        return null;
      }

      // Extract coordinates and convert to 3D
      const coordinates2D = geometry.coordinates;
      const coordinates3D = coordinates2D.map((coord: number[]) => {
        // Add elevation (0) if not present
        return coord.length >= 3 ? coord : [...coord, 0];
      });

      // Convert to WKT format
      const wktCoords = coordinates3D.map((coord: number[]) => `${coord[0]} ${coord[1]} ${coord[2]}`).join(',');
      const wkt = `LINESTRING Z (${wktCoords})`;

      return {
        cpw_objectid: parseInt(properties.OBJECTID || properties.objectid || '0'),
        name: properties.name || properties.NAME || 'Unknown Trail',
        trail_type: properties.type || properties.TYPE || 'Unknown',
        length_miles: parseFloat(properties.length_mi_ || properties.LENGTH_MI_ || properties.length || properties.LENGTH || '0'),
        difficulty: properties.hiking || properties.HIKING || 'Unknown',
        surface_type: properties.surface || properties.SURFACE || 'Unknown',
        geometry: wkt,
        coordinates: coordinates3D
      };
    } catch (error: any) {
      console.warn(`Error parsing feature: ${error.message || 'Unknown error'}`);
      return null;
    }
  }

  private async insertBatch(trails: CPWTrail[]): Promise<{ inserted: number; skipped: number; errors: (string | undefined)[] }> {
    const result: { inserted: number; skipped: number; errors: (string | undefined)[] } = { inserted: 0, skipped: 0, errors: [] };

    for (const trail of trails) {
      try {
        const inserted = await this.insertTrail(trail);
        if (inserted) {
          result.inserted++;
        } else {
          result.skipped++;
        }
      } catch (error: any) {
        result.errors.push(`Error inserting trail ${trail.cpw_objectid}: ${error.message || 'Unknown error'}`);
      }
    }

    return result;
  }

  private async insertTrail(trail: CPWTrail): Promise<boolean> {
    try {
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
        trail.cpw_objectid,
        trail.name,
        trail.trail_type,
        trail.length_miles,
        trail.difficulty,
        trail.surface_type,
        trail.geometry
      ];

      const result = await this.pgClient.query(insertSQL, values);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error(`Error inserting trail ${trail.cpw_objectid}:`, error);
      return false;
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

    const summary = `CPW Data Import Summary
Generated: ${new Date().toISOString()}

Import Results:
- Total features processed: ${result.totalFeatures}
- Successfully inserted: ${result.inserted}
- Skipped (duplicates): ${result.skipped}
- Errors: ${result.errors.length}

Database Statistics:
- Total trails in cotrex.trails: ${stats.total_trails}
- Unique trail types: ${stats.unique_types}
- Unique difficulties: ${stats.unique_difficulties}
- Average length: ${parseFloat(stats.avg_length_miles).toFixed(2)} miles
- Length range: ${parseFloat(stats.min_length_miles).toFixed(2)} - ${parseFloat(stats.max_length_miles).toFixed(2)} miles

Errors (${result.errors.length}):
${result.errors.map(error => `- ${error}`).join('\n')}

Next Steps:
1. Verify data quality in cotrex.trails table
2. Run the CPW backfill service to use this data
3. Consider running the merge process to combine with existing trail data
`;

    const summaryPath = path.join(this.tempDir, 'import-summary.txt');
    fs.writeFileSync(summaryPath, summary);
    console.log(`📝 Summary written to: ${summaryPath}`);
  }

  private async cleanup(): Promise<void> {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn('Warning: Could not cleanup temp directory:', error);
    }
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  // Check if GDAL is installed
  try {
    execSync('ogrinfo --version', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ GDAL is not installed or not in PATH');
    console.error('Please install GDAL first:');
    console.error('  macOS: brew install gdal');
    console.error('  Ubuntu: sudo apt-get install gdal-bin');
    console.error('  Windows: Download from https://gdal.org/download.html');
    process.exit(1);
  }

  const zipPath = process.argv[2] || 'COTREX_Trails.zip';
  
  if (!fs.existsSync(zipPath)) {
    console.error(`❌ Zip file not found: ${zipPath}`);
    process.exit(1);
  }

  console.log(`📁 Processing: ${zipPath}`);

  const processor = new CPWShapefileToDB();
  
  try {
    const result = await processor.processShapefileToDB(zipPath);
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
