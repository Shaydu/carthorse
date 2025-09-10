#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class SQLiteToGeoJSONExporter {
  constructor(options) {
    this.options = options;
  }

  async export() {
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

  async exportTable(db, tableName) {
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
    const features = await this.executeQuery(db, query, geojsonColumns, tableName);
    
    if (features.length === 0) {
      console.log(`   ⚠️  No features found in ${tableName}`);
      return;
    }

    // Create output filename
    const outputFile = this.getOutputFile(tableName);
    
    // Write GeoJSON file
    const featureCollection = {
      type: 'FeatureCollection',
      features: features
    };

    fs.writeFileSync(outputFile, JSON.stringify(featureCollection, null, 2));
    console.log(`   ✅ Exported ${features.length} features to ${outputFile}`);
  }

  async checkTableExists(db, tableName) {
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

  async getTableColumns(db, tableName) {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({ name: row.name, type: row.type })));
      });
    });
  }

  buildQuery(tableName, columns, geojsonColumns) {
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

  async executeQuery(db, query, geojsonColumns, tableName) {
    return new Promise((resolve, reject) => {
      db.all(query, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const features = [];
        
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
          const properties = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== 'geojson_data') {
              properties[key] = value;
            }
          }
          
          // Add metadata about which GeoJSON column was used
          properties._geojson_source = geojsonColumnName;
          
          // Add styling properties based on table type
          this.addStylingProperties(properties, tableName);
          
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

  addStylingProperties(properties, tableName) {
    // Add color and styling properties for different table types
    switch (tableName) {
      case 'trails':
        properties._color = '#2E8B57'; // Sea Green
        properties._stroke = '#2E8B57';
        properties._strokeWidth = 3;
        properties._strokeOpacity = 0.8;
        properties._fill = '#2E8B57';
        properties._fillOpacity = 0.3;
        properties._type = 'trail';
        break;
        
      case 'route_recommendations':
        properties._color = '#FF6B6B'; // Red
        properties._stroke = '#FF6B6B';
        properties._strokeWidth = 4;
        properties._strokeOpacity = 0.9;
        properties._fill = '#FF6B6B';
        properties._fillOpacity = 0.2;
        properties._type = 'route';
        
        // Add route-specific styling based on route shape
        if (properties.route_shape) {
          switch (properties.route_shape) {
            case 'loop':
              properties._strokeDasharray = '5,5';
              properties._color = '#4ECDC4'; // Teal
              properties._stroke = '#4ECDC4';
              break;
            case 'out-and-back':
              properties._strokeDasharray = '10,5';
              properties._color = '#45B7D1'; // Blue
              properties._stroke = '#45B7D1';
              break;
            case 'lollipop':
              properties._strokeDasharray = '15,5,5,5';
              properties._color = '#96CEB4'; // Light Green
              properties._stroke = '#96CEB4';
              break;
            case 'point-to-point':
              properties._strokeDasharray = '20,5';
              properties._color = '#FFEAA7'; // Yellow
              properties._stroke = '#FFEAA7';
              break;
          }
        }
        break;
        
      case 'routing_nodes':
        properties._color = '#6C5CE7'; // Purple
        properties._stroke = '#6C5CE7';
        properties._strokeWidth = 2;
        properties._strokeOpacity = 1.0;
        properties._fill = '#6C5CE7';
        properties._fillOpacity = 0.7;
        properties._type = 'node';
        properties._radius = 5;
        break;
        
      case 'routing_edges':
        properties._color = '#A29BFE'; // Light Purple
        properties._stroke = '#A29BFE';
        properties._strokeWidth = 2;
        properties._strokeOpacity = 0.6;
        properties._fill = '#A29BFE';
        properties._fillOpacity = 0.1;
        properties._type = 'edge';
        break;
        
      default:
        properties._color = '#95A5A6'; // Gray
        properties._stroke = '#95A5A6';
        properties._strokeWidth = 2;
        properties._strokeOpacity = 0.7;
        properties._fill = '#95A5A6';
        properties._fillOpacity = 0.2;
        properties._type = 'unknown';
    }
    
    // Add difficulty-based styling for trails
    if (tableName === 'trails' && properties.difficulty) {
      switch (properties.difficulty) {
        case 'easy':
          properties._color = '#2ECC71'; // Green
          properties._stroke = '#2ECC71';
          break;
        case 'moderate':
          properties._color = '#F39C12'; // Orange
          properties._stroke = '#F39C12';
          break;
        case 'hard':
          properties._color = '#E74C3C'; // Red
          properties._stroke = '#E74C3C';
          break;
        case 'expert':
          properties._color = '#8E44AD'; // Purple
          properties._stroke = '#8E44AD';
          break;
      }
    }
    
    // Add length-based styling for routes
    if (tableName === 'route_recommendations' && properties.recommended_length_km) {
      const length = properties.recommended_length_km;
      if (length < 5) {
        properties._strokeWidth = 2;
      } else if (length < 15) {
        properties._strokeWidth = 3;
      } else if (length < 30) {
        properties._strokeWidth = 4;
      } else {
        properties._strokeWidth = 5;
      }
    }
  }

  getOutputFile(tableName) {
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
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    output: null,
    tables: ['trails', 'route_recommendations', 'routing_nodes', 'routing_edges'],
    bbox: null,
    limit: null,
    verbose: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '-i':
      case '--input':
        options.input = args[++i];
        break;
      case '-o':
      case '--output':
        options.output = args[++i];
        break;
      case '-t':
      case '--tables':
        options.tables = args[++i].split(',').map(t => t.trim());
        break;
      case '-b':
      case '--bbox':
        options.bbox = args[++i];
        break;
      case '-l':
      case '--limit':
        options.limit = parseInt(args[++i]);
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '-h':
      case '--help':
        console.log(`
Usage: node sqlite-to-geojson.js [options]

Options:
  -i, --input <path>     Input SQLite database file (required)
  -o, --output <path>    Output GeoJSON file (if not specified, creates separate files per table)
  -t, --tables <tables>  Comma-separated list of tables to export (default: trails,route_recommendations,routing_nodes,routing_edges)
  -b, --bbox <bbox>      Bounding box filter (minLng,minLat,maxLng,maxLat)
  -l, --limit <number>   Limit number of features per table
  -v, --verbose          Verbose output
  -h, --help             Show this help message

Examples:
  $ node sqlite-to-geojson.js -i test-output/boulder.db
  $ node sqlite-to-geojson.js -i test-output/boulder.db -t trails,route_recommendations
  $ node sqlite-to-geojson.js -i test-output/boulder.db -b "-105.3,39.9,-105.2,40.0"
  $ node sqlite-to-geojson.js -i test-output/boulder.db -l 100 -v
`);
        process.exit(0);
        break;
    }
  }
  
  if (!options.input) {
    console.error('❌ Error: Input file is required. Use -i or --input option.');
    console.log('Use -h or --help for usage information.');
    process.exit(1);
  }
  
  return options;
}

// Main execution
async function main() {
  try {
    const options = parseArgs();
    const exporter = new SQLiteToGeoJSONExporter(options);
    await exporter.export();
  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = SQLiteToGeoJSONExporter;
