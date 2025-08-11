#!/usr/bin/env ts-node

import Database from 'better-sqlite3';
import * as fs from 'fs';

const DB_PATH = './scripts/dev-utils/tmp/test-edges.db';

// Remove existing test DB if present
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log(`[DEBUG] Removed existing ${DB_PATH}`);
}

const db = new Database(DB_PATH);

// Create routing_edges table
const createTableSQL = `
CREATE TABLE IF NOT EXISTS routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id INTEGER,
  to_node_id INTEGER,
  trail_id TEXT,
  trail_name TEXT,
  distance_km REAL,
  elevation_gain REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
db.exec(createTableSQL);
console.log('[DEBUG] Created routing_edges table.');

// Insert a sample row
const insertSQL = `
INSERT INTO routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
VALUES (?, ?, ?, ?, ?, ?)
`;
const sampleEdge = [1, 2, 'test-trail', 'Test Trail', 1.23, 45.6];
db.prepare(insertSQL).run(...sampleEdge);
console.log('[DEBUG] Inserted sample edge:', sampleEdge);

// Check schema
const schema = db.prepare('PRAGMA table_info(routing_edges);').all();
console.log('[DEBUG] routing_edges schema:');
console.table(schema);

// Check data
const rows = db.prepare('SELECT * FROM routing_edges;').all();
console.log('[DEBUG] routing_edges data:');
console.table(rows);

db.close();
console.log(`[DEBUG] Test complete. Database at ${DB_PATH}`); 