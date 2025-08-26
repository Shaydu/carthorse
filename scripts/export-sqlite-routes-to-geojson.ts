#!/usr/bin/env ts-node

import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface RouteRecommendation {
  route_uuid: string;
  input_length_km: number;
  input_elevation_gain: number;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_score: number;
  route_name: string;
  route_shape: string;
  trail_count: number;
  route_path: string;
  route_edges: string;
  route_geometry: string;
  similarity_score: number;
  created_at: string;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: any;
  properties: {
    id: string;
    route_uuid: string;
    input_length_km: number;
    input_elevation_gain: number;
    recommended_length_km: number;
    recommended_elevation_gain: number;
    route_score: number;
    route_name: string;
    route_shape: string;
    trail_count: number;
    route_path: any;
    route_edges: any;
    similarity_score: number;
    created_at: string;
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function exportSqliteRoutesToGeoJSON(
  sqlitePath: string,
  outputPath: string
): Promise<void> {
  console.log(`📦 Exporting routes from SQLite database: ${sqlitePath}`);
  console.log(`📄 Output GeoJSON: ${outputPath}`);

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(sqlitePath, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        reject(err);
        return;
      }
      console.log('✅ Connected to SQLite database');
    });

    const routeQuery = `SELECT * FROM route_recommendations WHERE route_geometry IS NOT NULL`;
    
    db.all(routeQuery, [], (err, routeRows: RouteRecommendation[]) => {
      if (err) {
        console.error('❌ Error querying route_recommendations:', err.message);
        db.close();
        reject(err);
        return;
      }

      console.log(`📊 Found ${routeRows.length} routes with geometry data`);

      const features: GeoJSONFeature[] = [];

      routeRows.forEach((route, index) => {
        try {
          let geometry;
          try {
            geometry = JSON.parse(route.route_geometry);
          } catch (e) {
            console.warn(`⚠️  Invalid geometry for route ${route.route_uuid}:`, e);
            return;
          }

          let routePath = null;
          let routeEdges = null;

          if (route.route_path) {
            try {
              routePath = JSON.parse(route.route_path);
            } catch (e) {
              console.warn(`⚠️  Invalid route_path for route ${route.route_uuid}:`, e);
            }
          }

          if (route.route_edges) {
            try {
              routeEdges = JSON.parse(route.route_edges);
            } catch (e) {
              console.warn(`⚠️  Invalid route_edges for route ${route.route_uuid}:`, e);
            }
          }

          const feature: GeoJSONFeature = {
            type: 'Feature',
            geometry,
            properties: {
              id: route.route_uuid,
              route_uuid: route.route_uuid,
              input_length_km: route.input_length_km,
              input_elevation_gain: route.input_elevation_gain,
              recommended_length_km: route.recommended_length_km,
              recommended_elevation_gain: route.recommended_elevation_gain,
              route_score: route.route_score,
              route_name: route.route_name,
              route_shape: route.route_shape,
              trail_count: route.trail_count,
              route_path: routePath,
              route_edges: routeEdges,
              similarity_score: route.similarity_score,
              created_at: route.created_at
            }
          };

          features.push(feature);

          if ((index + 1) % 50 === 0) {
            console.log(`📈 Processed ${index + 1}/${routeRows.length} routes`);
          }

        } catch (e) {
          console.error(`❌ Error processing route ${route.route_uuid}:`, e);
        }
      });

      const geojson: GeoJSONCollection = {
        type: 'FeatureCollection',
        features
      };

      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ Successfully exported ${features.length} routes to GeoJSON`);
      console.log(`📁 File saved: ${outputPath}`);
      
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

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: ts-node scripts/export-sqlite-routes-to-geojson.ts <sqlite-db-path> <output-geojson-path>');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node scripts/export-sqlite-routes-to-geojson.ts test-output/boulder-direct-routes.db test-output/boulder-sqlite-layer3-routes.geojson');
    process.exit(1);
  }

  const sqlitePath = args[0];
  const outputPath = args[1];

  try {
    await exportSqliteRoutesToGeoJSON(sqlitePath, outputPath);
    console.log('🎉 Routes export completed successfully!');
  } catch (error) {
    console.error('❌ Routes export failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { exportSqliteRoutesToGeoJSON };
