import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createSqliteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRegionMetadata, insertSchemaVersion } from '../../utils/sqlite-export-helpers';

// Test configuration
const TEST_OUTPUT_DIR = path.join(__dirname, '../test-output');
const TEST_DB_PATH = path.join(TEST_OUTPUT_DIR, 'test-sqlite-helpers.db');

// Ensure test output directory exists
if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

// Test data
const TEST_TRAILS = [
  {
    id: 1,
    app_uuid: 'test-trail-1',
    name: 'Test Trail 1',
    trail_type: 'hiking',
    surface: 'dirt',
    difficulty: 'easy',
    length_km: 1.5,
    elevation_gain: 100,
    elevation_loss: 50,
    max_elevation: 1500,
    min_elevation: 1400,
    avg_elevation: 1450,
    source: 'test',
    geometry: 'LINESTRING Z(-105.3 40.0 1400, -105.2 40.1 1500)',
    geojson: '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-105.3,40.0,1400],[-105.2,40.1,1500]]}}'
  }
];

const TEST_NODES = [
  {
    id: 1,
    lat: 40.0,
    lng: -105.3,
    elevation: 1400,
    cnt: 2
  },
  {
    id: 2,
    lat: 40.1,
    lng: -105.2,
    elevation: 1500,
    cnt: 2
  }
];

const TEST_EDGES = [
  {
    source: 1,
    target: 2,
    trail_id: 'test-trail-1',
    trail_name: 'Test Trail 1',
    distance_km: 1.5,
    geojson: '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-105.3,40.0,1400],[-105.2,40.1,1500]]}}'
  }
];

describe('SQLite Export Helpers Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Clean up any existing test file
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    
    // Create fresh database in writable mode
    db = new Database(TEST_DB_PATH, { readonly: false });
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch (error) {
        // Ignore close errors
      }
    }
    
    // Clean up test file
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (error) {
        // Ignore unlink errors
      }
    }
  });

  describe('Table Creation', () => {
    test('createSqliteTables creates all required tables', () => {
      createSqliteTables(db);
      
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
      
      expect(tables).toContain('trails');
      expect(tables).toContain('routing_nodes');
      expect(tables).toContain('routing_edges');
      expect(tables).toContain('region_metadata');
      expect(tables).toContain('schema_version');
    });

    test('trails table has correct schema', () => {
      createSqliteTables(db);
      
      const columns = db.prepare("PRAGMA table_info(trails)").all().map((row: any) => row.name);
      
      expect(columns).toContain('id');
      expect(columns).toContain('app_uuid');
      expect(columns).toContain('name');
      expect(columns).toContain('trail_type');
      expect(columns).toContain('surface');
      expect(columns).toContain('difficulty');
      expect(columns).toContain('length_km');
      expect(columns).toContain('elevation_gain');
      expect(columns).toContain('elevation_loss');
      expect(columns).toContain('max_elevation');
      expect(columns).toContain('min_elevation');
      expect(columns).toContain('avg_elevation');
      expect(columns).toContain('source');
      expect(columns).toContain('geometry');
      expect(columns).toContain('geojson');
    });

    test('routing_nodes table has correct schema', () => {
      createSqliteTables(db);
      
      const columns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
      
      expect(columns).toContain('id');
      expect(columns).toContain('lat');
      expect(columns).toContain('lng');
      expect(columns).toContain('elevation');
      expect(columns).toContain('cnt');
    });

    test('routing_edges table has correct schema', () => {
      createSqliteTables(db);
      
      const columns = db.prepare("PRAGMA table_info(routing_edges)").all().map((row: any) => row.name);
      
      expect(columns).toContain('id');
      expect(columns).toContain('source');
      expect(columns).toContain('target');
      expect(columns).toContain('trail_id');
      expect(columns).toContain('trail_name');
      expect(columns).toContain('distance_km');
      expect(columns).toContain('geojson');
    });
  });

  describe('Data Insertion', () => {
    test('insertTrails inserts trail data correctly', () => {
      createSqliteTables(db);
      insertTrails(db, TEST_TRAILS);
      
      const trails = db.prepare('SELECT * FROM trails').all();
      expect(trails).toHaveLength(1);
      
      const trail = trails[0];
      expect(trail.app_uuid).toBe('test-trail-1');
      expect(trail.name).toBe('Test Trail 1');
      expect(trail.length_km).toBe(1.5);
      expect(trail.elevation_gain).toBe(100);
    });

    test('insertRoutingNodes inserts node data correctly', () => {
      createSqliteTables(db);
      insertRoutingNodes(db, TEST_NODES);
      
      const nodes = db.prepare('SELECT * FROM routing_nodes').all();
      expect(nodes).toHaveLength(2);
      
      const node = nodes[0];
      expect(node.lat).toBe(40.0);
      expect(node.lng).toBe(-105.3);
      expect(node.elevation).toBe(1400);
      expect(node.cnt).toBe(2);
    });

    test('insertRoutingEdges inserts edge data correctly', () => {
      createSqliteTables(db);
      insertRoutingEdges(db, TEST_EDGES);
      
      const edges = db.prepare('SELECT * FROM routing_edges').all();
      expect(edges).toHaveLength(1);
      
      const edge = edges[0];
      expect(edge.source).toBe(1);
      expect(edge.target).toBe(2);
      expect(edge.trail_id).toBe('test-trail-1');
      expect(edge.distance_km).toBe(1.5);
    });

    test('insertRegionMetadata inserts region data correctly', () => {
      createSqliteTables(db);
      
      const regionData = {
        region_name: 'test-region',
        bbox_min_lng: -105.3,
        bbox_max_lng: -105.2,
        bbox_min_lat: 40.0,
        bbox_max_lat: 40.1,
        trail_count: 1
      };
      
      insertRegionMetadata(db, regionData);
      
      const regions = db.prepare('SELECT * FROM region_metadata').all();
      expect(regions).toHaveLength(1);
      
      const region = regions[0];
      expect(region.region_name).toBe('test-region');
      expect(region.trail_count).toBe(1);
    });

    test('insertSchemaVersion inserts schema version correctly', () => {
      createSqliteTables(db);
      insertSchemaVersion(db);
      
      const versions = db.prepare('SELECT * FROM schema_version').all();
      expect(versions).toHaveLength(1);
      
      const version = versions[0];
      expect(version.version).toBe(12);
      expect(version.description).toContain('pgRouting');
    });
  });

  describe('Data Validation', () => {
    test('GeoJSON data is preserved correctly', () => {
      createSqliteTables(db);
      insertTrails(db, TEST_TRAILS);
      
      const trail = db.prepare('SELECT geojson FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      expect(trail.geojson).toBeDefined();
      
      const geojson = JSON.parse(trail.geojson);
      expect(geojson.type).toBe('Feature');
      expect(geojson.geometry.type).toBe('LineString');
      expect(geojson.geometry.coordinates).toHaveLength(2);
    });

    test('Elevation data is preserved correctly', () => {
      createSqliteTables(db);
      insertTrails(db, TEST_TRAILS);
      
      const trail = db.prepare('SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      
      expect(trail.elevation_gain).toBe(100);
      expect(trail.elevation_loss).toBe(50);
      expect(trail.max_elevation).toBe(1500);
      expect(trail.min_elevation).toBe(1400);
      expect(trail.avg_elevation).toBe(1450);
    });

    test('JSON data is preserved correctly', () => {
      createSqliteTables(db);
      insertTrails(db, TEST_TRAILS);
      
      const trail = db.prepare('SELECT source_tags FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      // source_tags should be null for our test data, which is fine
      expect(trail.source_tags).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('handles empty data arrays gracefully', () => {
      createSqliteTables(db);
      
      // Should not throw errors with empty arrays
      expect(() => insertTrails(db, [])).not.toThrow();
      expect(() => insertRoutingNodes(db, [])).not.toThrow();
      expect(() => insertRoutingEdges(db, [])).not.toThrow();
      
      const trails = db.prepare('SELECT COUNT(*) as count FROM trails').get() as any;
      const nodes = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get() as any;
      const edges = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as any;
      
      expect(trails.count).toBe(0);
      expect(nodes.count).toBe(0);
      expect(edges.count).toBe(0);
    });

    test('handles null values in data', () => {
      createSqliteTables(db);
      
      const trailWithNulls = {
        ...TEST_TRAILS[0],
        trail_type: null,
        surface: null,
        difficulty: null,
        source_tags: null
      };
      
      expect(() => insertTrails(db, [trailWithNulls])).not.toThrow();
      
      const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      expect(trail.trail_type).toBeNull();
      expect(trail.surface).toBeNull();
      expect(trail.difficulty).toBeNull();
      expect(trail.source_tags).toBeNull();
    });
  });
}); 