import Database from 'better-sqlite3';

const dbPath = './data/boulder-debug.db';
const spatialiteExt = '/opt/homebrew/lib/mod_spatialite.dylib';

console.log('[DEBUG] Opening database:', dbPath);
const db = new Database(dbPath);

try {
  db.loadExtension(spatialiteExt);
  console.log('[DEBUG] SpatiaLite extension loaded successfully');
} catch (err) {
  console.error('[ERROR] Failed to load SpatiaLite extension:', err);
  process.exit(1);
}

const testWKT = 'LINESTRING Z (-105.0 40.0 1000, -105.1 40.1 1100)';

try {
  const update = db.prepare("UPDATE trails SET geometry = GeomFromText(?, 4326) WHERE id = 1");
  const result = update.run(testWKT);
  console.log('[DEBUG] Geometry update result:', result);
} catch (err) {
  console.error('[ERROR] Failed to update geometry:', err);
}

try {
  const row = db.prepare("SELECT id, app_uuid, name, AsText(geometry) as wkt FROM trails WHERE id = 1").get();
  console.log('[DEBUG] Read back geometry:', row);
} catch (err) {
  console.error('[ERROR] Failed to read back geometry:', err);
}

db.close();
console.log('[DEBUG] Done.'); 