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

// Test data - updated to match actual schema requirements
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
    geojson: '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-105.3,40.0,1400],[-105.2,40.1,1500]]}}',
    // Required bbox fields for validation
    bbox_min_lng: -105.3,
    bbox_max_lng: -105.2,
    bbox_min_lat: 40.0,
    bbox_max_lat: 40.1
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
      expect(columns).toContain('geojson');
      expect(columns).toContain('bbox_min_lng');
      expect(columns).toContain('bbox_max_lng');
      expect(columns).toContain('bbox_min_lat');
      expect(columns).toContain('bbox_max_lat');
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
      
      const trails = db.prepare('SELECT * FROM trails').all() as any[];
      expect(trails).toHaveLength(1);
      
      const trail = trails[0] as any;
      expect(trail.app_uuid).toBe('test-trail-1');
      expect(trail.name).toBe('Test Trail 1');
      expect(trail.length_km).toBe(1.5);
      expect(trail.elevation_gain).toBe(100);
    });

    test('insertRoutingNodes inserts node data correctly', () => {
      createSqliteTables(db);
      insertRoutingNodes(db, TEST_NODES);
      
      const nodes = db.prepare('SELECT * FROM routing_nodes').all() as any[];
      expect(nodes).toHaveLength(2);
      
      const node = nodes[0] as any;
      expect(node.lat).toBe(40.0);
      expect(node.lng).toBe(-105.3);
      expect(node.elevation).toBe(1400);
      expect(node.cnt).toBe(2);
    });

    test('insertRoutingEdges inserts edge data correctly', () => {
      createSqliteTables(db);
      insertRoutingEdges(db, TEST_EDGES);
      
      const edges = db.prepare('SELECT * FROM routing_edges').all() as any[];
      expect(edges).toHaveLength(1);
      
      const edge = edges[0] as any;
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
      
      const regions = db.prepare('SELECT * FROM region_metadata').all() as any[];
      expect(regions).toHaveLength(1);
      
      const region = regions[0] as any;
      expect(region.region_name).toBe('test-region');
      expect(region.trail_count).toBe(1);
    });

    test('insertSchemaVersion inserts schema version correctly', () => {
      createSqliteTables(db);
      insertSchemaVersion(db, 12, 'Carthorse SQLite Export v12.0');
      
      const versions = db.prepare('SELECT * FROM schema_version').all() as any[];
      expect(versions).toHaveLength(1);
      
      const version = versions[0] as any;
      expect(version.version).toBe(12);
      expect(version.description).toBe('Carthorse SQLite Export v12.0');
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
        source_tags: null,
        // Required bbox fields for validation
        bbox_min_lng: -105.3,
        bbox_max_lng: -105.2,
        bbox_min_lat: 40.0,
        bbox_max_lat: 40.1
      };
      
      expect(() => insertTrails(db, [trailWithNulls])).not.toThrow();
      
      const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      expect(trail.trail_type).toBeNull();
      expect(trail.surface).toBeNull();
      expect(trail.difficulty).toBeNull();
      expect(trail.source_tags).toBeNull();
    });
  });

  it('should preserve 3D coordinates in GeoJSON export', () => {
    const db = new Database(':memory:');
    createSqliteTables(db);

    // Insert a trail with 3D coordinates (elevation data)
    const trailWithElevation = {
      app_uuid: 'test-3d-trail',
      name: 'Test 3D Trail',
      geojson: JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-105.2705, 40.0150, 1650], // 3D coordinates with elevation
            [-105.2706, 40.0151, 1655],
            [-105.2707, 40.0152, 1660]
          ]
        },
        properties: {}
      }),
      bbox_min_lng: -105.2707,
      bbox_max_lng: -105.2705,
      bbox_min_lat: 40.0150,
      bbox_max_lat: 40.0152,
      length_km: 0.1,
      elevation_gain: 10,
      elevation_loss: 5,
      max_elevation: 1660,
      min_elevation: 1650,
      avg_elevation: 1655
    };

    insertTrails(db, [trailWithElevation]);

    // Verify that the 3D coordinates are preserved
    const savedTrail = db.prepare('SELECT geojson FROM trails WHERE app_uuid = ?').get('test-3d-trail') as any;
    expect(savedTrail).toBeDefined();
    
    const geojson = JSON.parse(savedTrail.geojson);
    expect(geojson.geometry.coordinates).toHaveLength(3);
    
    // Check that all coordinates have 3D values (not zeroed out)
    geojson.geometry.coordinates.forEach((coord: number[], index: number) => {
      expect(coord).toHaveLength(3);
      expect(coord[2]).toBeGreaterThan(0); // Elevation should be preserved
      expect(coord[2]).toBe(1650 + index * 5); // Should match our test data
    });

    db.close();
  });
}); 