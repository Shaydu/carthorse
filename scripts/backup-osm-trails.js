#!/usr/bin/env node

const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://carthorse@localhost:5432/trail_master_db';
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS public._trails_osm (LIKE public.trails INCLUDING ALL)');
    await client.query('TRUNCATE public._trails_osm');
    const pub = await client.query("SELECT count(*)::int AS c FROM public.trails WHERE source='osm'");
    await client.query("INSERT INTO public._trails_osm SELECT * FROM public.trails WHERE source='osm'");
    const bak = await client.query('SELECT count(*)::int AS c FROM public._trails_osm');
    await client.query('COMMIT');
    console.log(`Public OSM: ${pub.rows[0].c} | Backup OSM: ${bak.rows[0].c}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();


