import Database from 'better-sqlite3';
import { createSqliteTables, insertRoutingEdges } from '../utils/sqlite-export-helpers';

describe('Debug SQLite Issue', () => {
  test('Minimal test to isolate the source column error', () => {
    // Create a fresh database
    const db = new Database(':memory:');
    
    console.log('[DEBUG] Creating fresh SQLite database...');
    
    // Create tables
    createSqliteTables(db);
    
    // Check table structure
    const tableInfo = db.prepare('PRAGMA table_info(routing_edges)').all();
    console.log('[DEBUG] Table structure:', tableInfo);
    
    // Create minimal test data
    const testEdges = [
      {
        source: 1,
        target: 2,
        trail_id: 'test-trail-1',
        trail_name: 'Test Trail',
        distance_km: 1.0,
        geojson: '{"type":"LineString","coordinates":[[0,0],[1,1]]}',
        created_at: new Date().toISOString()
      }
    ];
    
    console.log('[DEBUG] Test edge data:', testEdges[0]);
    
    // Try to insert
    try {
      insertRoutingEdges(db, testEdges);
      console.log('[DEBUG] Insert successful!');
    } catch (err) {
      console.error('[DEBUG] Insert failed:', err);
      throw err;
    }
    
    db.close();
  });
});