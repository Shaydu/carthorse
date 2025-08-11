#!/usr/bin/env ts-node

import { Client } from 'pg';
import readline from 'readline';

// --- Config ---
const DEFAULT_REGION = 'boulder';
const DB_NAME = process.env.PGDATABASE || 'trail_master_db_test';
const DB_USER = process.env.PGUSER || 'tester';
const DB_PASSWORD = process.env.PGPASSWORD || '';
const DB_HOST = process.env.PGHOST || 'localhost';
const DB_PORT = parseInt(process.env.PGPORT || '5432');

// --- CLI Args ---
const args = process.argv.slice(2);
let region = DEFAULT_REGION;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--region') {
    region = args[i + 1] ?? region;
  }
}

console.log(`\n[DEBUG] Connecting to test DB: ${DB_NAME} as user ${DB_USER}`);
console.log(`[DEBUG] Region: ${region}`);

const client = new Client({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
});

async function pause(message: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>(resolve => rl.question(message, () => { rl.close(); resolve(); }));
}

async function main() {
  await client.connect();

  // 1. Find latest staging schema for region
  const schemaLike = `staging_${region}_%`;
  const schemasRes = await client.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1 ORDER BY schema_name DESC`,
    [schemaLike]
  );
  if (schemasRes.rows.length === 0) {
    console.error(`[ERROR] No staging schemas found for region '${region}'.`);
    process.exit(1);
  }
  const stagingSchema = schemasRes.rows[0].schema_name;
  console.log(`[DEBUG] Using staging schema: ${stagingSchema}`);

  // 2. Check if split_trails exists and has rows
  let table = 'split_trails';
  let countRes = await client.query(
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'split_trails'`,
    [stagingSchema]
  );
  let hasSplitTrails = countRes.rows[0].count !== '0';
  let rowCount = 0;
  if (hasSplitTrails) {
    const rc = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.split_trails`);
    rowCount = parseInt(rc.rows[0].count, 10);
    if (rowCount === 0) hasSplitTrails = false;
  }
  if (!hasSplitTrails) {
    table = 'trails';
    const rc = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    rowCount = parseInt(rc.rows[0].count, 10);
    if (rowCount === 0) {
      console.error(`[ERROR] No rows in split_trails or trails in schema ${stagingSchema}`);
      process.exit(1);
    }
  }
  console.log(`[DEBUG] Inspecting table: ${table} (${rowCount} rows)`);

  // 3. Print sample rows with geometry as WKT
  const sampleRes = await client.query(
    `SELECT id, app_uuid, name, ST_AsText(geometry) AS wkt, geometry IS NULL AS is_null FROM ${stagingSchema}.${table} LIMIT 10`
  );
  console.log(`\n[DEBUG] Sample rows from ${stagingSchema}.${table}:`);
  for (const row of sampleRes.rows) {
    console.log(`id=${row.id} app_uuid=${row.app_uuid} name=${row.name} is_null=${row.is_null} wkt=${row.wkt}`);
  }

  // 4. Count total and non-NULL geometry rows
  const countGeomRes = await client.query(
    `SELECT COUNT(*) AS total, COUNT(geometry) AS with_geom FROM ${stagingSchema}.${table}`
  );
  console.log(`\n[DEBUG] Geometry counts: total=${countGeomRes.rows[0].total}, with_geom=${countGeomRes.rows[0].with_geom}`);

  // --- Check routing_edges in staging ---
  const edgesCountRes = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
  const edgesCount = Number(edgesCountRes.rows[0].count);
  console.log(`[DEBUG] routing_edges count in staging: ${edgesCount}`);
  if (edgesCount > 0) {
    const edgeSamplesRes = await client.query(`SELECT id, from_node_id, to_node_id, trail_id, distance_km FROM ${stagingSchema}.routing_edges LIMIT 5`);
    console.log('[DEBUG] Sample routing_edges rows:');
    for (const row of edgeSamplesRes.rows) {
      console.log(row);
    }
  } else {
    console.log('[DEBUG] No routing_edges found in staging.');
  }

  // 5. Pause for inspection
  await pause('\n[PAUSE] Press Enter to exit and drop to shell...');

  await client.end();
  console.log('[DEBUG] Done.');
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
}); 