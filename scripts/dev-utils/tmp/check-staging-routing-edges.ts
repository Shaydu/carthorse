#!/usr/bin/env ts-node

import { Client } from 'pg';

const DEFAULT_REGION = 'boulder';
const DB_NAME = process.env.PGDATABASE || 'trail_master_db_test';
const DB_USER = process.env.PGUSER || 'tester';
const DB_PASSWORD = process.env.PGPASSWORD || '';
const DB_HOST = process.env.PGHOST || 'localhost';
const DB_PORT = parseInt(process.env.PGPORT || '5432');

const args = process.argv.slice(2);
let region = DEFAULT_REGION;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--region') {
    region = args[i + 1] ?? region;
  }
}

console.log(`[DEBUG] Connecting to test DB: ${DB_NAME} as user ${DB_USER}`);
console.log(`[DEBUG] Region: ${region}`);

const client = new Client({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
});

async function main() {
  await client.connect();

  // Find latest staging schema for region
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

  // Check routing_edges in staging
  const edgesCountRes = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
  const edgesCount = Number(edgesCountRes.rows[0].count);
  console.log(`[DEBUG] routing_edges count in staging: ${edgesCount}`);
  if (edgesCount > 0) {
    const edgeSamplesRes = await client.query(`SELECT * FROM ${stagingSchema}.routing_edges LIMIT 5`);
    console.log('[DEBUG] Sample routing_edges rows:');
    for (const row of edgeSamplesRes.rows) {
      console.log(row);
    }
  } else {
    console.log('[DEBUG] No routing_edges found in staging.');
  }

  await client.end();
  console.log('[DEBUG] Done.');
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
}); 