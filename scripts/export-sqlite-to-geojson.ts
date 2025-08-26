#!/usr/bin/env ts-node

import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface Trail {
  id: number;
  app_uuid: string;
  name: string;
  osm_id: string;
  trail_type: string;
  surface_type: string;
  difficulty: string;
  geojson: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  bbox_min_lng: number;
  bbox_max_lng: number;
  bbox_min_lat: number;
  bbox_max_lat: number;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: any;
  properties: {
    id: number;
    app_uuid: string;
    name: string;
    osm_id: string;
    trail_type: string;
    surface_type: string;
    difficulty: string;
    length_km: number;
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
    bbox_min_lng: number;
    bbox_max_lng: number;
    bbox_min_lat: number;
    bbox_max_lat: number;
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function exportSqliteToGeoJSON(
  sqlitePath: string,
  outputPath: string,
  tableName: string = 'trails'
): Promise<void> {
  console.log(`📦 Exporting from SQLite database: ${sqlitePath}`);
  console.log(`📄 Output GeoJSON: ${outputPath}`);
  console.log(`🗃️  Table: ${tableName}`);

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(sqlitePath, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        reject(err);
        return;
      }
      console.log('✅ Connected to SQLite database');
    });

    const query = `SELECT * FROM ${tableName}`;
    
    db.all(query, [], (err, rows: Trail[]) => {
      if (err) {
        console.error('❌ Error querying database:', err.message);
        db.close();
        reject(err);
        return;
      }

      console.log(`📊 Found ${rows.length} trails`);

      const features: GeoJSONFeature[] = rows.map((trail) => {
        let geometry;
        try {
          geometry = JSON.parse(trail.geojson);
        } catch (e) {
          console.warn(`⚠️  Invalid GeoJSON for trail ${trail.id}:`, e);
          geometry = {
            type: 'LineString',
            coordinates: []
          };
        }

        return {
          type: 'Feature' as const,
          geometry,
          properties: {
            id: trail.id,
            app_uuid: trail.app_uuid,
            name: trail.name,
            osm_id: trail.osm_id,
            trail_type: trail.trail_type,
            surface_type: trail.surface_type,
            difficulty: trail.difficulty,
            length_km: trail.length_km,
            elevation_gain: trail.elevation_gain,
            elevation_loss: trail.elevation_loss,
            max_elevation: trail.max_elevation,
            min_elevation: trail.min_elevation,
            avg_elevation: trail.avg_elevation,
            bbox_min_lng: trail.bbox_min_lng,
            bbox_max_lng: trail.bbox_max_lng,
            bbox_min_lat: trail.bbox_min_lat,
            bbox_max_lat: trail.bbox_max_lat,
          }
        };
      });

      const geojson: GeoJSONCollection = {
        type: 'FeatureCollection',
        features
      };

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write GeoJSON file
      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Successfully exported ${features.length} trails to GeoJSON`);
      console.log(`📁 File saved: ${outputPath}`);
      
      // Calculate file size
      const stats = fs.statSync(outputPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`📏 File size: ${fileSizeMB} MB`);

      db.close((err) => {
        if (err) {
          console.error('⚠️  Error closing database:', err.message);
        } else {
          console.log('🔌 Database connection closed');
        }
        resolve();
      });
    });
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: ts-node scripts/export-sqlite-to-geojson.ts <sqlite-db-path> <output-geojson-path> [table-name]');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node scripts/export-sqlite-to-geojson.ts test-output/boulder-small-test.db test-output/boulder-trails.geojson');
    console.log('  ts-node scripts/export-sqlite-to-geojson.ts test-output/boulder-small-test.db test-output/boulder-trails.geojson trails');
    process.exit(1);
  }

  const sqlitePath = args[0];
  const outputPath = args[1];
  const tableName = args[2] || 'trails';

  try {
    await exportSqliteToGeoJSON(sqlitePath, outputPath, tableName);
    console.log('🎉 Export completed successfully!');
  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { exportSqliteToGeoJSON };
