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
  similarity_score: number;
  created_at: string;
}

interface RouteEdge {
  id: string;
  cost: number;
  trail_name: string;
  trail_type: string;
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
    route_shape: string;
    trail_count: number;
    input_length_km: number;
    input_elevation_gain: number;
    recommended_length_km: number;
    recommended_elevation_gain: number;
    route_score: number;
    similarity_score: number;
    created_at: string;
    constituent_trail_count: number;
    constituent_trails: string[];
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function exportRouteRecommendationsToGeoJSON(
  sqlitePath: string,
  outputPath: string
): Promise<void> {
  console.log(`📦 Exporting route recommendations from SQLite database: ${sqlitePath}`);
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

    // Get all route recommendations
    const routeQuery = `SELECT * FROM route_recommendations WHERE route_edges IS NOT NULL AND route_edges != '[]'`;
    
    db.all(routeQuery, [], (err, routeRows: RouteRecommendation[]) => {
      if (err) {
        console.error('❌ Error querying route_recommendations:', err.message);
        db.close();
        reject(err);
        return;
      }

      console.log(`📊 Found ${routeRows.length} route recommendations with edge data`);

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

        // Create trail lookup map by name (since route_edges references trail names)
        const trailMapByName = new Map<string, Trail[]>();
        trailRows.forEach(trail => {
          if (!trailMapByName.has(trail.name)) {
            trailMapByName.set(trail.name, []);
          }
          trailMapByName.get(trail.name)!.push(trail);
        });

        const features: GeoJSONFeature[] = [];

        routeRows.forEach((route, index) => {
          try {
            // Parse route edges JSON
            const routeEdges: RouteEdge[] = JSON.parse(route.route_edges);
            
            if (routeEdges.length === 0) {
              console.warn(`⚠️  No edges for route: ${route.route_name}`);
              return;
            }

            // Collect trail geometries for this route
            const routeCoordinates: number[][] = [];
            const foundTrailNames: string[] = [];

            routeEdges.forEach(routeEdge => {
              const trailsWithName = trailMapByName.get(routeEdge.trail_name);
              if (trailsWithName && trailsWithName.length > 0) {
                // Use the first trail with this name (or could implement more sophisticated matching)
                const trail = trailsWithName[0];
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
                  console.warn(`⚠️  Invalid trail geometry for ${trail.name}:`, e);
                }
              } else {
                console.warn(`⚠️  Trail not found for name: ${routeEdge.trail_name}`);
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
                  route_shape: route.route_shape,
                  trail_count: route.trail_count,
                  input_length_km: route.input_length_km,
                  input_elevation_gain: route.input_elevation_gain,
                  recommended_length_km: route.recommended_length_km,
                  recommended_elevation_gain: route.recommended_elevation_gain,
                  route_score: route.route_score,
                  similarity_score: route.similarity_score,
                  created_at: route.created_at,
                  constituent_trail_count: routeEdges.length,
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
        
        console.log(`✅ Successfully exported ${features.length} route recommendations to GeoJSON`);
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
    console.log('Usage: ts-node scripts/export-route-recommendations-to-geojson.ts <sqlite-db-path> <output-geojson-path>');
    console.log('');
    console.log('Examples:');
    console.log('  ts-node scripts/export-route-recommendations-to-geojson.ts test-output/boulder-small-test.db test-output/boulder-route-recommendations.geojson');
    process.exit(1);
  }

  const sqlitePath = args[0];
  const outputPath = args[1];

  try {
    await exportRouteRecommendationsToGeoJSON(sqlitePath, outputPath);
    console.log('🎉 Route recommendations export completed successfully!');
  } catch (error) {
    console.error('❌ Route recommendations export failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { exportRouteRecommendationsToGeoJSON };
