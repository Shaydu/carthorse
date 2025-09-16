#!/usr/bin/env node

const { Client } = require('pg');

const KEEP_APP_UUIDS = [
  '7298d984-83e2-4b29-8e45-510cd7b911fd',
  '8df96a4d-ec61-4f64-b4e1-3ebe9bb7c79e',
  '1987554f-079e-4589-867b-664339cde405',
  '479a6127-7794-49a4-94ed-8b4cd81bb563',
  'd80d9ec2-0be2-46d5-8958-1e6c76efa545',
  'e9662130-59f3-4af2-b570-ee69fbcfc50a',
  'c2750428-49ba-48d7-a913-4f71a9285490',
  'd789282a-5c3a-4e1d-85c8-c24114f2c82f',
  '8921e43b-cfcc-43d8-b9ca-503b188e02a1',
  'b638a2ea-c95d-40cb-bc16-1b896968e2bf',
  'f9523c1d-9b1d-422d-a221-ed795db29f4a',
  '18d9a6d7-2397-4011-9260-ef67b4122364',
  '3108beeb-23f8-4aa4-92c3-b0e683834536',
  '2975c602-e79d-4259-9215-8d1a5ccacb37',
  '9ecd4c16-d716-46e1-b393-8514ba95fe04',
  'fbd90590-4517-437b-8044-71e36839fa9d',
  'ff4457f8-41e8-4cfe-85c9-a56abbc0f733',
  'cdd6f850-4fd9-4228-a9c7-17ad837408e6',
  'd19c40b6-6ca3-40db-b3e0-0d2424b9b09d',
  '66c269e5-1222-4816-a6b4-559864c632c4',
  '51f5ba77-e564-45a7-ab16-108a52d7eea4'
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://carthorse@localhost:5432/trail_master_db';
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const total = await client.query("SELECT count(*)::int AS c FROM public.trails WHERE source='osm'");
    const keep = await client.query("SELECT count(*)::int AS c FROM public.trails WHERE source='osm' AND app_uuid = ANY($1)", [KEEP_APP_UUIDS]);
    const del = total.rows[0].c - keep.rows[0].c;
    console.log(`OSM total: ${total.rows[0].c} | keep: ${keep.rows[0].c} | delete: ${del}`);

    await client.query('BEGIN');
    const res = await client.query("DELETE FROM public.trails WHERE source='osm' AND app_uuid <> ALL($1)", [KEEP_APP_UUIDS]);
    await client.query('COMMIT');
    console.log(`Deleted rows: ${res.rowCount}`);

    const remain = await client.query("SELECT count(*)::int AS c FROM public.trails WHERE source='osm'");
    console.log(`Remaining OSM (kept): ${remain.rows[0].c}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();


