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

  // Check if functions exist
  const nodeFuncRes = await client.query(
    `SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 AND routine_name = 'build_routing_nodes'`,
    [stagingSchema]
  );
  const edgeFuncRes = await client.query(
    `SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 AND routine_name = 'build_routing_edges'`,
    [stagingSchema]
  );
  console.log(`[DEBUG] build_routing_nodes exists: ${nodeFuncRes.rows.length > 0}`);
  console.log(`[DEBUG] build_routing_edges exists: ${edgeFuncRes.rows.length > 0}`);

  // Try running the functions (catch errors)
  try {
    const nodeResult = await client.query(
      `SELECT ${stagingSchema}.build_routing_nodes('${stagingSchema}', 'split_trails', 2.0)`
    );
    console.log(`[DEBUG] build_routing_nodes result:`, nodeResult.rows);
  } catch (err) {
    console.error(`[ERROR] build_routing_nodes failed:`, (err as any).message);
  }
  try {
    const edgeResult = await client.query(
      `SELECT ${stagingSchema}.build_routing_edges('${stagingSchema}', 'split_trails', 20.0)`
    );
    console.log(`[DEBUG] build_routing_edges result:`, edgeResult.rows);
  } catch (err) {
    console.error(`[ERROR] build_routing_edges failed:`, (err as any).message);
  }

  // Check counts and sample rows
  const nodeCountRes = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes`);
  const edgeCountRes = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.routing_edges`);
  console.log(`[DEBUG] routing_nodes count: ${nodeCountRes.rows[0].count}`);
  console.log(`[DEBUG] routing_edges count: ${edgeCountRes.rows[0].count}`);
  if (Number(nodeCountRes.rows[0].count) > 0) {
    const nodeSample = await client.query(`SELECT * FROM ${stagingSchema}.routing_nodes LIMIT 3`);
    console.log('[DEBUG] Sample routing_nodes rows:');
    for (const row of nodeSample.rows) console.log(row);
  }
  if (Number(edgeCountRes.rows[0].count) > 0) {
    const edgeSample = await client.query(`SELECT * FROM ${stagingSchema}.routing_edges LIMIT 3`);
    console.log('[DEBUG] Sample routing_edges rows:');
    for (const row of edgeSample.rows) console.log(row);
  }

  await client.end();
  console.log('[DEBUG] Done.');
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
}); 