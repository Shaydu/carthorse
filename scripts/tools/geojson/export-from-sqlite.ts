#!/usr/bin/env ts-node
/**
 * Export routes and/or trails from a Carthorse SQLite DB to GeoJSON.
 *
 * Usage:
 *   npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db <db> --out <file> --layer <routes|trails|all> [--verbose]
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

type LayerOption = 'routes' | 'trails' | 'all';

interface CliArgs {
  db: string;
  out: string;
  layer: LayerOption;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--out' || a === '--output') args.out = argv[++i];
    else if (a === '--layer') args.layer = argv[++i] as LayerOption;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!args.db) die('Missing required argument: --db');
  if (!args.out) die('Missing required argument: --out');
  const layer = (args.layer as LayerOption) || 'all';
  if (!['routes', 'trails', 'all'].includes(layer)) die('Invalid --layer. Use routes, trails, or all');
  return {
    db: String(args.db),
    out: String(args.out),
    layer,
    verbose: Boolean(args.verbose),
  };
}

function printHelp() {
  console.log(`\nSQLite → GeoJSON Exporter\n\nUsage:\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db <db> --out <file> [--layer routes|trails|all] [--verbose]\n\nExamples:\n  # Routes only\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out routes.geojson --layer routes\n\n  # Trails only\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out trails.geojson --layer trails\n\n  # Both routes and trails\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out all.geojson --layer all\n`);
}

function die(msg: string): never {
  console.error(`❌ ${msg}\nUse --help for usage information.`);
  process.exit(1);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function exportRoutes(db: Database.Database, verbose: boolean) {
  const rows = db.prepare(`
    SELECT 
      route_uuid, route_name, route_path, route_score, route_shape,
      recommended_length_km, recommended_elevation_gain, trail_count, created_at
    FROM route_recommendations
    ORDER BY route_score DESC
  `).all();
  if (verbose) console.log(`📍 Found ${rows.length} routes`);
  const features = [] as any[];
  for (const r of rows as any[]) {
    if (!r.route_path) continue;
    try {
      const geom = JSON.parse(r.route_path);
      features.push({
        type: 'Feature',
        properties: {
          id: r.route_uuid,
          route_uuid: r.route_uuid,
          route_name: r.route_name,
          route_score: r.route_score,
          route_shape: r.route_shape,
          recommended_length_km: r.recommended_length_km,
          recommended_elevation_gain: r.recommended_elevation_gain,
          trail_count: r.trail_count,
          created_at: r.created_at,
          layer: 'routes',
        },
        geometry: geom,
      });
    } catch (e) {
      if (verbose) console.warn(`⚠️  Skipping route ${r.route_name}: invalid route_path JSON`);
    }
  }
  return features;
}

function exportTrails(db: Database.Database, verbose: boolean) {
  const rows = db.prepare(`
    SELECT 
      app_uuid, name, region, length_km, elevation_gain, elevation_loss,
      max_elevation, min_elevation, avg_elevation, difficulty, surface_type,
      trail_type, source, geojson, created_at, updated_at
    FROM trails
  `).all();
  if (verbose) console.log(`📍 Found ${rows.length} trails`);
  const features = [] as any[];
  for (const t of rows as any[]) {
    if (!t.geojson) continue;
    try {
      const geom = JSON.parse(t.geojson);
      features.push({
        type: 'Feature',
        properties: {
          id: t.app_uuid,
          name: t.name,
          region: t.region,
          length_km: t.length_km,
          elevation_gain: t.elevation_gain,
          elevation_loss: t.elevation_loss,
          max_elevation: t.max_elevation,
          min_elevation: t.min_elevation,
          avg_elevation: t.avg_elevation,
          difficulty: t.difficulty,
          surface_type: t.surface_type,
          trail_type: t.trail_type,
          source: t.source,
          created_at: t.created_at,
          updated_at: t.updated_at,
          layer: 'trails',
        },
        geometry: geom,
      });
    } catch (e) {
      if (verbose) console.warn(`⚠️  Skipping trail ${t.name}: invalid geojson JSON`);
    }
  }
  return features;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.db)) die(`Database file not found: ${args.db}`);
  const db = new Database(args.db);
  if (args.verbose) console.log(`📁 Opened database: ${args.db}`);

  const featureCollection: any = { type: 'FeatureCollection', features: [] };

  if (args.layer === 'routes' || args.layer === 'all') {
    featureCollection.features.push(...exportRoutes(db, args.verbose));
  }
  if (args.layer === 'trails' || args.layer === 'all') {
    featureCollection.features.push(...exportTrails(db, args.verbose));
  }

  ensureDir(args.out);
  fs.writeFileSync(args.out, JSON.stringify(featureCollection, null, 2));

  const counts = featureCollection.features.reduce((acc: any, f: any) => {
    const l = f.properties?.layer || 'unknown';
    acc[l] = (acc[l] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (args.verbose) console.log('📊 Exported:', counts);
  const sizeKB = Math.round(fs.statSync(args.out).size / 1024);
  console.log('✅ Export completed successfully!');
  console.log(`📁 Output: ${args.out}`);
  console.log(`📏 File size: ${sizeKB} KB`);
}

main().catch((e) => {
  console.error('❌ Export failed:', e);
  process.exit(1);
});


