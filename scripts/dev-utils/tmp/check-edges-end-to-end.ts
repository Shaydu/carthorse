#!/usr/bin/env ts-node

import { Client } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';

const DEFAULT_REGION = 'boulder';
const DEFAULT_SQLITE_PATH = './data/boulder-fulltest.db';
const POSTGRES_MASTER_DB = process.env.PG_MASTER_DB || 'trail_master_db';
const POSTGRES_TEST_DB = process.env.PGDATABASE || 'trail_master_db_test';
const DB_USER = process.env.PGUSER || 'tester';
const DB_PASSWORD = process.env.PGPASSWORD || '';
const DB_HOST = process.env.PGHOST || 'localhost';
const DB_PORT = parseInt(process.env.PGPORT || '5432');

const args = process.argv.slice(2);
let region = DEFAULT_REGION;
let sqlitePath = DEFAULT_SQLITE_PATH;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--region') region = args[i + 1] ?? region;
  if (args[i] === '--sqlite') sqlitePath = args[i + 1] ?? sqlitePath;
}

async function checkPostgresEdges(dbName: string, label: string) {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: dbName,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  await client.connect();
  console.log(`\n[${label}] Connected to Postgres DB: ${dbName}`);
  // Check for routing_edges table
  const tableRes = await client.query(`SELECT to_regclass('public.routing_edges') as exists`);
  if (!tableRes.rows[0].exists) {
    console.log(`[${label}] No routing_edges table in ${dbName}`);
    await client.end();
    return;
  }
  const countRes = await client.query('SELECT COUNT(*) FROM routing_edges');
  const count = Number(countRes.rows[0].count);
  console.log(`[${label}] routing_edges count: ${count}`);
  if (count > 0) {
    const sampleRes = await client.query('SELECT * FROM routing_edges LIMIT 5');
    console.log(`[${label}] Sample routing_edges rows:`);
    for (const row of sampleRes.rows) console.log(row);
  }
  await client.end();
}

async function checkStagingEdges(region: string, dbName: string) {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: dbName,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  await client.connect();
  console.log(`\n[STAGING] Connected to Postgres DB: ${dbName}`);
  // Find latest staging schema
  const schemaLike = `staging_${region}_%`;
  const schemasRes = await client.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1 ORDER BY schema_name DESC`,
    [schemaLike]
  );
  if (schemasRes.rows.length === 0) {
    console.log(`[STAGING] No staging schemas found for region '${region}'.`);
    await client.end();
    return;
  }
  const stagingSchema = schemasRes.rows[0].schema_name;
  console.log(`[STAGING] Using staging schema: ${stagingSchema}`);
  const countRes = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
  const count = Number(countRes.rows[0].count);
  console.log(`[STAGING] routing_edges count: ${count}`);
  if (count > 0) {
    const sampleRes = await client.query(`SELECT * FROM ${stagingSchema}.routing_edges LIMIT 5`);
    console.log(`[STAGING] Sample routing_edges rows:`);
    for (const row of sampleRes.rows) console.log(row);
  }
  await client.end();
}

function checkSqliteEdges(sqlitePath: string) {
  if (!fs.existsSync(sqlitePath)) {
    console.log(`\n[SQLITE] File not found: ${sqlitePath}`);
    return;
  }
  const db = new Database(sqlitePath, { readonly: true });
  console.log(`\n[SQLITE] Opened ${sqlitePath}`);
  const tableRes = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='routing_edges'`).get();
  if (!tableRes) {
    console.log('[SQLITE] No routing_edges table found.');
    db.close();
    return;
  }
  const countRow = db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number };
  const count = countRow.n;
  console.log(`[SQLITE] routing_edges count: ${count}`);
  if (count > 0) {
    const rows = db.prepare('SELECT * FROM routing_edges LIMIT 5').all();
    console.log('[SQLITE] Sample routing_edges rows:');
    for (const row of rows) console.log(row);
  }
  db.close();
}

(async () => {
  await checkPostgresEdges(POSTGRES_MASTER_DB, 'MASTER');
  await checkStagingEdges(region, POSTGRES_TEST_DB);
  checkSqliteEdges(sqlitePath);
  console.log('\n[END-TO-END CHECK COMPLETE]');
})(); 