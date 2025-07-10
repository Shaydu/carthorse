#!/usr/bin/env tsx

import { Client } from 'pg';
import { AtomicTrailInserter, TrailInsertData } from './carthorse-postgres-atomic-insert';
import * as dotenv from 'dotenv';
dotenv.config();

interface TrailRecord {
  app_uuid: string;
  osm_id: string;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  geometry: string;
  source_tags: string;
  region: string;
}

function parseGeometryWKT(geometry: string): number[][] {
  // Expects LINESTRING or LINESTRING Z
  const match = geometry.match(/LINESTRING(?: Z)? \(([^)]+)\)/);
  if (!match) throw new Error(`Invalid geometry: ${geometry}`);
  return match[1].split(',').map(pair => {
    const parts = pair.trim().split(' ').map(Number);
    // Only take lng, lat (ignore elevation if present)
    return [parts[0], parts[1]];
  });
}

function parseSourceTags(tags: string): Record<string, string> {
  try {
    return JSON.parse(tags);
  } catch {
    return {};
  }
}

async function updateBoulderElevation() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  });

  try {
    console.log('🔌 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    // Get all Boulder trails
    console.log('🔍 Fetching Boulder trails...');
    const { rows } = await client.query(
      `SELECT * FROM trails WHERE region = 'boulder'`
    );
    console.log(`📊 Found ${rows.length} Boulder trails`);

    const inserter = new AtomicTrailInserter(process.env.PGDATABASE || 'postgres');
    await inserter.connect();
    await inserter.loadTiffFiles();

    let updated = 0;
    for (const row of rows) {
      const trail: TrailInsertData = {
        osm_id: row.osm_id,
        name: row.name,
        trail_type: row.trail_type,
        surface: row.surface,
        difficulty: row.difficulty,
        coordinates: parseGeometryWKT(row.geometry),
        source_tags: parseSourceTags(row.source_tags),
        region: row.region
      };
      const result = await inserter.insertTrailAtomically(trail);
      if (result && result.success) updated++;
    }
    console.log(`✅ Updated elevation for ${updated} trails`);
    await inserter.disconnect();
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.end();
    console.log('🔌 Disconnected from PostgreSQL');
  }
}

updateBoulderElevation(); 