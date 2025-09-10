#!/usr/bin/env node

import { Command } from 'commander';
import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: any;
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

interface ExportOptions {
  input: string;
  output?: string;
  tables: string[];
  bbox?: string;
  limit?: number;
  verbose: boolean;
}

class SQLiteToGeoJSONExporter {
  private options: ExportOptions;

  constructor(options: ExportOptions) {
    this.options = options;
  }

  async export(): Promise<void> {
    console.log(`🗺️  Exporting SQLite to GeoJSON...`);
    console.log(`   Input: ${this.options.input}`);
    console.log(`   Tables: ${this.options.tables.join(', ')}`);
    
    if (this.options.bbox) {
      console.log(`   Bounding box: ${this.options.bbox}`);
    }
    
    if (this.options.limit) {
      console.log(`   Limit: ${this.options.limit} features per table`);
    }

    const db = new sqlite3.Database(this.options.input);
    
    try {
      for (const tableName of this.options.tables) {
        await this.exportTable(db, tableName);
      }
      
      console.log(`✅ Export completed successfully!`);
    } finally {
      db.close();
    }
  }

  private async exportTable(db: sqlite3.Database, tableName: string): Promise<void> {
    console.log(`\n📊 Exporting table: ${tableName}`);
    
    // Check if table exists
    const tableExists = await this.checkTableExists(db, tableName);
    if (!tableExists) {
      console.log(`   ⚠️  Table ${tableName} does not exist, skipping...`);
      return;
    }

    // Get table schema to determine which columns contain GeoJSON
    const columns = await this.getTableColumns(db, tableName);
    const geojsonColumns = columns.filter(col => 
      col.name.toLowerCase().includes('geojson') || 
      col.name.toLowerCase().includes('geometry') ||
      col.name.toLowerCase().includes('path')
    );

    if (geojsonColumns.length === 0) {
      console.log(`   ⚠️  No GeoJSON columns found in ${tableName}, skipping...`);
      return;
    }

    console.log(`   Found GeoJSON columns: ${geojsonColumns.map(col => col.name).join(', ')}`);

    // Build query based on available columns and options
    const query = this.buildQuery(tableName, columns, geojsonColumns);
    
    if (this.options.verbose) {
      console.log(`   Query: ${query}`);
    }

    // Execute query and export results
    const features = await this.executeQuery(db, query, geojsonColumns);
    
    if (features.length === 0) {
      console.log(`   ⚠️  No features found in ${tableName}`);
      return;
    }

    // Create output filename
    const outputFile = this.getOutputFile(tableName);
    
    // Write GeoJSON file
    const featureCollection: GeoJSONFeatureCollection = {
      type: 'FeatureCollection',
      features: features
    };

    fs.writeFileSync(outputFile, JSON.stringify(featureCollection, null, 2));
    console.log(`   ✅ Exported ${features.length} features to ${outputFile}`);
  }

  private async checkTableExists(db: sqlite3.Database, tableName: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName],
        (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });
  }

  private async getTableColumns(db: sqlite3.Database, tableName: string): Promise<Array<{name: string, type: string}>> {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(${tableName})`, (err, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({ name: row.name, type: row.type })));
      });
    });
  }

  private buildQuery(tableName: string, columns: Array<{name: string, type: string}>, geojsonColumns: Array<{name: string, type: string}>): string {
    // Select all columns except the GeoJSON columns (we'll handle those separately)
    const nonGeojsonColumns = columns.filter(col => 
      !geojsonColumns.some(geoCol => geoCol.name === col.name)
    );
    
    const selectColumns = [
      ...nonGeojsonColumns.map(col => col.name),
      ...geojsonColumns.map(col => `${col.name} as geojson_data`)
    ];

    let query = `SELECT ${selectColumns.join(', ')} FROM ${tableName}`;
    
    // Add WHERE clause for bounding box if specified
    if (this.options.bbox) {
      const [minLng, minLat, maxLng, maxLat] = this.options.bbox.split(',').map(Number);
      
      // Check if table has bbox columns
      const hasBboxColumns = columns.some(col => 
        ['bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat'].includes(col.name)
      );
      
      if (hasBboxColumns) {
        query += ` WHERE bbox_min_lng >= ${minLng} AND bbox_max_lng <= ${maxLng} AND bbox_min_lat >= ${minLat} AND bbox_max_lat <= ${maxLat}`;
      }
    }
    
    // Add LIMIT if specified
    if (this.options.limit) {
      query += ` LIMIT ${this.options.limit}`;
    }
    
    return query;
  }

  private async executeQuery(db: sqlite3.Database, query: string, geojsonColumns: Array<{name: string, type: string}>): Promise<GeoJSONFeature[]> {
    return new Promise((resolve, reject) => {
      db.all(query, (err, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }

        const features: GeoJSONFeature[] = [];
        
        for (const row of rows) {
          // Find the first non-null GeoJSON column
          let geometry = null;
          let geojsonColumnName = '';
          
          for (const geoCol of geojsonColumns) {
            const geojsonData = row.geojson_data;
            if (geojsonData && geojsonData.trim() !== '') {
              try {
                geometry = JSON.parse(geojsonData);
                geojsonColumnName = geoCol.name;
                break;
              } catch (parseError) {
                if (this.options.verbose) {
                  console.log(`   ⚠️  Failed to parse GeoJSON from ${geoCol.name}: ${parseError}`);
                }
              }
            }
          }
          
          if (!geometry) {
            continue; // Skip rows without valid geometry
          }
          
          // Create properties object from non-GeoJSON columns
          const properties: Record<string, any> = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== 'geojson_data') {
              properties[key] = value;
            }
          }
          
          // Add metadata about which GeoJSON column was used
          properties._geojson_source = geojsonColumnName;
          
          features.push({
            type: 'Feature',
            properties: properties,
            geometry: geometry
          });
        }
        
        resolve(features);
      });
    });
  }

  private getOutputFile(tableName: string): string {
    if (this.options.output) {
      return this.options.output;
    }
    
    const inputDir = path.dirname(this.options.input);
    const inputBase = path.basename(this.options.input, '.db');
    const outputFile = path.join(inputDir, `${inputBase}-${tableName}.geojson`);
    
    return outputFile;
  }
}

// CLI setup
const program = new Command();

program
  .name('sqlite-to-geojson')
  .description('Export SQLite database tables to GeoJSON format')
  .version('1.0.0');

program
  .requiredOption('-i, --input <path>', 'Input SQLite database file')
  .option('-o, --output <path>', 'Output GeoJSON file (if not specified, creates separate files per table)')
  .option('-t, --tables <tables>', 'Comma-separated list of tables to export', 'trails,route_recommendations,routing_nodes,routing_edges')
  .option('-b, --bbox <bbox>', 'Bounding box filter (minLng,minLat,maxLng,maxLat)')
  .option('-l, --limit <number>', 'Limit number of features per table', parseInt)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options) => {
    try {
      // Parse tables option
      const tables = options.tables.split(',').map((t: string) => t.trim());
      
      const exporter = new SQLiteToGeoJSONExporter({
        input: options.input,
        output: options.output,
        tables: tables,
        bbox: options.bbox,
        limit: options.limit,
        verbose: options.verbose
      });
      
      await exporter.export();
    } catch (error) {
      console.error('❌ Export failed:', error);
      process.exit(1);
    }
  });

// Add help examples
program.addHelpText('after', `
Examples:
  $ npx ts-node src/cli/sqlite-to-geojson.ts -i test-output/boulder.db
  $ npx ts-node src/cli/sqlite-to-geojson.ts -i test-output/boulder.db -t trails,route_recommendations
  $ npx ts-node src/cli/sqlite-to-geojson.ts -i test-output/boulder.db -b "-105.3,39.9,-105.2,40.0"
  $ npx ts-node src/cli/sqlite-to-geojson.ts -i test-output/boulder.db -l 100 -v
`);

if (require.main === module) {
  program.parse();
}
