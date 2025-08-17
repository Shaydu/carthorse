// SQL-based helper stubs for orchestrator logic
// All implementations must use SQL/PostGIS, not JS/TS

import { Client } from 'pg';

/**
 * Build the master database using SQL/PostGIS and OSM loader.
 * @returns {Promise<void>}
 */
export async function buildMasterDatabase(): Promise<void> {
  // TODO: Implement using SQL/PostGIS and OSM loader
  throw new Error('Not implemented: buildMasterDatabase (SQL/PostGIS required)');
}

/**
 * Calculate adaptive tolerance for geometry simplification using SQL/PostGIS.
 * @param trails
 * @param targetSizeMB
 * @returns {Promise<number>}
 */
export async function calculateAdaptiveTolerance(trails: any[], targetSizeMB: number): Promise<number> {
  // TODO: Implement using SQL/PostGIS
  throw new Error('Not implemented: calculateAdaptiveTolerance (SQL/PostGIS required)');
}

/**
 * Estimate database size using SQL/PostGIS.
 * @param trails
 * @returns {Promise<number>}
 */
export async function estimateDatabaseSize(trails: any[]): Promise<number> {
  // TODO: Implement using SQL/PostGIS
  throw new Error('Not implemented: estimateDatabaseSize (SQL/PostGIS required)');
}

/**
 * Simplify geometry and return point counts using SQL/PostGIS.
 * @param wkt
 * @param tolerance
 * @returns {Promise<{ simplified: string; originalPoints: number; simplifiedPoints: number }>}
 */
export async function simplifyGeometryWithCounts(wkt: string, tolerance: number): Promise<{ simplified: string; originalPoints: number; simplifiedPoints: number }> {
  // TODO: Implement using SQL/PostGIS
  throw new Error('Not implemented: simplifyGeometryWithCounts (SQL/PostGIS required)');
}

/**
 * Calculate distance between two coordinates using SQL/PostGIS (ST_Distance).
 * @param coord1
 * @param coord2
 * @returns {Promise<number>}
 */
export async function calculateDistance(coord1: [number, number], coord2: [number, number]): Promise<number> {
  // TODO: Implement using SQL/PostGIS (ST_Distance)
  throw new Error('Not implemented: calculateDistance (SQL/PostGIS required)');
}

/**
 * Create the canonical routing_edges table in the given schema with all required columns and constraints.
 */
export async function createCanonicalRoutingEdgesTable(pgClient: any, schemaName: string) {
  const sql = `CREATE TABLE ${schemaName}.routing_edges (
    id SERIAL PRIMARY KEY,
    source INTEGER NOT NULL,
    target INTEGER NOT NULL,
    trail_id TEXT NOT NULL,
    trail_name TEXT NOT NULL,
    distance_km REAL NOT NULL,
    elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
    elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
    is_bidirectional BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    geometry geometry(LineString, 4326),
    FOREIGN KEY (source) REFERENCES ${schemaName}.routing_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES ${schemaName}.routing_nodes(id) ON DELETE CASCADE
  );`;
  console.log('[DDL] Executing SQL for canonical routing_edges:', sql);
  await pgClient.query(sql);
  console.log('[DDL] Created canonical routing_edges table in', schemaName);
}



export async function logSchemaTableState(pgClient: Client, stagingSchema: string, context: string) {
  try {
    const schemaRes = await pgClient.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`, [stagingSchema]);
    const tableCheck = await pgClient.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [stagingSchema]);
    if (schemaRes.rows.length === 0) {
      console.error(`[${context}] ❌ Staging schema ${stagingSchema} not found!`);
    } else {
      console.log(`[${context}] ✅ Staging schema ${stagingSchema} is present.`);
    }
    if (tableCheck.rows.length === 0) {
      console.error(`[${context}] ❌ No tables found in schema ${stagingSchema}!`);
    } else {
      console.log(`[${context}] Tables in ${stagingSchema}:`, tableCheck.rows.map(r => r.table_name));
    }
  } catch (err) {
    console.error(`[${context}] ❌ Error checking schema/table existence:`, err);
  }
}

// Standalone test runner for createCanonicalRoutingEdgesTable
if (require.main === module) {
  (async () => {
    const { Client } = require('pg');
    const schemaName = process.argv[2] || 'staging_boulder_1753305242153';
    const pgClient = new Client({
      user: process.env.PGUSER || 'tester',
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'trail_master_db_test',
      password: process.env.PGPASSWORD || '',
      port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    });
    await pgClient.connect();
    try {
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      await pgClient.query(`CREATE TABLE IF NOT EXISTS ${schemaName}.routing_nodes (id SERIAL PRIMARY KEY)`); // minimal for FK
      await pgClient.query(`DROP TABLE IF EXISTS ${schemaName}.routing_edges CASCADE;`);
      await createCanonicalRoutingEdgesTable(pgClient, schemaName);
      const res = await pgClient.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'routing_edges'`, [schemaName]);
      console.log('[DDL-HELPER] routing_edges columns:', res.rows);
    } finally {
      await pgClient.end();
    }
  })();
} 