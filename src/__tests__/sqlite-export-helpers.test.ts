import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  createSqliteTables,
  insertTrails,
  insertRoutingNodes,
  insertRoutingEdges,
  insertRegionMetadata,
  buildRegionMeta,
  insertSchemaVersion
} from '../utils/sqlite-export-helpers';

// Test configuration
const TEST_DB_PATH = path.resolve(__dirname, '../../data/test-sqlite-helpers.db');

// Sample test data
const sampleTrails = [
  {
    id: 1,
    app_uuid: 'test-trail-1',
    osm_id: 12345,
    name: 'Test Trail 1',
    source: 'osm',
    trail_type: 'hiking',
    surface: 'dirt',
    difficulty: 'easy',
    coordinates: '[[-105.3,40.0,1500],[-105.2,40.1,1600]]',
    geojson: '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-105.3,40.0,1500],[-105.2,40.1,1600]]}}',
    bbox: '[-105.3,40.0,-105.2,40.1]',
    source_tags: '{"highway":"path"}',
    bbox_min_lng: -105.3,
    bbox_max_lng: -105.2,
    bbox_min_lat: 40.0,
    bbox_max_lat: 40.1,
    length_km: 1.5,
    elevation_gain: 100,
    elevation_loss: 50,
    max_elevation: 1600,
    min_elevation: 1500,
    avg_elevation: 1550,
    geometry_wkt: 'LINESTRING Z (-105.3 40.0 1500, -105.2 40.1 1600)',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

const sampleNodes = [
  {
    id: 1,
    coordinate_wkt: 'POINT Z (-105.3 40.0 1500)',
    node_type: 'endpoint',
    connected_trails: '[1]',
    elevation: 1500,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 2,
    coordinate_wkt: 'POINT Z (-105.2 40.1 1600)',
    node_type: 'endpoint',
    connected_trails: '[1]',
    elevation: 1600,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

const sampleEdges = [
  {
    id: 1,
    from_node_id: 1,
    to_node_id: 2,
    trail_id: 1,
    geometry_wkt: 'LINESTRING Z (-105.3 40.0 1500, -105.2 40.1 1600)',
    distance_km: 1.5,
    elevation_gain: 100,
    elevation_loss: 50,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

const sampleConfig = {
  region: 'boulder',
  outputPath: TEST_DB_PATH,
  simplifyTolerance: 0.001,
  intersectionTolerance: 2,
  replace: true,
  validate: false,
  verbose: false,
  skipBackup: true,
  buildMaster: false,
  targetSizeMB: null,
  maxSpatiaLiteDbSizeMB: 100,
  skipIncompleteTrails: true,
  bbox: [-105.3, 40.0, -105.2, 40.1]
};

const sampleBbox = [-105.3, 40.0, -105.2, 40.1];

describe('SQLite Export Helpers Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Create new database
    db = new Database(TEST_DB_PATH);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('Table Creation', () => {
    test('createSqliteTables creates all required tables', () => {
      createSqliteTables(db);

      // Check that all tables exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .map((row: any) => row.name);

      expect(tables).toContain('trails');
      expect(tables).toContain('routing_nodes');
      expect(tables).toContain('routing_edges');
      expect(tables).toContain('region_metadata');
      expect(tables).toContain('schema_version');
    });

    test('trails table has correct schema', () => {
      createSqliteTables(db);

      const columns = db.prepare("PRAGMA table_info(trails)").all();
      const columnNames = columns.map((col: any) => col.name);

      // Check required columns
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('app_uuid');
      expect(columnNames).toContain('osm_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('geometry_wkt');
      expect(columnNames).toContain('elevation_gain');
      expect(columnNames).toContain('elevation_loss');
      expect(columnNames).toContain('max_elevation');
      expect(columnNames).toContain('min_elevation');
      expect(columnNames).toContain('avg_elevation');

      // Check that geometry_wkt is TEXT type
      const geometryWktColumn = columns.find((col: any) => col.name === 'geometry_wkt');
      expect(geometryWktColumn?.type).toBe('TEXT');
    });

    test('routing_nodes table has correct schema', () => {
      createSqliteTables(db);

      const columns = db.prepare("PRAGMA table_info(routing_nodes)").all();
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('coordinate_wkt');
      expect(columnNames).toContain('node_type');
      expect(columnNames).toContain('connected_trails');
      expect(columnNames).toContain('elevation');

      // Check that coordinate_wkt is TEXT type
      const coordinateWktColumn = columns.find((col: any) => col.name === 'coordinate_wkt');
      expect(coordinateWktColumn?.type).toBe('TEXT');
    });

    test('routing_edges table has correct schema', () => {
      createSqliteTables(db);

      const columns = db.prepare("PRAGMA table_info(routing_edges)").all();
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('from_node_id');
      expect(columnNames).toContain('to_node_id');
      expect(columnNames).toContain('trail_id');
      expect(columnNames).toContain('geometry_wkt');
      expect(columnNames).toContain('distance_km');
      expect(columnNames).toContain('elevation_gain');
      expect(columnNames).toContain('elevation_loss');

      // Check that geometry_wkt is TEXT type
      const geometryWktColumn = columns.find((col: any) => col.name === 'geometry_wkt');
      expect(geometryWktColumn?.type).toBe('TEXT');
    });
  });

  describe('Data Insertion', () => {
    beforeEach(() => {
      createSqliteTables(db);
    });

    test('insertTrails inserts trail data correctly', () => {
      insertTrails(db, sampleTrails);

      const insertedTrails = db.prepare('SELECT * FROM trails').all();
      expect(insertedTrails).toHaveLength(1);

      const trail = insertedTrails[0];
      expect(trail.app_uuid).toBe('test-trail-1');
      expect(trail.name).toBe('Test Trail 1');
      expect(trail.geometry_wkt).toBe('LINESTRING Z (-105.3 40.0 1500, -105.2 40.1 1600)');
      expect(trail.elevation_gain).toBe(100);
      expect(trail.elevation_loss).toBe(50);
      expect(trail.max_elevation).toBe(1600);
      expect(trail.min_elevation).toBe(1500);
      expect(trail.avg_elevation).toBe(1550);
    });

    test('insertRoutingNodes inserts node data correctly', () => {
      insertRoutingNodes(db, sampleNodes);

      const insertedNodes = db.prepare('SELECT * FROM routing_nodes').all();
      expect(insertedNodes).toHaveLength(2);

      const node1 = insertedNodes.find((n: any) => n.id === 1);
      expect(node1?.coordinate_wkt).toBe('POINT Z (-105.3 40.0 1500)');
      expect(node1?.node_type).toBe('endpoint');
      expect(node1?.connected_trails).toBe('[1]');
      expect(node1?.elevation).toBe(1500);

      const node2 = insertedNodes.find((n: any) => n.id === 2);
      expect(node2?.coordinate_wkt).toBe('POINT Z (-105.2 40.1 1600)');
      expect(node2?.elevation).toBe(1600);
    });

    test('insertRoutingEdges inserts edge data correctly', () => {
      insertRoutingEdges(db, sampleEdges);

      const insertedEdges = db.prepare('SELECT * FROM routing_edges').all();
      expect(insertedEdges).toHaveLength(1);

      const edge = insertedEdges[0];
      expect(edge.from_node_id).toBe(1);
      expect(edge.to_node_id).toBe(2);
      expect(edge.trail_id).toBe(1);
      expect(edge.geometry_wkt).toBe('LINESTRING Z (-105.3 40.0 1500, -105.2 40.1 1600)');
      expect(edge.distance_km).toBe(1.5);
      expect(edge.elevation_gain).toBe(100);
      expect(edge.elevation_loss).toBe(50);
    });

    test('insertRegionMetadata inserts region metadata correctly', () => {
      const regionMeta = buildRegionMeta(sampleConfig, sampleBbox);
      insertRegionMetadata(db, regionMeta);

      const insertedMeta = db.prepare('SELECT * FROM region_metadata').get();
      expect(insertedMeta.region_key).toBe('boulder');
      expect(insertedMeta.bbox_min_lng).toBe(-105.3);
      expect(insertedMeta.bbox_max_lng).toBe(-105.2);
      expect(insertedMeta.bbox_min_lat).toBe(40.0);
      expect(insertedMeta.bbox_max_lat).toBe(40.1);
      expect(insertedMeta.simplify_tolerance).toBe(0.001);
      expect(insertedMeta.intersection_tolerance).toBe(2);
    });

    test('insertSchemaVersion inserts schema version correctly', () => {
      insertSchemaVersion(db, 1, 'Carthorse SQLite Export v1.0');

      const insertedVersion = db.prepare('SELECT * FROM schema_version').get();
      expect(insertedVersion.version).toBe(1);
      expect(insertedVersion.description).toBe('Carthorse SQLite Export v1.0');
      expect(insertedVersion.created_at).toBeDefined();
    });
  });

  describe('Data Validation', () => {
    beforeEach(() => {
      createSqliteTables(db);
    });

    test('WKT geometry data is preserved correctly', () => {
      insertTrails(db, sampleTrails);
      insertRoutingNodes(db, sampleNodes);
      insertRoutingEdges(db, sampleEdges);

      // Check trail geometry
      const trail = db.prepare('SELECT geometry_wkt FROM trails WHERE id = 1').get();
      expect(trail.geometry_wkt).toMatch(/^LINESTRING Z/);
      expect(trail.geometry_wkt).toContain('-105.3 40.0 1500');
      expect(trail.geometry_wkt).toContain('-105.2 40.1 1600');

      // Check node geometry
      const node = db.prepare('SELECT coordinate_wkt FROM routing_nodes WHERE id = 1').get();
      expect(node.coordinate_wkt).toMatch(/^POINT Z/);
      expect(node.coordinate_wkt).toContain('-105.3 40.0 1500');

      // Check edge geometry
      const edge = db.prepare('SELECT geometry_wkt FROM routing_edges WHERE id = 1').get();
      expect(edge.geometry_wkt).toMatch(/^LINESTRING Z/);
    });

    test('Elevation data is preserved correctly', () => {
      insertTrails(db, sampleTrails);
      insertRoutingNodes(db, sampleNodes);

      // Check trail elevation data
      const trail = db.prepare('SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails WHERE id = 1').get();
      expect(trail.elevation_gain).toBe(100);
      expect(trail.elevation_loss).toBe(50);
      expect(trail.max_elevation).toBe(1600);
      expect(trail.min_elevation).toBe(1500);
      expect(trail.avg_elevation).toBe(1550);

      // Check node elevation data
      const node = db.prepare('SELECT elevation FROM routing_nodes WHERE id = 1').get();
      expect(node.elevation).toBe(1500);
    });

    test('JSON data is preserved correctly', () => {
      insertTrails(db, sampleTrails);

      const trail = db.prepare('SELECT coordinates, geojson, bbox, source_tags FROM trails WHERE id = 1').get();
      expect(trail.coordinates).toBe('[[-105.3,40.0,1500],[-105.2,40.1,1600]]');
      expect(trail.geojson).toContain('"type":"Feature"');
      expect(trail.bbox).toBe('[-105.3,40.0,-105.2,40.1]');
      expect(trail.source_tags).toBe('{"highway":"path"}');
    });
  });

  describe('Error Handling', () => {
    test('handles empty data arrays gracefully', () => {
      createSqliteTables(db);

      // Should not throw errors with empty arrays
      expect(() => insertTrails(db, [])).not.toThrow();
      expect(() => insertRoutingNodes(db, [])).not.toThrow();
      expect(() => insertRoutingEdges(db, [])).not.toThrow();

      // Tables should exist but be empty
      const trailCount = db.prepare('SELECT COUNT(*) as count FROM trails').get().count;
      const nodeCount = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count;
      const edgeCount = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count;

      expect(trailCount).toBe(0);
      expect(nodeCount).toBe(0);
      expect(edgeCount).toBe(0);
    });

    test('handles null values in data', () => {
      createSqliteTables(db);

      const trailWithNulls = {
        ...sampleTrails[0],
        elevation_gain: null,
        elevation_loss: null,
        max_elevation: null,
        min_elevation: null,
        avg_elevation: null
      };

      expect(() => insertTrails(db, [trailWithNulls])).not.toThrow();

      const trail = db.prepare('SELECT elevation_gain, elevation_loss FROM trails WHERE id = 1').get();
      expect(trail.elevation_gain).toBeNull();
      expect(trail.elevation_loss).toBeNull();
    });
  });

  describe('buildRegionMeta', () => {
    test('builds region metadata correctly', () => {
      const regionMeta = buildRegionMeta(sampleConfig, sampleBbox);

      expect(regionMeta.region_key).toBe('boulder');
      expect(regionMeta.bbox_min_lng).toBe(-105.3);
      expect(regionMeta.bbox_max_lng).toBe(-105.2);
      expect(regionMeta.bbox_min_lat).toBe(40.0);
      expect(regionMeta.bbox_max_lat).toBe(40.1);
      expect(regionMeta.simplify_tolerance).toBe(0.001);
      expect(regionMeta.intersection_tolerance).toBe(2);
      expect(regionMeta.created_at).toBeDefined();
    });

    test('handles different bbox formats', () => {
      const customBbox = [-122.0, 47.0, -121.0, 48.0];
      const regionMeta = buildRegionMeta(sampleConfig, customBbox);

      expect(regionMeta.bbox_min_lng).toBe(-122.0);
      expect(regionMeta.bbox_max_lng).toBe(-121.0);
      expect(regionMeta.bbox_min_lat).toBe(47.0);
      expect(regionMeta.bbox_max_lat).toBe(48.0);
    });
  });
}); 