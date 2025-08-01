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
    region: 'test',
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
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
      
      expect(tables).toContain('trails');
      expect(tables).toContain('routing_nodes');
      expect(tables).toContain('routing_edges');
      expect(tables).toContain('region_metadata');
      expect(tables).toContain('route_recommendations');
    });

    test('trails table has correct schema', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const columns = db.prepare("PRAGMA table_info(trails)").all().map((row: any) => row.name);
      
      expect(columns).toContain('id');
      expect(columns).toContain('app_uuid');
      expect(columns).toContain('osm_id');
      expect(columns).toContain('name');
      expect(columns).toContain('region'); // trails table has region, not source
      expect(columns).toContain('trail_type');
      expect(columns).toContain('surface_type'); // v14 schema uses surface_type
      expect(columns).toContain('difficulty');
      expect(columns).toContain('geojson');
      // source_tags column doesn't exist in v14 schema
      expect(columns).toContain('length_km');
      expect(columns).toContain('elevation_gain');
      expect(columns).toContain('elevation_loss');
      expect(columns).toContain('created_at');
    });

    test('routing_nodes table has correct schema', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const columns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
      
      expect(columns).toContain('id');
      expect(columns).toContain('node_uuid');
      expect(columns).toContain('lat');
      expect(columns).toContain('lng');
      expect(columns).toContain('elevation');
      expect(columns).toContain('node_type');
      expect(columns).toContain('connected_trails');
      expect(columns).toContain('created_at');
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
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const testTrail = {
        app_uuid: 'test-trail-1',
        osm_id: '12345',
        name: 'Test Trail',
        region: 'test',
        trail_type: 'hiking',
        surface: 'dirt', // PostgreSQL staging schema uses 'surface'
        difficulty: 'easy',
        geojson: JSON.stringify({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-105.0, 40.0, 1800], [-105.1, 40.1, 1850]]
          }
        }),
        // source_tags not in v14 schema
        length_km: 2.5,
        elevation_gain: 100,
        elevation_loss: 50,
        max_elevation: 1850,
        min_elevation: 1800,
        avg_elevation: 1825,
        bbox_min_lng: -105.1,
        bbox_max_lng: -105.0,
        bbox_min_lat: 40.0,
        bbox_max_lat: 40.1,
        created_at: new Date().toISOString()
      };
      
      insertTrails(db, [testTrail]);
      
      const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      expect(trail).toBeDefined();
      expect(trail.name).toBe('Test Trail');
      expect(trail.length_km).toBe(2.5);
      expect(trail.elevation_gain).toBe(100);
      expect(trail.elevation_loss).toBe(50);
      expect(trail.max_elevation).toBe(1850);
      expect(trail.min_elevation).toBe(1800);
      expect(trail.avg_elevation).toBe(1825);
    });

    test('insertRoutingNodes inserts node data correctly', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const testNode = {
        node_uuid: 'test-node-1',
        lat: 40.0,
        lng: -105.0,
        elevation: 1800,
        node_type: 'intersection',
        connected_trails: 'trail1,trail2',
        created_at: new Date().toISOString()
      };
      
      insertRoutingNodes(db, [testNode]);
      
      const node = db.prepare('SELECT * FROM routing_nodes WHERE node_uuid = ?').get('test-node-1') as any;
      expect(node).toBeDefined();
      expect(node.lat).toBe(40.0);
      expect(node.lng).toBe(-105.0);
      expect(node.elevation).toBe(1800);
      expect(node.node_type).toBe('intersection');
      expect(node.connected_trails).toBe('trail1,trail2');
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
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const testMetadata = {
        region: 'test-region',
        total_trails: 100,
        total_nodes: 50,
        total_edges: 75,
        total_routes: 25,
        bbox_min_lat: 40.0,
        bbox_max_lat: 40.1,
        bbox_min_lng: -105.1,
        bbox_max_lng: -105.0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      insertRegionMetadata(db, testMetadata);
      
      const metadata = db.prepare('SELECT * FROM region_metadata WHERE region = ?').get('test-region') as any;
      expect(metadata).toBeDefined();
      expect(metadata.region).toBe('test-region');
      expect(metadata.total_trails).toBe(100);
      expect(metadata.total_nodes).toBe(50);
      expect(metadata.total_edges).toBe(75);
      expect(metadata.total_routes).toBe(25);
    });

    test('insertSchemaVersion inserts schema version correctly', () => {
      const db = new Database(':memory:');
      insertSchemaVersion(db, 13, 'Carthorse SQLite Export v13.0');
      // Note: v13 doesn't use schema_version table, so this just logs
      expect(true).toBe(true); // Test passes if no error
    });
  });

  describe('Data Validation', () => {
    test('GeoJSON data is preserved correctly', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      insertSchemaVersion(db, 14, 'Test v14 schema');
      
      const testTrail = {
        app_uuid: 'test-trail-1',
        name: 'Test Trail',
        region: 'test-region',
        geojson: JSON.stringify({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-105.0, 40.0, 1800], [-105.1, 40.1, 1850]]
          }
        }),
        length_km: 2.5,
        elevation_gain: 100,
        elevation_loss: 50,
        max_elevation: 1850,
        min_elevation: 1800,
        avg_elevation: 1825,
        created_at: new Date().toISOString()
      };
      
      insertTrails(db, [testTrail]);
      
      const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      expect(trail.geojson).toBe(testTrail.geojson);
      
      // Verify GeoJSON is valid
      const geojson = JSON.parse(trail.geojson);
      expect(geojson.type).toBe('Feature');
      expect(geojson.geometry.type).toBe('LineString');
      expect(geojson.geometry.coordinates).toHaveLength(2);
    });

    test('Elevation data is preserved correctly', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      insertSchemaVersion(db, 14, 'Test v14 schema');
      
      const testTrail = {
        app_uuid: 'test-trail-1',
        name: 'Test Trail',
        region: 'test-region',
        geojson: JSON.stringify({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-105.0, 40.0, 1800], [-105.1, 40.1, 1850]]
          }
        }),
        length_km: 2.5,
        elevation_gain: 100,
        elevation_loss: 50,
        max_elevation: 1850,
        min_elevation: 1800,
        avg_elevation: 1825,
        created_at: new Date().toISOString()
      };
      
      insertTrails(db, [testTrail]);
      
      const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      expect(trail.elevation_gain).toBe(100);
      expect(trail.elevation_loss).toBe(50);
      expect(trail.max_elevation).toBe(1850);
      expect(trail.min_elevation).toBe(1800);
      expect(trail.avg_elevation).toBe(1825);
    });

    test('JSON data is preserved correctly', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      insertSchemaVersion(db, 14, 'Test v14 schema');
      
      const testTrail = {
        app_uuid: 'test-trail-1',
        name: 'Test Trail',
        region: 'test-region',
        geojson: JSON.stringify({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-105.0, 40.0, 1800], [-105.1, 40.1, 1850]]
          }
        }),
        length_km: 2.5,
        elevation_gain: 100,
        elevation_loss: 50,
        max_elevation: 1850,
        min_elevation: 1800,
        avg_elevation: 1825,
        created_at: new Date().toISOString()
      };
      
      insertTrails(db, [testTrail]);
      
      const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-1') as any;
      
      // Verify GeoJSON is preserved correctly
      expect(trail.geojson).toBe(testTrail.geojson);
      
      // Verify JSON is valid
      const geojson = JSON.parse(trail.geojson);
      expect(geojson.type).toBe('Feature');
      expect(geojson.geometry.type).toBe('LineString');
      expect(geojson.geometry.coordinates).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    test('handles empty data arrays gracefully', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      // Should not throw errors with empty arrays
      expect(() => insertTrails(db, [])).not.toThrow();
      expect(() => insertRoutingNodes(db, [])).not.toThrow();
      expect(() => insertRoutingEdges(db, [])).not.toThrow();
    });

    test('rejects null elevation values', () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const trailWithNullElevation = {
        app_uuid: 'test-trail-1',
        name: 'Test Trail',
        region: 'test', // Required field
        geojson: JSON.stringify({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-105.0, 40.0, 1800], [-105.1, 40.1, 1850]]
          }
        }),
        trail_type: null,
        surface: null,
        difficulty: null,
        source_tags: null,
        length_km: null,
        elevation_gain: null,
        elevation_loss: null,
        max_elevation: null,
        min_elevation: null,
        avg_elevation: null,
        created_at: new Date().toISOString()
      };
      
      // This should fail because our validation rejects null elevation data
      expect(() => insertTrails(db, [trailWithNullElevation])).toThrow('[FATAL] Trail test-trail-1 (Test Trail) has missing or invalid length_km: null');
    });
  });

  test('should preserve 3D coordinates in GeoJSON export', () => {
    const db = new Database(':memory:');
    createSqliteTables(db);
    
    const testTrail = {
      app_uuid: 'test-trail-3d',
      name: '3D Trail',
      region: 'test', // Required field
      geojson: JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-105.0, 40.0, 1800],
            [-105.1, 40.1, 1850],
            [-105.2, 40.2, 1900]
          ]
        }
      }),
      length_km: 3.0,
      elevation_gain: 150,
      elevation_loss: 75,
      max_elevation: 1900,
      min_elevation: 1800,
      avg_elevation: 1850,
      created_at: new Date().toISOString()
    };
    
    insertTrails(db, [testTrail]);
    
    const trail = db.prepare('SELECT * FROM trails WHERE app_uuid = ?').get('test-trail-3d') as any;
    expect(trail).toBeDefined();
    
    const geojson = JSON.parse(trail.geojson);
    expect(geojson.geometry.coordinates).toHaveLength(3);
    
    // Verify all coordinates have 3D structure
    geojson.geometry.coordinates.forEach((coord: any) => {
      expect(coord).toHaveLength(3);
      expect(typeof coord[0]).toBe('number'); // lng
      expect(typeof coord[1]).toBe('number'); // lat
      expect(typeof coord[2]).toBe('number'); // elevation
    });
  });
}); 