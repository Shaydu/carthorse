import Database from 'better-sqlite3';

const dbPath = './data/boulder-debug.db';
const spatialiteExt = '/opt/homebrew/lib/mod_spatialite.dylib';

console.log('[CHECK] Opening database:', dbPath);
const db = new Database(dbPath);

try {
  db.loadExtension(spatialiteExt);
  console.log('[CHECK] SpatiaLite extension loaded successfully');
} catch (err) {
  console.error('[ERROR] Failed to load SpatiaLite extension:', err);
  process.exit(1);
}

const rows = db.prepare(`SELECT id, app_uuid, name, AsText(geometry) as wkt FROM trails LIMIT 10`).all() as { id: number, app_uuid: string, name: string, wkt: string | null }[];
let nonNullCount = 0;
console.log('[CHECK] Sample geometry rows:');
for (const row of rows) {
  if (row.wkt) nonNullCount++;
  console.log(row);
}
console.log(`[CHECK] ${nonNullCount} of ${rows.length} sample trails have non-NULL geometry.`);

if (nonNullCount === 0) {
  console.error('[FAIL] No geometry found in sample!');
  process.exit(2);
} else {
  console.log('[PASS] Geometry export appears to be working.');
  process.exit(0);
} 