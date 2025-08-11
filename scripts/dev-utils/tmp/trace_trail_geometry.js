// Usage: node trace_trail_geometry.js
// Optionally set PGDATABASE, PGUSER, PGPASSWORD, PGHOST, PGPORT, and SPATIALITE_DB_PATH

const { Client } = require('pg');
const Database = require('better-sqlite3');

const PGDATABASE = process.env.PGDATABASE || 'trail_master_db_test';
const PGUSER = process.env.PGUSER || 'tester';
const PGPASSWORD = process.env.PGPASSWORD || '';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = process.env.PGPORT || 5432;
const STAGING_SCHEMA = process.env.STAGING_SCHEMA || 'staging_boulder_xxxxx'; // <-- FILL THIS IN
const SPATIALITE_DB_PATH = process.env.SPATIALITE_DB_PATH || './data/boulder-test.db';
const TRAIL_NAME = process.env.TRAIL_NAME || 'north sky trail';

async function tracePostgres() {
  const client = new Client({
    host: PGHOST,
    port: PGPORT,
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD,
  });
  await client.connect();

  console.log('--- [1] Source Postgres trails table ---');
  let res = await client.query(
    `SELECT id, app_uuid, name, ST_AsText(geometry) AS wkt, ST_NDims(geometry) AS dims, ST_SRID(geometry) AS srid,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
     FROM trails WHERE lower(name) LIKE $1`, [`%${TRAIL_NAME.toLowerCase()}%`]
  );
  console.table(res.rows);

  console.log('--- [2] Staging trails table ---');
  res = await client.query(
    `SELECT id, app_uuid, name, ST_AsText(geometry) AS wkt, ST_NDims(geometry) AS dims, ST_SRID(geometry) AS srid,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
     FROM ${STAGING_SCHEMA}.trails WHERE lower(name) LIKE $1`, [`%${TRAIL_NAME.toLowerCase()}%`]
  );
  console.table(res.rows);

  console.log('--- [3] Staging split_trails table ---');
  res = await client.query(
    `SELECT original_trail_id, segment_number, app_uuid, name, ST_AsText(geometry) AS wkt, ST_NDims(geometry) AS dims,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
     FROM ${STAGING_SCHEMA}.split_trails WHERE lower(name) LIKE $1`, [`%${TRAIL_NAME.toLowerCase()}%`]
  );
  console.table(res.rows);

  await client.end();
}

function traceSpatiaLite() {
  try {
    const db = new Database(SPATIALITE_DB_PATH, { readonly: true });
    console.log('--- [4] SpatiaLite export trails table ---');
    const rows = db.prepare(
      `SELECT app_uuid, name, AsText(geometry) AS wkt, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
       FROM trails WHERE lower(name) LIKE ?`
    ).all(`%${TRAIL_NAME.toLowerCase()}%`);
    console.table(rows);
    db.close();
  } catch (err) {
    console.error('Could not open SpatiaLite DB:', err.message);
  }
}

(async () => {
  await tracePostgres();
  traceSpatiaLite();
})(); 