#!/usr/bin/env ts-node
/**
 * Populate elevation data for both trails and routes in a SQLite database
 * Uses the fixed elevation recalculation service to ensure accurate data
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface TrailElevationData {
  app_uuid: string;
  name: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
}

interface RouteElevationData {
  route_uuid: string;
  route_name: string;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_elevation_loss: number;
  route_max_elevation: number;
  route_min_elevation: number;
  route_avg_elevation: number;
  route_gain_rate: number;
}

function parseArgs(argv: string[]): { db: string; verbose: boolean } {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(`
Usage: npx ts-node populate-elevation-data.ts --db <database_path> [--verbose]

Examples:
  npx ts-node populate-elevation-data.ts --db test-output/boulder-small-test-routes.db --verbose
      `);
      process.exit(0);
    }
  }
  if (!args.db) {
    console.error('❌ Missing required argument: --db');
    process.exit(1);
  }
  return {
    db: String(args.db),
    verbose: Boolean(args.verbose),
  };
}

function log(message: string, verbose: boolean): void {
  if (verbose) {
    console.log(`[Elevation Population] ${message}`);
  }
}

async function populateTrailsElevation(db: Database.Database, verbose: boolean): Promise<void> {
  log('🗻 Populating trails elevation data...', verbose);
  
  // Get all trails with 3D geometry
  const trails = db.prepare(`
    SELECT app_uuid, name, geojson, length_km
    FROM trails 
    WHERE geojson IS NOT NULL 
      AND length(geojson) > 0
  `).all() as Array<{ app_uuid: string; name: string; geojson: string; length_km: number }>;

  log(`📊 Found ${trails.length} trails to process`, verbose);

  let processed = 0;
  let errors = 0;

  for (const trail of trails) {
    try {
      // Parse the geometry (assuming it's stored as GeoJSON)
      const geom = JSON.parse(trail.geojson);
      
      if (geom.type === 'LineString' && geom.coordinates && geom.coordinates.length > 0) {
        // Extract Z coordinates (elevation)
        const elevations = geom.coordinates
          .filter((coord: number[]) => coord.length >= 3 && coord[2] !== null && coord[2] !== undefined)
          .map((coord: number[]) => coord[2])
          .filter((elev: number) => elev >= -1000 && elev <= 10000); // Filter valid elevations

        if (elevations.length > 0) {
          const minElev = Math.min(...elevations);
          const maxElev = Math.max(...elevations);
          const avgElev = elevations.reduce((sum: number, elev: number) => sum + elev, 0) / elevations.length;
          
          // Calculate elevation gain and loss
          let elevationGain = 0;
          let elevationLoss = 0;
          
          for (let i = 1; i < elevations.length; i++) {
            const diff = elevations[i] - elevations[i - 1];
            if (diff > 0) {
              elevationGain += diff;
            } else {
              elevationLoss += Math.abs(diff);
            }
          }

          // Update the trail
          db.prepare(`
            UPDATE trails 
            SET 
              elevation_gain = ?,
              elevation_loss = ?,
              max_elevation = ?,
              min_elevation = ?,
              avg_elevation = ?
            WHERE app_uuid = ?
          `).run(elevationGain, elevationLoss, maxElev, minElev, avgElev, trail.app_uuid);

          processed++;
          if (verbose && processed % 10 === 0) {
            log(`   Processed ${processed}/${trails.length} trails...`, verbose);
          }
        } else {
          log(`   ⚠️  No valid elevation data for trail: ${trail.name}`, verbose);
        }
      }
    } catch (error) {
      errors++;
      log(`   ❌ Error processing trail ${trail.name}: ${error}`, verbose);
    }
  }

  log(`✅ Trails elevation data populated: ${processed} processed, ${errors} errors`, verbose);
}

async function populateRoutesElevation(db: Database.Database, verbose: boolean): Promise<void> {
  log('🗻 Populating routes elevation data...', verbose);
  
  // Get all routes
  const routes = db.prepare(`
    SELECT route_uuid, route_name, recommended_length_km, route_path
    FROM route_recommendations 
    WHERE route_path IS NOT NULL
  `).all() as Array<{ route_uuid: string; route_name: string; recommended_length_km: number; route_path: string }>;

  log(`📊 Found ${routes.length} routes to process`, verbose);

  let processed = 0;
  let errors = 0;

  for (const route of routes) {
    try {
      // Parse the route path (should be MultiLineString GeoJSON)
      const routeGeom = JSON.parse(route.route_path);
      
      if (routeGeom.type === 'MultiLineString' && routeGeom.coordinates) {
        // Extract all Z coordinates from all line strings
        const allElevations: number[] = [];
        
        for (const lineString of routeGeom.coordinates) {
          if (Array.isArray(lineString)) {
            for (const coord of lineString) {
              if (Array.isArray(coord) && coord.length >= 3 && coord[2] !== null && coord[2] !== undefined) {
                const elev = coord[2];
                if (elev >= -1000 && elev <= 10000) {
                  allElevations.push(elev);
                }
              }
            }
          }
        }

        if (allElevations.length > 0) {
          const minElev = Math.min(...allElevations);
          const maxElev = Math.max(...allElevations);
          const avgElev = allElevations.reduce((sum: number, elev: number) => sum + elev, 0) / allElevations.length;
          
          // Calculate elevation gain and loss
          let elevationGain = 0;
          let elevationLoss = 0;
          
          for (let i = 1; i < allElevations.length; i++) {
            const diff = allElevations[i] - allElevations[i - 1];
            if (diff > 0) {
              elevationGain += diff;
            } else {
              elevationLoss += Math.abs(diff);
            }
          }

          // Calculate gain rate (elevation gain per km)
          const gainRate = route.recommended_length_km > 0 ? elevationGain / route.recommended_length_km : 0;

          // Update the route
          db.prepare(`
            UPDATE route_recommendations 
            SET 
              recommended_elevation_gain = ?,
              route_elevation_loss = ?,
              route_max_elevation = ?,
              route_min_elevation = ?,
              route_avg_elevation = ?,
              route_gain_rate = ?
            WHERE route_uuid = ?
          `).run(elevationGain, elevationLoss, maxElev, minElev, avgElev, gainRate, route.route_uuid);

          processed++;
          if (verbose && processed % 10 === 0) {
            log(`   Processed ${processed}/${routes.length} routes...`, verbose);
          }
        } else {
          log(`   ⚠️  No valid elevation data for route: ${route.route_name}`, verbose);
        }
      }
    } catch (error) {
      errors++;
      log(`   ❌ Error processing route ${route.route_name}: ${error}`, verbose);
    }
  }

  log(`✅ Routes elevation data populated: ${processed} processed, ${errors} errors`, verbose);
}

async function main() {
  const args = parseArgs(process.argv);
  
  if (!fs.existsSync(args.db)) {
    console.error(`❌ Database file not found: ${args.db}`);
    process.exit(1);
  }

  const db = new Database(args.db);
  log(`📁 Opened database: ${args.db}`, args.verbose);

  try {
    // Step 1: Populate trails elevation data
    await populateTrailsElevation(db, args.verbose);
    
    // Step 2: Populate routes elevation data
    await populateRoutesElevation(db, args.verbose);
    
    // Step 3: Show summary
    const trailStats = db.prepare(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN max_elevation IS NOT NULL AND max_elevation > 0 THEN 1 END) as trails_with_elevation,
        AVG(max_elevation) as avg_max_elevation,
        AVG(elevation_gain) as avg_elevation_gain
      FROM trails
    `).get() as { total_trails: number; trails_with_elevation: number; avg_max_elevation: number; avg_elevation_gain: number };

    const routeStats = db.prepare(`
      SELECT 
        COUNT(*) as total_routes,
        COUNT(CASE WHEN route_max_elevation IS NOT NULL AND route_max_elevation > 0 THEN 1 END) as routes_with_elevation,
        AVG(route_max_elevation) as avg_max_elevation,
        AVG(recommended_elevation_gain) as avg_elevation_gain
      FROM route_recommendations
    `).get() as { total_routes: number; routes_with_elevation: number; avg_max_elevation: number; avg_elevation_gain: number };

    console.log('\n📊 ELEVATION DATA SUMMARY:');
    console.log('==========================');
    console.log(`🛤️  Trails: ${trailStats.trails_with_elevation}/${trailStats.total_trails} with elevation data`);
    console.log(`   Average max elevation: ${trailStats.avg_max_elevation?.toFixed(1) || 'N/A'}m`);
    console.log(`   Average elevation gain: ${trailStats.avg_elevation_gain?.toFixed(1) || 'N/A'}m`);
    console.log(`🛣️  Routes: ${routeStats.routes_with_elevation}/${routeStats.total_routes} with elevation data`);
    console.log(`   Average max elevation: ${routeStats.avg_max_elevation?.toFixed(1) || 'N/A'}m`);
    console.log(`   Average elevation gain: ${routeStats.avg_elevation_gain?.toFixed(1) || 'N/A'}m`);
    
    console.log('\n✅ Elevation data population completed successfully!');
    
  } catch (error) {
    console.error('❌ Error populating elevation data:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
