#!/usr/bin/env node
/**
 * Build Routing Nodes and Edges (JavaScript version)
 *
 * Usage:
 *   node build-routing-graph.js --db /path/to/database.db
 */
const Database = require('better-sqlite3');
const path = require('path');

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv.length > idx + 1) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const dbArg = getArg('--db', null);
if (!dbArg) {
  console.error('Usage: node build-routing-graph.js --db /path/to/database.db');
  process.exit(1);
}
const dbPath = path.resolve(dbArg);

console.log('🔗 Building routing nodes and edges for', dbPath);
const db = new Database(dbPath);

// Ensure tables exist
const createNodes = `
CREATE TABLE IF NOT EXISTS routing_nodes (
  id INTEGER PRIMARY KEY,
  lat REAL,
  lng REAL
);
`;
const createEdges = `
CREATE TABLE IF NOT EXISTS routing_edges (
  id INTEGER PRIMARY KEY,
  node1 INTEGER,
  node2 INTEGER,
  trailId INTEGER,
  length REAL
);
`;
db.exec(createNodes);
db.exec(createEdges);

db.prepare('DELETE FROM routing_nodes').run();
db.prepare('DELETE FROM routing_edges').run();

// Extract all trail geometries
const trails = db.prepare('SELECT id, AsGeoJSON(geometry) as geojson FROM trails WHERE geometry IS NOT NULL').all();

let nodeId = 1;
const nodeMap = new Map();
const nodes = [];
const edges = [];

function getNodeId(lat, lng) {
  const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
  if (nodeMap.has(key)) return nodeMap.get(key);
  nodeMap.set(key, nodeId);
  nodes.push({ id: nodeId, lat, lng });
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
    const dx = lng2 - lng1, dy = lat2 - lat1;
    const length = Math.sqrt(dx * dx + dy * dy);
    edges.push({ node1: n1, node2: n2, trailId: trail.id, length });
  }
}

const insertNode = db.prepare('INSERT INTO routing_nodes (id, lat, lng) VALUES (?, ?, ?)');
const insertEdge = db.prepare('INSERT INTO routing_edges (node1, node2, trailId, length) VALUES (?, ?, ?, ?)');

db.transaction(() => {
  for (const n of nodes) insertNode.run(n.id, n.lat, n.lng);
  for (const e of edges) insertEdge.run(e.node1, e.node2, e.trailId, e.length);
})();

db.close();
console.log(`✅ Inserted ${nodes.length} routing nodes and ${edges.length} routing edges.`); 