#!/usr/bin/env ts-node

import { Client } from 'pg';

// Usage:
//   STAGING_SCHEMA=staging_boulder_test_improved_loops DATABASE_URL=postgres://user:pass@host:port/trail_master_db ./scripts/prototype-edge-analysis-optimization.ts

const stagingSchema = process.env.STAGING_SCHEMA || 'staging_boulder_test_improved_loops';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

function nowMs(): number {
  const [sec, nano] = process.hrtime();
  return sec * 1e3 + nano / 1e6;
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log(`Using schema: ${stagingSchema}`);

    // Original query (as found in repo)
    const originalSql = `
      WITH edge_analysis AS (
        SELECT 
          id,
          source,
          target,
          old_id,
          sub_id,
          the_geom,
          ST_Length(the_geom::geography) as length_meters,
          ST_NumPoints(the_geom) as num_points,
          (SELECT COUNT(*) 
           FROM ${stagingSchema}.ways_vertices_pgr v 
           WHERE v.id != source AND v.id != target 
           AND ST_DWithin(v.the_geom, the_geom, 0.0001)
           AND ST_Contains(ST_Buffer(the_geom, 0.0001), v.the_geom)
          ) as nodes_bypassed
        FROM ${stagingSchema}.ways_noded
        WHERE the_geom IS NOT NULL
      )
      SELECT 
        id,
        source,
        target,
        old_id,
        sub_id,
        length_meters,
        num_points,
        nodes_bypassed
      FROM edge_analysis
      WHERE nodes_bypassed > 0
      ORDER BY nodes_bypassed DESC, length_meters DESC
      LIMIT 100
    `;

    // Optimized query:
    // - Avoid geography cast; length in meters via ST_Transform to 3857
    // - Replace ST_Contains(ST_Buffer(...)) with precise but indexable pattern: bbox prefilter + ST_DWithin precise check
    // - Push filters earlier and avoid carrying geometry in outer projection
    const optimizedSql = `
      WITH edges AS (
        SELECT 
          id,
          source,
          target,
          the_geom
        FROM ${stagingSchema}.ways_noded
        WHERE the_geom IS NOT NULL
      ),
      -- Precompute length in meters using projected SRID (WebMercator)
      edge_len AS (
        SELECT 
          e.id,
          e.source,
          e.target,
          ST_NumPoints(e.the_geom) AS num_points,
          ST_Length(ST_Transform(e.the_geom, 3857)) AS length_meters,
          e.the_geom
        FROM edges e
      ),
      nodes AS (
        SELECT id, the_geom FROM ${stagingSchema}.ways_vertices_pgr
      ),
      nodes_b AS (
        SELECT 
          el.id,
          COUNT(*) FILTER (WHERE v.id IS NOT NULL) AS nodes_bypassed
        FROM edge_len el
        LEFT JOIN LATERAL (
          SELECT v.id
          FROM nodes v
          WHERE v.id <> el.source AND v.id <> el.target
            AND v.the_geom && ST_Envelope(el.the_geom)
            AND ST_DWithin(v.the_geom, el.the_geom, 0.0001)
        ) v ON TRUE
        GROUP BY el.id
      )
      SELECT 
        el.id,
        el.source,
        el.target,
        el.length_meters,
        el.num_points,
        nb.nodes_bypassed
      FROM edge_len el
      JOIN nodes_b nb ON nb.id = el.id
      WHERE nb.nodes_bypassed > 0
      ORDER BY nb.nodes_bypassed DESC, el.length_meters DESC
      LIMIT 100
    `;

    // Timed runs
    const t1 = nowMs();
    const orig = await client.query(originalSql);
    const t2 = nowMs();
    const opt = await client.query(optimizedSql);
    const t3 = nowMs();

    const origMs = t2 - t1;
    const optMs = t3 - t2;

    // Compare equality by IDs and key fields
    function keyRow(r: any) {
      return {
        id: Number(r.id),
        source: Number(r.source),
        target: Number(r.target),
        // Round to reduce tiny numerical differences
        length_meters: Math.round(Number(r.length_meters)),
        num_points: Number(r.num_points),
        nodes_bypassed: Number(r.nodes_bypassed)
      };
    }

    const origKeys = orig.rows.map(keyRow);
    const optKeys = opt.rows.map(keyRow);

    const serialize = (arr: any[]) => JSON.stringify(arr);
    const equal = serialize(origKeys) === serialize(optKeys);

    console.log('Original rows:', orig.rows.length, 'time_ms:', origMs.toFixed(1));
    console.log('Optimized rows:', opt.rows.length, 'time_ms:', optMs.toFixed(1));
    console.log('Outputs identical (rounded):', equal);

    if (!equal) {
      // Print diffs by id
      const byId = new Map<number, any>();
      origKeys.forEach(r => byId.set(r.id, r));
      for (const r of optKeys) {
        const o = byId.get(r.id);
        if (!o || serialize(o) !== serialize(r)) {
          console.log('DIFF', { original: o, optimized: r });
          break;
        }
      }
    }

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


