#!/usr/bin/env ts-node

import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface RouteAnalysis {
  route_uuid: string;
  route_name: string;
  edge_count: number;
  unique_trail_count: number;
  total_distance_km: number;
  total_elevation_gain_m: number;
  out_and_back_distance_km: number;
  out_and_back_elevation_gain_m: number;
  constituent_analysis_json: string;
}

interface ConstituentTrail {
  app_uuid: string;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
}

interface Trail {
  id: number;
  app_uuid: string;
  name: string;
  geojson: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: any;
  properties: {
    route_uuid: string;
    route_name: string;
    edge_count: number;
    unique_trail_count: number;
    total_distance_km: number;
    total_elevation_gain_m: number;
    out_and_back_distance_km: number;
    out_and_back_elevation_gain_m: number;
    constituent_trail_count: number;
    constituent_trails: string[];
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function exportRoutesToGeoJSON(
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

    // First, get all route analysis data
    const routeQuery = `SELECT * FROM route_analysis`;
    
    db.all(routeQuery, [], (err, routeRows: RouteAnalysis[]) => {
      if (err) {
        console.error('❌ Error querying route_analysis:', err.message);
        db.close();
        reject(err);
        return;
      }

      console.log(`📊 Found ${routeRows.length} routes`);

      // Get all trails for lookup
      const trailQuery = `SELECT id, app_uuid, name, geojson, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails`;
      
      db.all(trailQuery, [], (err, trailRows: Trail[]) => {
        if (err) {
          console.error('❌ Error querying trails:', err.message);
          db.close();
          reject(err);
          return;
        }

        console.log(`📊 Found ${trailRows.length} trails for lookup`);

        // Create trail lookup map
        const trailMap = new Map<string, Trail>();
        trailRows.forEach(trail => {
          trailMap.set(trail.app_uuid, trail);
        });

        const features: GeoJSONFeature[] = [];

        routeRows.forEach((route, index) => {
          try {
            // Parse constituent analysis JSON
            const constituentAnalysis = JSON.parse(route.constituent_analysis_json);
            const constituentTrails: ConstituentTrail[] = constituentAnalysis.constituent_trails || [];

            // Collect trail geometries for this route
            const routeCoordinates: number[][] = [];
            const foundTrailNames: string[] = [];

            constituentTrails.forEach(constituentTrail => {
              const trail = trailMap.get(constituentTrail.app_uuid);
              if (trail) {
                try {
                  const trailGeometry = JSON.parse(trail.geojson);
                  if (trailGeometry.coordinates && trailGeometry.coordinates.length > 0) {
                    // Add trail coordinates to route (skip first point if not the first trail to avoid duplication)
                    const coordsToAdd = routeCoordinates.length === 0 
                      ? trailGeometry.coordinates 
                      : trailGeometry.coordinates.slice(1);
                    
                    routeCoordinates.push(...coordsToAdd);
                    foundTrailNames.push(trail.name);
                  }
                } catch (e) {
                  console.warn(`⚠️  Invalid trail geometry for ${trail.app_uuid}:`, e);
                }
              } else {
                console.warn(`⚠️  Trail not found for UUID: ${constituentTrail.app_uuid}`);
              }
            });

            // Create route geometry
            if (routeCoordinates.length > 0) {
              const routeGeometry = {
                type: 'LineString',
                coordinates: routeCoordinates
              };

              const feature: GeoJSONFeature = {
                type: 'Feature',
                geometry: routeGeometry,
                properties: {
                  route_uuid: route.route_uuid,
                  route_name: route.route_name,
                  edge_count: route.edge_count,
                  unique_trail_count: route.unique_trail_count,
                  total_distance_km: route.total_distance_km,
                  total_elevation_gain_m: route.total_elevation_gain_m,
                  out_and_back_distance_km: route.out_and_back_distance_km,
                  out_and_back_elevation_gain_m: route.out_and_back_elevation_gain_m,
                  constituent_trail_count: constituentTrails.length,
                  constituent_trails: foundTrailNames
                }
              };

              features.push(feature);
            } else {
              console.warn(`⚠️  No valid geometry for route: ${route.route_name}`);
            }

            // Progress indicator
            if ((index + 1) % 10 === 0) {
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

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Write GeoJSON file
        fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
        
        console.log(`✅ Successfully exported ${features.length} routes to GeoJSON`);
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
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: ts-node okscripts/export-routes-to-geojson.ts <sqlite-db-path> <output-geojson-path>');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node scripts/export-routes-to-geojson.ts test-output/boulder-small-test.db test-output/boulder-routes.geojson');
    process.exit(1);
  }

  const sqlitePath = args[0];
  const outputPath = args[1];

  try {
    await exportRoutesToGeoJSON(sqlitePath, outputPath);
    console.log('🎉 Routes export completed successfully!');
  } catch (error) {
    console.error('❌ Routes export failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { exportRoutesToGeoJSON };
