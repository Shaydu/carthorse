#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

async function checkSchema(pool: Pool, schema: string) {
  console.log(`\n🔎 Checking Shadow Canyon in schema: ${schema}`);

  // 1) Find candidate edges and trails referencing Shadow Canyon by name
  const ways = await pool.query(
    `SELECT id, original_trail_uuid, original_trail_name, source, target, length_km
     FROM ${schema}.ways_noded
     WHERE original_trail_name ILIKE '%Shadow%' OR original_trail_uuid ILIKE '%shadow%'
     ORDER BY length_km DESC
     LIMIT 50`
  );
  console.log(`   • ways_noded matches: ${ways.rowCount}`);

  // 2) If trails table exists, check there
  const trailsTable = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'trails'
     ) AS exists`,
    [schema]
  );
  const hasTrails = Boolean(trailsTable.rows[0]?.exists);
  if (hasTrails) {
    const trails = await pool.query(
      `SELECT app_uuid, name
       FROM ${schema}.trails
       WHERE name ILIKE '%Shadow%'
       ORDER BY name`
    );
    console.log(`   • trails matches: ${trails.rowCount}`);
  } else {
    console.log('   • trails table not present');
  }

  if (ways.rowCount === 0) {
    console.log('   ⚠️ No Shadow Canyon edges found in ways_noded');
    return;
  }

  // 3) Inspect connectivity for top candidate edge's endpoints
  const candidate = ways.rows[0];
  console.log(`   • Top candidate way id=${candidate.id}, name='${candidate.original_trail_name}', length_km=${candidate.length_km}`);

  const deg = await pool.query(
    `WITH deg AS (
       SELECT $1::bigint AS node_id
       UNION ALL
       SELECT $2::bigint
     )
     SELECT 
       d.node_id,
       (SELECT COUNT(*) FROM ${schema}.ways_noded w WHERE w.source = d.node_id OR w.target = d.node_id) AS degree,
       ST_X(v.the_geom) AS lon,
       ST_Y(v.the_geom) AS lat
     FROM deg d
     JOIN ${schema}.ways_noded_vertices_pgr v ON v.id = d.node_id`
  , [candidate.source, candidate.target]);

  for (const r of deg.rows) {
    console.log(`   • node ${r.node_id}: degree=${r.degree}, lat=${r.lat?.toFixed(6)}, lon=${r.lon?.toFixed(6)}`);
  }
}

async function main() {
  const schemas = process.argv.slice(2);
  if (schemas.length === 0) {
    console.error('Usage: npx ts-node src/cli/check-shadow-canyon.ts <schema1> [schema2]');
    process.exit(1);
  }

  const pool = new Pool(getDatabasePoolConfig());
  try {
    for (const schema of schemas) {
      await checkSchema(pool, schema);
    }
  } catch (e) {
    console.error('Error:', (e as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


