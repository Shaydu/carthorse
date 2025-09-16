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

type LayerOption = 'routes' | 'trails' | 'edges' | 'nodes' | 'all';

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
  if (!['routes', 'trails', 'edges', 'nodes', 'all'].includes(layer)) die('Invalid --layer. Use routes, trails, edges, nodes, or all');
  return {
    db: String(args.db),
    out: String(args.out),
    layer,
    verbose: Boolean(args.verbose),
  };
}

function printHelp() {
  console.log(`\nSQLite → GeoJSON Exporter\n\nUsage:\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db <db> --out <file> [--layer routes|trails|edges|nodes|all] [--verbose]\n\nExamples:\n  # Routes only\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out routes.geojson --layer routes\n\n  # Trails only\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out trails.geojson --layer trails\n\n  # Routing edges only (with random colors)\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out edges.geojson --layer edges\n\n  # Routing nodes only (intersections and endpoints)\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out nodes.geojson --layer nodes\n\n  # All layers\n  npx ts-node scripts/tools/geojson/export-from-sqlite.ts --db data/boulder.db --out all.geojson --layer all\n`);
}

function die(msg: string): never {
  console.error(`❌ ${msg}\nUse --help for usage information.`);
  process.exit(1);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateRandomColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2',
    '#A9DFBF', '#F9E79F', '#D5DBDB', '#FADBD8', '#D1F2EB'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
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
          color: generateRandomColor(),
          stroke: generateRandomColor(),
          'stroke-width': 3,
          'stroke-opacity': 0.9,
          'fill-opacity': 0.3,
          // Selection states
          'selected-color': '#FF00FF', // Magenta for selected state
          'selected-stroke': '#FF00FF',
          'selected-stroke-width': 4,
          'selected-stroke-opacity': 1.0,
          'selected-fill-opacity': 0.5,
          // Default state
          'default-color': generateRandomColor(),
          'default-stroke': generateRandomColor(),
          'default-stroke-width': 3,
          'default-stroke-opacity': 0.9,
          'default-fill-opacity': 0.3,
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
          color: '#2E8B57', // Sea green for trails
          stroke: '#2E8B57',
          'stroke-width': 2,
          'stroke-opacity': 0.8,
          'fill-opacity': 0.2,
          // Selection states
          'selected-color': '#FF00FF', // Magenta for selected state
          'selected-stroke': '#FF00FF',
          'selected-stroke-width': 3,
          'selected-stroke-opacity': 1.0,
          'selected-fill-opacity': 0.4,
          // Default state
          'default-color': '#2E8B57',
          'default-stroke': '#2E8B57',
          'default-stroke-width': 2,
          'default-stroke-opacity': 0.8,
          'default-fill-opacity': 0.2,
        },
        geometry: geom,
      });
    } catch (e) {
      if (verbose) console.warn(`⚠️  Skipping trail ${t.name}: invalid geojson JSON`);
    }
  }
  return features;
}

function exportEdges(db: Database.Database, verbose: boolean) {
  const rows = db.prepare(`
    SELECT 
      id, source, target, trail_id, trail_name, length_km, 
      elevation_gain, elevation_loss, geojson, created_at
    FROM routing_edges
    ORDER BY id
  `).all();
  if (verbose) console.log(`📍 Found ${rows.length} routing edges`);
  const features = [] as any[];
  for (const e of rows as any[]) {
    if (!e.geojson) continue;
    try {
      const geom = JSON.parse(e.geojson);
      features.push({
        type: 'Feature',
        properties: {
          id: e.id,
          source: e.source,
          target: e.target,
          trail_id: e.trail_id,
          trail_name: e.trail_name,
          length_km: e.length_km,
          elevation_gain: e.elevation_gain,
          elevation_loss: e.elevation_loss,
          created_at: e.created_at,
          layer: 'edges',
          color: generateRandomColor(),
          stroke: generateRandomColor(),
          'stroke-width': 2,
          'stroke-opacity': 0.8,
          // Selection states
          'selected-color': '#FF00FF', // Magenta for selected state
          'selected-stroke': '#FF00FF',
          'selected-stroke-width': 3,
          'selected-stroke-opacity': 1.0,
          // Default state
          'default-color': generateRandomColor(),
          'default-stroke': generateRandomColor(),
          'default-stroke-width': 2,
          'default-stroke-opacity': 0.8,
        },
        geometry: geom,
      });
    } catch (err) {
      if (verbose) console.warn(`⚠️  Skipping edge ${e.id}: invalid geojson JSON`);
    }
  }
  return features;
}

function exportNodes(db: Database.Database, verbose: boolean) {
  // Get all unique node IDs from routing_edges
  const nodeIds = db.prepare(`
    SELECT DISTINCT source as node_id FROM routing_edges
    UNION
    SELECT DISTINCT target as node_id FROM routing_edges
    ORDER BY node_id
  `).all();
  
  if (verbose) console.log(`📍 Found ${nodeIds.length} unique nodes from routing_edges`);
  
  const features = [] as any[];
  for (const node of nodeIds as any[]) {
    const nodeId = node.node_id;
    
    // Get node info from routing_nodes table if it exists
    const nodeInfo = db.prepare(`
      SELECT node_type, connected_trails FROM routing_nodes 
      WHERE id = ?
    `).get(nodeId) as any;
    
    // Get coordinates from edges and elevation from trails
    const sourceEdge = db.prepare(`
      SELECT re.geojson as edge_geojson, t.geojson as trail_geojson, re.trail_id
      FROM routing_edges re
      JOIN trails t ON re.trail_id = t.app_uuid
      WHERE re.source = ? 
      LIMIT 1
    `).get(nodeId) as any;
    
    const targetEdge = db.prepare(`
      SELECT re.geojson as edge_geojson, t.geojson as trail_geojson, re.trail_id
      FROM routing_edges re
      JOIN trails t ON re.trail_id = t.app_uuid
      WHERE re.target = ? 
      LIMIT 1
    `).get(nodeId) as any;
    
    let coordinates: [number, number, number] = [0, 0, 0];
    let nodeType = 'intersection';
    
    try {
      // Try to get coordinates from source edge first
      if (sourceEdge && sourceEdge.edge_geojson && sourceEdge.trail_geojson) {
        const edgeGeojson = JSON.parse(sourceEdge.edge_geojson);
        const trailGeojson = JSON.parse(sourceEdge.trail_geojson);
        
        if (edgeGeojson.coordinates && edgeGeojson.coordinates.length > 0 && 
            trailGeojson.coordinates && trailGeojson.coordinates.length > 0) {
          
          // Get coordinates from edge (2D) and elevation from trail start (3D)
          const edgeStart = edgeGeojson.coordinates[0];
          const trailStart = trailGeojson.coordinates[0];
          
          coordinates = [
            edgeStart[0], // lng from edge
            edgeStart[1], // lat from edge
            trailStart[2] || 0 // elevation from trail start
          ];
        }
      }
      // If no source edge or coordinates, try target edge
      else if (targetEdge && targetEdge.edge_geojson && targetEdge.trail_geojson) {
        const edgeGeojson = JSON.parse(targetEdge.edge_geojson);
        const trailGeojson = JSON.parse(targetEdge.trail_geojson);
        
        if (edgeGeojson.coordinates && edgeGeojson.coordinates.length > 0 && 
            trailGeojson.coordinates && trailGeojson.coordinates.length > 0) {
          
          // Get coordinates from edge (2D) and elevation from trail end (3D)
          const edgeEnd = edgeGeojson.coordinates[edgeGeojson.coordinates.length - 1];
          const trailEnd = trailGeojson.coordinates[trailGeojson.coordinates.length - 1];
          
          coordinates = [
            edgeEnd[0], // lng from edge
            edgeEnd[1], // lat from edge
            trailEnd[2] || 0 // elevation from trail end
          ];
        }
      }
      
      // Use node_type from routing_nodes table if available, otherwise calculate from edge count
      let nodeType = 'intersection';
      let degree = 0;
      
      if (nodeInfo && nodeInfo.node_type) {
        nodeType = nodeInfo.node_type;
        // Calculate degree from connected_trails if available, otherwise from edge count
        if (nodeInfo.connected_trails) {
          try {
            const trails = JSON.parse(nodeInfo.connected_trails);
            degree = Array.isArray(trails) ? trails.length : 0;
          } catch (e) {
            // Fall back to edge count calculation
            const edgeCount = db.prepare(`
              SELECT COUNT(*) as count FROM routing_edges 
              WHERE source = ? OR target = ?
            `).get(nodeId, nodeId) as any;
            degree = edgeCount.count;
          }
        } else {
          // Calculate degree from edge count (count each edge only once)
          const edgeCount = db.prepare(`
            SELECT COUNT(DISTINCT id) as count FROM routing_edges 
            WHERE source = ? OR target = ?
          `).get(nodeId, nodeId) as any;
          degree = edgeCount.count;
        }
      } else {
        // Fall back to calculating from edge count (count each edge only once)
        const edgeCount = db.prepare(`
          SELECT COUNT(DISTINCT id) as count FROM routing_edges 
          WHERE source = ? OR target = ?
        `).get(nodeId, nodeId) as any;
        degree = edgeCount.count;
        nodeType = degree > 2 ? 'intersection' : 'endpoint';
      }
      
      features.push({
        type: 'Feature',
        properties: {
          id: nodeId,
          node_uuid: `node-${nodeId}`,
          lat: coordinates[1],
          lng: coordinates[0],
          elevation: coordinates[2],
          node_type: nodeType,
          degree: degree,
          connected_trails: '', // Could be populated if needed
          created_at: new Date().toISOString(),
          layer: 'nodes',
          // Styling for nodes
          'marker-color': nodeType === 'intersection' ? '#FF6B6B' : '#4ECDC4',
          'marker-size': 'medium',
          'marker-symbol': nodeType === 'intersection' ? 'cross' : 'circle',
          // Selection states
          'selected-marker-color': '#FF00FF', // Magenta for selected
          'selected-marker-size': 'large',
          'selected-marker-symbol': nodeType === 'intersection' ? 'cross' : 'circle',
          // Default state
          'default-marker-color': nodeType === 'intersection' ? '#FF6B6B' : '#4ECDC4',
          'default-marker-size': 'medium',
          'default-marker-symbol': nodeType === 'intersection' ? 'cross' : 'circle',
        },
        geometry: {
          type: 'Point',
          coordinates: coordinates
        },
      });
    } catch (err) {
      if (verbose) console.warn(`⚠️  Skipping node ${nodeId}: ${err}`);
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
  if (args.layer === 'edges' || args.layer === 'all') {
    featureCollection.features.push(...exportEdges(db, args.verbose));
  }
  if (args.layer === 'nodes' || args.layer === 'all') {
    featureCollection.features.push(...exportNodes(db, args.verbose));
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


