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
} from '../../utils/sqlite-export-helpers';

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
    geometry: 'LINESTRING Z (-105.3 40.0 1500, -105.2 40.1 1600)',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

const sampleNodes = [
  {
    id: 1,
    geometry: 'POINT Z (-105.3 40.0 1500)',
    lat: 40.0,
    lng: -105.3,
    node_type: 'endpoint',
    connected_trails: '[1]',
    elevation: 1500,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 2,
    geometry: 'POINT Z (-105.2 40.1 1600)',
    lat: 40.1,
    lng: -105.2,
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
    trail_name: 'Test Trail 1',
    distance_km: 1.5,
    elevation_gain: 100,
    elevation_loss: 50,
    is_bidirectional: 1,
    geometry: 'LINESTRING(-105.3 40 1500, -105.2 40.1 1600)',
    from_lat: 40.0,
    from_lng: -105.3,
    to_lat: 40.1,
    to_lng: -105.2,
    created_at: new Date().toISOString()
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

const sampleBbox = {
  minLng: -105.3,
  maxLng: -105.2,
  minLat: 40.0,
  maxLat: 40.1,
  trailCount: 1
};

// Define types for test assertions
interface TestTrail {
  id: number;
  app_uuid: string;
  osm_id: number;
  name: string;
  source: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  coordinates: string;
  geojson: string;
  bbox: string;
  source_tags: string;
  bbox_min_lng: number;
  bbox_max_lng: number;
  bbox_min_lat: number;
  bbox_max_lat: number;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  geometry_wkt: string;
  created_at: string;
  updated_at: string;
}
interface TestNode {
  id: number;
  coordinate_wkt: string;
  node_type: string;
  connected_trails: string;
  elevation: number;
  created_at: string;
  updated_at: string;
}
interface TestEdge {
  id: number;
  from_node_id: number;
  to_node_id: number;
  trail_id: number;
  trail_name: string;
  distance_km: number;
  elevation_gain: number;
  elevation_loss: number;
  is_bidirectional: number;
  geometry_wkt: string;
  created_at: string;
}
interface TestRegionMeta {
  id: number;
  region_name: string;
  bbox_min_lng: number;
  bbox_max_lng: number;
  bbox_min_lat: number;
  bbox_max_lat: number;
  trail_count: number;
  created_at: string;
}

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
      const geometryWktColumn = db.prepare("PRAGMA table_info(trails)").all().find((col: any) => col.name === 'geometry_wkt') as { type: string };
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
      const coordinateWktColumn = db.prepare("PRAGMA table_info(routing_nodes)").all().find((col: any) => col.name === 'coordinate_wkt') as { type: string };
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
      const geometryWktColumn2 = db.prepare("PRAGMA table_info(routing_edges)").all().find((col: any) => col.name === 'geometry_wkt') as { type: string };
      expect(geometryWktColumn2?.type).toBe('TEXT');
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

      const trail = insertedTrails[0] as TestTrail;
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

      const node1 = insertedNodes.find((n: any) => n.id === 1) as TestNode;
      expect(node1?.coordinate_wkt).toBe('POINT(-105.3 40 1500)');
      expect(node1?.node_type).toBe('endpoint');
      expect(node1?.connected_trails).toBe('[1]');
      expect(node1?.elevation).toBe(1500);

      const node2 = insertedNodes.find((n: any) => n.id === 2) as TestNode;
      expect(node2?.coordinate_wkt).toBe('POINT(-105.2 40.1 1600)');
      expect(node2?.elevation).toBe(1600);
    });

    test('insertRoutingEdges inserts edge data correctly', () => {
      insertRoutingEdges(db, sampleEdges);

      const insertedEdges = db.prepare('SELECT * FROM routing_edges').all();
      expect(insertedEdges).toHaveLength(1);

      const edge = insertedEdges[0] as TestEdge;
      expect(edge.from_node_id).toBe(1);
      expect(edge.to_node_id).toBe(2);
      expect(Number(edge.trail_id)).toBe(1);
      expect(edge.geometry_wkt).toBe('LINESTRING(-105.3 40 1500, -105.2 40.1 1600)');
      expect(edge.distance_km).toBe(1.5);
      expect(edge.elevation_gain).toBe(100);
      expect(edge.elevation_loss).toBe(50);
    });

    test('insertRegionMetadata inserts region metadata correctly', () => {
      const regionMeta = {
        region_name: 'boulder',
        bbox_min_lng: -105.3,
        bbox_max_lng: -105.2,
        bbox_min_lat: 40.0,
        bbox_max_lat: 40.1,
        trail_count: 1
      };
      insertRegionMetadata(db, regionMeta);

      const insertedMeta = db.prepare('SELECT * FROM region_metadata').get() as TestRegionMeta;
      expect(insertedMeta.region_name).toBe('boulder');
      expect(insertedMeta.bbox_min_lng).toBe(-105.3);
      expect(insertedMeta.bbox_max_lng).toBe(-105.2);
      expect(insertedMeta.bbox_min_lat).toBe(40.0);
      expect(insertedMeta.bbox_max_lat).toBe(40.1);
      expect(insertedMeta.trail_count).toBeGreaterThan(0);
    });

    test('insertSchemaVersion inserts schema version correctly', () => {
      insertSchemaVersion(db, 1, 'Carthorse SQLite Export v1.0');

      const insertedVersion = db.prepare('SELECT * FROM schema_version').get() as { version: number; description: string; created_at: string };
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
      const trailLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
      const trail = db.prepare(`SELECT geometry_wkt FROM trails WHERE id = 1 ${trailLimit}`).get() as TestTrail;
      expect(trail.geometry_wkt).toMatch(/^LINESTRING Z/);
      expect(trail.geometry_wkt).toContain('-105.3 40.0 1500');
      expect(trail.geometry_wkt).toContain('-105.2 40.1 1600');

      // Check node geometry
      const nodeLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
      const node = db.prepare(`SELECT coordinate_wkt FROM routing_nodes WHERE id = 1 ${nodeLimit}`).get() as TestNode;
      expect(node.coordinate_wkt).toMatch(/^POINT/);
      expect(node.coordinate_wkt).toContain('-105.3 40 1500');

      // Check edge geometry
      const edgeLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
      const edge = db.prepare(`SELECT geometry_wkt FROM routing_edges WHERE id = 1 ${edgeLimit}`).get() as TestEdge;
      expect(edge.geometry_wkt).toBe('LINESTRING(-105.3 40 1500, -105.2 40.1 1600)');
    });

    test('Elevation data is preserved correctly', () => {
      insertTrails(db, sampleTrails);
      insertRoutingNodes(db, sampleNodes);

      // Check trail elevation data
      const trail = db.prepare('SELECT elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails WHERE id = 1').get() as TestTrail;
      expect(trail.elevation_gain).toBe(100);
      expect(trail.elevation_loss).toBe(50);
      expect(trail.max_elevation).toBe(1600);
      expect(trail.min_elevation).toBe(1500);
      expect(trail.avg_elevation).toBe(1550);

      // Check node elevation data
      const node = db.prepare('SELECT elevation FROM routing_nodes WHERE id = 1').get() as TestNode;
      expect(node.elevation).toBe(1500);
    });

    test('JSON data is preserved correctly', () => {
      insertTrails(db, sampleTrails);

      const trail = db.prepare('SELECT coordinates, geojson, bbox, source_tags FROM trails WHERE id = 1').get() as TestTrail;
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
      const trailCount = db.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number };
      const nodeCount = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get() as { count: number };
      const edgeCount = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as { count: number };

      expect(trailCount.count).toBe(0);
      expect(nodeCount.count).toBe(0);
      expect(edgeCount.count).toBe(0);
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

      const trail = db.prepare('SELECT elevation_gain, elevation_loss FROM trails WHERE id = 1').get() as TestTrail;
      expect(trail.elevation_gain).toBe(0);
      expect(trail.elevation_loss).toBe(0);
    });
  });

  describe('buildRegionMeta', () => {
    test('builds region metadata correctly', () => {
      const regionMeta = buildRegionMeta(sampleConfig, sampleBbox);

      expect(regionMeta.bbox_min_lng).toBe(-105.3);
      expect(regionMeta.bbox_max_lng).toBe(-105.2);
      expect(regionMeta.bbox_min_lat).toBe(40.0);
      expect(regionMeta.bbox_max_lat).toBe(40.1);
      expect(regionMeta.trail_count).toBeGreaterThan(0);
    });

    test('handles different bbox formats', () => {
      const customBbox = {
        minLng: -122.0,
        maxLng: -121.0,
        minLat: 47.0,
        maxLat: 48.0,
        trailCount: 1
      };
      const regionMeta = buildRegionMeta(sampleConfig, customBbox);

      expect(regionMeta.bbox_min_lng).toBe(-122.0);
      expect(regionMeta.bbox_max_lng).toBe(-121.0);
      expect(regionMeta.bbox_min_lat).toBe(47.0);
      expect(regionMeta.bbox_max_lat).toBe(48.0);
    });
  });
}); 