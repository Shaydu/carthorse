import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Ensure the pgrouting extension is enabled.
 */
export async function ensurePgRoutingEnabled(pgClient: Client) {
  console.log('[pgrouting] Enabling pgRouting extension...');
  await pgClient.query('CREATE EXTENSION IF NOT EXISTS pgrouting');
  console.log('✅ pgRouting extension enabled');
}

/**
 * Run pgr_nodeNetwork on the split_trails table.
 * This creates split_trails_noded with source/target columns.
 */
export async function runNodeNetwork(pgClient: Client, stagingSchema: string) {
  console.log(`[pgrouting] Running pgr_nodeNetwork on ${stagingSchema}.split_trails...`);
  // Drop if exists for idempotency
  await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails_noded CASCADE`);
  // Run pgr_nodeNetwork
  await pgClient.query(`
    CREATE TABLE ${stagingSchema}.split_trails_noded AS
    SELECT * FROM pgr_nodeNetwork('${stagingSchema}.split_trails', 0.0001, 'id');
  `);
  // Add geometry column (copy from split_trails)
  await pgClient.query(`
    ALTER TABLE ${stagingSchema}.split_trails_noded
    ADD COLUMN IF NOT EXISTS geometry geometry(LineStringZ, 4326);
    UPDATE ${stagingSchema}.split_trails_noded n
    SET geometry = t.geo2
    FROM ${stagingSchema}.split_trails t
    WHERE n.id = t.id;
  `);
  // Log row counts
  const { rows } = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.split_trails_noded`);
  console.log(`[pgrouting] split_trails_noded row count: ${rows[0].count}`);
  console.log('✅ pgr_nodeNetwork completed and split_trails_noded created');
}

/**
 * Create routing_edges and routing_nodes tables with schema v8.
 */
export async function createRoutingGraphTables(pgClient: Client, stagingSchema: string) {
  console.log(`[pgrouting] Creating routing_edges and routing_nodes tables in ${stagingSchema}...`);
  // Drop if exists for idempotency
  await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.routing_edges CASCADE`);
  await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.routing_nodes CASCADE`);

  // Create routing_edges
  await pgClient.query(`
    CREATE TABLE ${stagingSchema}.routing_edges AS
    SELECT
      id,
      source,
      target,
      trail_id,
      trail_name,
      elevation_gain,
      elevation_loss,
      TRUE AS is_bidirectional,
      ST_AsText(geometry) AS geometry_wkt
    FROM (
      SELECT
        n.id,
        n.source,
        n.target,
        t.app_uuid AS trail_id,
        t.name AS trail_name,
        t.elevation_gain,
        t.elevation_loss,
        n.geometry
      FROM ${stagingSchema}.split_trails_noded n
      JOIN ${stagingSchema}.split_trails t ON n.id = t.id
    ) e;
  `);

  // Create routing_nodes
  await pgClient.query(`
    CREATE TABLE ${stagingSchema}.routing_nodes AS
    SELECT
      node_id,
      ST_Y(geom) AS lat,
      ST_X(geom) AS lng,
      NULL::REAL AS elevation, -- TODO: join elevation if available
      'unknown'::TEXT AS node_type, -- TODO: classify as intersection/endpoint
      NULL::TEXT AS connected_trails, -- TODO: aggregate connected trails
      ST_AsText(geom) AS coordinate_wkt
    FROM (
      SELECT DISTINCT source AS node_id, ST_StartPoint(geometry) AS geom FROM ${stagingSchema}.split_trails_noded
      UNION
      SELECT DISTINCT target AS node_id, ST_EndPoint(geometry) AS geom FROM ${stagingSchema}.split_trails_noded
    ) nodes;
  `);
  // Log row counts
  const { rows: edgeRows } = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
  const { rows: nodeRows } = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes`);
  console.log(`[pgrouting] routing_edges row count: ${edgeRows[0].count}`);
  console.log(`[pgrouting] routing_nodes row count: ${nodeRows[0].count}`);
  console.log('✅ routing_edges and routing_nodes tables created (schema v8)');
}

/**
 * Export routing graph to SQLite (schema v8).
 * Exports routing_nodes, routing_edges, and writes schema_version.
 */
export async function exportRoutingGraphToSQLite(pgClient: Client, stagingSchema: string, sqlitePath: string) {
  console.log(`[pgrouting] Exporting routing graph to SQLite: ${sqlitePath}`);
  // Query data
  const nodesRes = await pgClient.query(`SELECT * FROM ${stagingSchema}.routing_nodes`);
  const edgesRes = await pgClient.query(`SELECT * FROM ${stagingSchema}.routing_edges`);
  console.log(`[pgrouting] Exporting ${nodesRes.rows.length} nodes, ${edgesRes.rows.length} edges`);

  // Ensure parent directory exists
  const outputDir = path.dirname(sqlitePath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const db = new Database(sqlitePath);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_nodes (
      node_id INTEGER PRIMARY KEY,
      lat REAL,
      lng REAL,
      elevation REAL,
      node_type TEXT,
      connected_trails TEXT,
      coordinate_wkt TEXT
    );
    CREATE TABLE IF NOT EXISTS routing_edges (
      id INTEGER PRIMARY KEY,
      source INTEGER,
      target INTEGER,
      trail_id TEXT,
      trail_name TEXT,
      elevation_gain REAL,
      elevation_loss REAL,
      is_bidirectional BOOLEAN,
      geometry_wkt TEXT
    );
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER,
      description TEXT,
      created_at TEXT
    );
  `);

  // Insert data
  const insertNode = db.prepare(`INSERT INTO routing_nodes (node_id, lat, lng, elevation, node_type, connected_trails, coordinate_wkt) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const n of nodesRes.rows) {
    insertNode.run(n.node_id, n.lat, n.lng, n.elevation, n.node_type, n.connected_trails, n.coordinate_wkt);
  }
  const insertEdge = db.prepare(`INSERT INTO routing_edges (id, source, target, trail_id, trail_name, elevation_gain, elevation_loss, is_bidirectional, geometry_wkt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const e of edgesRes.rows) {
    insertEdge.run(e.id, e.source, e.target, e.trail_id, e.trail_name, e.elevation_gain, e.elevation_loss, e.is_bidirectional, e.geometry_wkt);
  }
  // Write schema version
  db.prepare(`INSERT INTO schema_version (version, description, created_at) VALUES (?, ?, datetime('now'))`).run(8, 'Gainiac Routing Graph v8: pgRouting nodes/edges schema');
  db.close();
  console.log('✅ Exported routing graph to SQLite (schema v8)');
} 