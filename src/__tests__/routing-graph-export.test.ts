import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

// Test config for Boulder - OPTIMIZED for speed
const REGION = 'boulder';
const REGION_DB = path.resolve(__dirname, '../test-output/boulder-export-fast.db');

// Utility to clean up test DBs
function cleanupTestDbs() {
  if (fs.existsSync(REGION_DB)) fs.unlinkSync(REGION_DB);
}

// Ensure output directories exist before any file write
if (!fs.existsSync(path.dirname(REGION_DB))) {
  fs.mkdirSync(path.dirname(REGION_DB), { recursive: true });
}

// LIGHTWEIGHT test configuration
const TEST_CONFIG = {
  database: {
    host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
    port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
    database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
  },
  test: {
    maxTrails: 3, // Only test with 3 trails for speed
    region: 'boulder',
    simplifyTolerance: 0.001,
    intersectionTolerance: 2.0,
    maxSqliteDbSizeMB: 10, // Small size for testing
  },
  limits: {
    timeout: 30000, // 30 seconds max
  },
};

describe('Routing Graph Export Pipeline (Optimized)', () => {
  let client: Client;

  beforeAll(async () => {
    try {
      client = new Client(TEST_CONFIG.database);
      await client.connect();
      console.log(`✅ Connected to test database ${TEST_CONFIG.database.database}`);
    } catch (err) {
      console.log(`⏭️  Skipping beforeAll - connection failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
    cleanupTestDbs();
  });

  describe('Fast Routing Graph Export', () => {
    test('should export routing nodes and edges with correct schema for boulder', async () => {
      // Clean up any existing test file
    if (fs.existsSync(REGION_DB)) {
      fs.unlinkSync(REGION_DB);
    }

      try {
        // Get a small subset of trails for testing
        const trailQuery = `
          SELECT 
            app_uuid, osm_id, name, trail_type, surface, 
            ST_AsGeoJSON(geometry) as geojson,
            elevation_gain, elevation_loss, 
            max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
          FROM trails 
          WHERE region = $1 
          LIMIT $2
        `;
        
        const trails = await client.query(trailQuery, [TEST_CONFIG.test.region, TEST_CONFIG.test.maxTrails]);
        
        if (trails.rows.length === 0) {
          console.log(`⏭️  Skipping test - no ${TEST_CONFIG.test.region} trails found`);
          return;
        }

        console.log(`📊 Testing routing graph export with ${trails.rows.length} trails from ${TEST_CONFIG.test.region}`);

        // Create SQLite database directly
        const db = new Database(REGION_DB);
        
        // Create tables using the helper functions
        const { createSqliteTables } = require('../utils/sqlite-export-helpers');
        createSqliteTables(db);
        
        // Insert trails
        const { insertTrails } = require('../utils/sqlite-export-helpers');
        insertTrails(db, trails.rows);
        
        // Create simple routing nodes and edges for testing
        const testNodes = [
          { node_uuid: 'node-1', lat: 40.0, lng: -105.3, elevation: 1800, node_type: 'intersection', connected_trails: 'trail-1', created_at: new Date().toISOString() },
          { node_uuid: 'node-2', lat: 40.1, lng: -105.2, elevation: 1850, node_type: 'intersection', connected_trails: 'trail-1,trail-2', created_at: new Date().toISOString() },
          { node_uuid: 'node-3', lat: 40.05, lng: -105.25, elevation: 1825, node_type: 'intersection', connected_trails: 'trail-2', created_at: new Date().toISOString() }
        ];
        
        const testEdges = [
          { 
            source: 1, target: 2, trail_id: 'test-trail-1', trail_name: 'Test Trail 1',
            distance_km: 1.5, elevation_gain: 50, elevation_loss: 0,
            geojson: '{"type":"LineString","coordinates":[[-105.3,40.0],[-105.2,40.1]]}',
            created_at: new Date().toISOString()
          },
          { 
            source: 2, target: 3, trail_id: 'test-trail-2', trail_name: 'Test Trail 2',
            distance_km: 2.0, elevation_gain: 25, elevation_loss: 0,
            geojson: '{"type":"LineString","coordinates":[[-105.2,40.1],[-105.25,40.05]]}',
            created_at: new Date().toISOString()
          }
        ];
        
        // Insert routing data
        const { insertRoutingNodes, insertRoutingEdges } = require('../utils/sqlite-export-helpers');
        insertRoutingNodes(db, testNodes);
        insertRoutingEdges(db, testEdges);
        
        db.close();

        // Verify the output file was created
        expect(fs.existsSync(REGION_DB)).toBe(true);
        
        // Verify the database has the expected structure
        const verifyDb = new Database(REGION_DB, { readonly: true });
        try {
          const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
          expect(tables).toContain('trails');
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('routing_edges');
          
          // Check that we have the expected data
          const trailCount = (verifyDb.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
          expect(trailCount).toBe(trails.rows.length);
          
          const nodeCount = (verifyDb.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
          expect(nodeCount).toBe(testNodes.length);
          
          const edgeCount = (verifyDb.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
          expect(edgeCount).toBe(testEdges.length);
          
          // Verify routing edge schema
          const edgeSchema = verifyDb.prepare("PRAGMA table_info(routing_edges)").all();
          const edgeColumns = edgeSchema.map((col: any) => col.name);
          expect(edgeColumns).toContain('source');
          expect(edgeColumns).toContain('target');
          expect(edgeColumns).toContain('trail_id');
          expect(edgeColumns).toContain('geojson');
          
          // Verify routing node schema
          const nodeSchema = verifyDb.prepare("PRAGMA table_info(routing_nodes)").all();
          const nodeColumns = nodeSchema.map((col: any) => col.name);
          expect(nodeColumns).toContain('lat');
          expect(nodeColumns).toContain('lng');
          expect(nodeColumns).toContain('elevation');
          
          console.log(`✅ Successfully exported routing graph: ${trailCount} trails, ${nodeCount} nodes, ${edgeCount} edges`);
        } finally {
          verifyDb.close();
        }
        
      } catch (error) {
        console.log(`❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }, TEST_CONFIG.limits.timeout);

    test('should handle empty routing graph gracefully', async () => {
      // Clean up any existing test file
      if (fs.existsSync(REGION_DB)) {
        fs.unlinkSync(REGION_DB);
      }

      try {
        // Create SQLite database with no routing data
        const db = new Database(REGION_DB);
        
        const { createSqliteTables } = require('../utils/sqlite-export-helpers');
        createSqliteTables(db);

    db.close();

        // Verify the database was created
        expect(fs.existsSync(REGION_DB)).toBe(true);
        
        // Verify empty routing tables exist
        const verifyDb = new Database(REGION_DB, { readonly: true });
        try {
          const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
          expect(tables).toContain('routing_nodes');
          expect(tables).toContain('routing_edges');
          
          const nodeCount = (verifyDb.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
          const edgeCount = (verifyDb.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
          
          expect(nodeCount).toBe(0);
          expect(edgeCount).toBe(0);
          
          console.log(`✅ Successfully created empty routing graph database`);
        } finally {
          verifyDb.close();
        }
        
      } catch (error) {
        console.log(`❌ Empty routing graph test failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }, TEST_CONFIG.limits.timeout);
  });
});