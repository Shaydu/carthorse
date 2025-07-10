#!/usr/bin/env ts-node
/**
 * Build Routing Nodes and Edges
 *
 * Usage:
 *   npx ts-node build-routing-nodes-and-edges.ts --db /path/to/database.db
 */
import Database from 'better-sqlite3';
import * as path from 'path';

function getArg(flag: string, fallback: string | null): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv.length > idx + 1) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const dbArg = getArg('--db', null);
if (!dbArg) {
  console.error('Usage: npx ts-node build-routing-nodes-and-edges.ts --db /path/to/database.db');
  process.exit(1);
}
const dbPath = path.resolve(dbArg);

console.log('🔗 Building routing nodes and edges for', dbPath);
const db = new Database(dbPath);

// Load SpatiaLite extension
const SPATIALITE_PATH = process.platform === 'darwin'
  ? '/opt/homebrew/lib/mod_spatialite.dylib'
  : '/usr/lib/x86_64-linux-gnu/mod_spatialite.so';
try {
  db.loadExtension(SPATIALITE_PATH);
  console.log('✅ SpatiaLite loaded successfully');
} catch (e) {
  console.error('❌ Failed to load SpatiaLite:', e.message);
  process.exit(1);
}

// Clear existing routing data
db.prepare('DELETE FROM routing_edges').run();
db.prepare('DELETE FROM routing_nodes').run();

// Extract all trail geometries with names and UUIDs
const trails = db.prepare(`
  SELECT id, app_uuid, name, AsGeoJSON(geometry) as geojson, length_km, elevation_gain 
  FROM trails WHERE geometry IS NOT NULL
`).all() as { id: number; app_uuid: string; name: string; geojson: string; length_km: number; elevation_gain: number }[];

let nodeId = 1;
const nodeMap = new Map<string, number>();
const nodes: { id: number; lat: number; lng: number; node_type: string; connected_trails: string }[] = [];
const edges: { from_node_id: number; to_node_id: number; trail_id: string; trail_name: string; distance_km: number; elevation_gain: number }[] = [];

function getNodeId(lat: number, lng: number): number {
  const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
  if (nodeMap.has(key)) return nodeMap.get(key)!;
  nodeMap.set(key, nodeId);
  nodes.push({ 
    id: nodeId, 
    lat, 
    lng, 
    node_type: 'intersection', 
    connected_trails: '[]' 
  });
  return nodeId++;
}

for (const trail of trails) {
  const geo = JSON.parse(trail.geojson);
  if (geo.type !== 'LineString' || !Array.isArray(geo.coordinates)) continue;
  const coords = geo.coordinates;
  
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const n1 = getNodeId(lat1, lng1);
    const n2 = getNodeId(lat2, lng2);
    
    // Calculate distance in km (approximate)
    const dx = lng2 - lng1, dy = lat2 - lat1;
    const lengthDegrees = Math.sqrt(dx * dx + dy * dy);
    const distanceKm = lengthDegrees * 111; // Rough conversion: 1 degree ≈ 111 km
    
    edges.push({ 
      from_node_id: n1, 
      to_node_id: n2, 
      trail_id: trail.app_uuid || trail.id?.toString() || `trail_${trail.id}`, 
      trail_name: trail.name || `Trail ${trail.id}`,
      distance_km: distanceKm,
      elevation_gain: trail.elevation_gain || 0
    });
  }
}

const insertNode = db.prepare(`
  INSERT INTO routing_nodes (id, lat, lng, node_type, connected_trails) 
  VALUES (?, ?, ?, ?, ?)
`);
const insertEdge = db.prepare(`
  INSERT INTO routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const n of nodes) insertNode.run(n.id, n.lat, n.lng, n.node_type, n.connected_trails);
  for (const e of edges) insertEdge.run(e.from_node_id, e.to_node_id, e.trail_id, e.trail_name, e.distance_km, e.elevation_gain);
})();

db.close();
console.log(`✅ Inserted ${nodes.length} routing nodes and ${edges.length} routing edges.`); 