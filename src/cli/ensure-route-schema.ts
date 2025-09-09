#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

async function ensureExtensions(client: Pool) {
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
}

async function tableExists(client: Pool, schema: string, table: string): Promise<boolean> {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [schema, table]
  );
  return Boolean(res.rows[0]?.exists);
}

async function columnExists(client: Pool, schema: string, table: string, column: string): Promise<boolean> {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
     ) AS exists`,
    [schema, table, column]
  );
  return Boolean(res.rows[0]?.exists);
}

async function ensureLollipopRoutesTable(client: Pool, schema: string) {
  // Create table if missing
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.lollipop_routes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      anchor_node INTEGER NOT NULL,
      dest_node INTEGER NOT NULL,
      outbound_distance REAL NOT NULL,
      return_distance REAL NOT NULL,
      total_distance REAL NOT NULL,
      path_id INTEGER NOT NULL,
      connection_type TEXT NOT NULL,
      route_shape TEXT NOT NULL,
      edge_overlap_count INTEGER NOT NULL,
      edge_overlap_percentage REAL NOT NULL,
      route_geometry GEOMETRY(MULTILINESTRINGZ, 4326),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Handle legacy *_km columns by renaming to new names if present
  const legacyOutbound = await columnExists(client, schema, 'lollipop_routes', 'outbound_distance_km');
  const legacyReturn = await columnExists(client, schema, 'lollipop_routes', 'return_distance_km');
  const legacyTotal = await columnExists(client, schema, 'lollipop_routes', 'total_distance_km');

  const hasOutbound = await columnExists(client, schema, 'lollipop_routes', 'outbound_distance');
  const hasReturn = await columnExists(client, schema, 'lollipop_routes', 'return_distance');
  const hasTotal = await columnExists(client, schema, 'lollipop_routes', 'total_distance');

  if (!hasOutbound && legacyOutbound) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes RENAME COLUMN outbound_distance_km TO outbound_distance`);
  }
  if (!hasReturn && legacyReturn) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes RENAME COLUMN return_distance_km TO return_distance`);
  }
  if (!hasTotal && legacyTotal) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes RENAME COLUMN total_distance_km TO total_distance`);
  }

  // Ensure required columns exist (if table pre-existed without them)
  if (!(await columnExists(client, schema, 'lollipop_routes', 'outbound_distance'))) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes ADD COLUMN outbound_distance REAL`);
  }
  if (!(await columnExists(client, schema, 'lollipop_routes', 'return_distance'))) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes ADD COLUMN return_distance REAL`);
  }
  if (!(await columnExists(client, schema, 'lollipop_routes', 'total_distance'))) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes ADD COLUMN total_distance REAL`);
  }

  // Ensure geometry column exists and is MULTILINESTRINGZ(4326)
  if (!(await columnExists(client, schema, 'lollipop_routes', 'route_geometry'))) {
    await client.query(`ALTER TABLE ${schema}.lollipop_routes ADD COLUMN route_geometry GEOMETRY(MULTILINESTRINGZ, 4326)`);
  } else {
    // Try to coerce to Z if needed
    await client.query(`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE ${schema}.lollipop_routes
          ALTER COLUMN route_geometry TYPE GEOMETRY(MULTILINESTRINGZ, 4326)
          USING ST_Force3D(route_geometry);
        EXCEPTION WHEN others THEN
          -- Leave as-is if incompatible; generation will still work
          NULL;
        END;
      END$$;
    `);
  }
}

async function ensureRouteRecommendationsTable(client: Pool, schema: string) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.route_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_length_km REAL CHECK(input_length_km > 0),
      input_elevation_gain REAL,
      recommended_length_km REAL CHECK(recommended_length_km > 0),
      recommended_elevation_gain REAL,
      route_shape TEXT,
      trail_count INTEGER,
      route_score REAL,
      similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
      route_path JSONB,
      route_edges JSONB,
      route_name TEXT,
      route_geometry GEOMETRY(MULTILINESTRINGZ, 4326),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Ensure geometry column is Z
  await client.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE ${schema}.route_recommendations
        ALTER COLUMN route_geometry TYPE GEOMETRY(MULTILINESTRINGZ, 4326)
        USING ST_Force3D(route_geometry);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END$$;
  `);
}

async function main() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name');
    console.error('Usage: npx ts-node src/cli/ensure-route-schema.ts <schema_name>');
    process.exit(1);
  }

  const pool = new Pool(getDatabasePoolConfig());
  try {
    await ensureExtensions(pool);
    await ensureLollipopRoutesTable(pool, schema);
    await ensureRouteRecommendationsTable(pool, schema);
    console.log(`✅ Ensured route tables/columns for schema: ${schema}`);
  } catch (err) {
    console.error('❌ Failed to ensure route schema:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


