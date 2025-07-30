const Database = require('better-sqlite3');
const fs = require('fs');

// Test SQLite schema creation
const testDbPath = './test-sqlite-schema.db';

// Clean up any existing test file
if (fs.existsSync(testDbPath)) {
  console.log('🗑️ Deleting existing test database...');
  fs.unlinkSync(testDbPath);
}

console.log('🔧 Creating test SQLite database with v12 schema...');
const db = new Database(testDbPath);

// Create routing_edges table with v12 schema
db.exec(`
  CREATE TABLE IF NOT EXISTS routing_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source INTEGER NOT NULL,
    target INTEGER NOT NULL,
    trail_id TEXT,
    trail_name TEXT,
    distance_km REAL CHECK(distance_km > 0),
    geojson TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Check the actual table schema
const tableInfo = db.prepare('PRAGMA table_info(routing_edges)').all();
console.log('📋 routing_edges table schema:');
tableInfo.forEach(col => {
  console.log(`  - ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''}`);
});

// Check if source and target columns exist
const hasSource = tableInfo.some(col => col.name === 'source');
const hasTarget = tableInfo.some(col => col.name === 'target');

console.log(`\n✅ Schema check:`);
console.log(`  - Has 'source' column: ${hasSource}`);
console.log(`  - Has 'target' column: ${hasTarget}`);

if (!hasSource || !hasTarget) {
  console.error('❌ ERROR: Missing required v12 columns!');
  process.exit(1);
}

// Test inserting a sample edge
try {
  const insertStmt = db.prepare(`
    INSERT INTO routing_edges (
      source, target, trail_id, trail_name, distance_km, geojson, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  insertStmt.run(1, 2, 'test-trail', 'Test Trail', 1.5, '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-105,40],[-105.1,40.1]]}}', new Date().toISOString());
  
  console.log('✅ Successfully inserted test edge with v12 schema');
} catch (error) {
  console.error('❌ Error inserting test edge:', error);
  process.exit(1);
}

db.close();
console.log('✅ SQLite v12 schema test completed successfully'); 