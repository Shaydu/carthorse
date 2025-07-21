import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Test config for Boulder
const BOULDER_REGION = 'boulder';
const BOULDER_OUTPUT_PATH = path.resolve(__dirname, '../../data/boulder-export.db');

// Test config for Seattle
const SEATTLE_REGION = 'seattle';
const SEATTLE_OUTPUT_PATH = path.resolve(__dirname, '../../data/seattle-export.db');

// Utility to clean up test DBs
function cleanupTestDbs() {
  if (fs.existsSync(BOULDER_OUTPUT_PATH)) fs.unlinkSync(BOULDER_OUTPUT_PATH);
  if (fs.existsSync(SEATTLE_OUTPUT_PATH)) fs.unlinkSync(SEATTLE_OUTPUT_PATH);
}

// Ensure output directories exist before any file write
if (!fs.existsSync(path.dirname(BOULDER_OUTPUT_PATH))) {
  fs.mkdirSync(path.dirname(BOULDER_OUTPUT_PATH), { recursive: true });
}
if (!fs.existsSync(path.dirname(SEATTLE_OUTPUT_PATH))) {
  fs.mkdirSync(path.dirname(SEATTLE_OUTPUT_PATH), { recursive: true });
}

// NOTE: The test database should be accessible with a valid PostgreSQL user.
// Please ensure a PostgreSQL user exists and has access to the test database.
// This is documented in the project README.
describe('Routing Graph Export Pipeline', () => {
  beforeAll(() => {
    cleanupTestDbs();
  });

  afterAll(() => {
    cleanupTestDbs();
  });

  test('orchestrator exports routing_nodes and routing_edges with correct schema and data for boulder', async () => {
    // Arrange: create orchestrator with boulder config
    const orchestrator = new EnhancedPostgresOrchestrator({
      region: BOULDER_REGION,
      outputPath: BOULDER_OUTPUT_PATH,
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
      // Use a bbox that contains Boulder trails (based on actual data)
      bbox: [-105.8, 39.7, -105.1, 40.7],
    });

    // Act: run the pipeline
    await orchestrator.run();

    // Assert: open the exported SpatiaLite DB and check tables
    const db = new Database(BOULDER_OUTPUT_PATH, { readonly: true });
    // Load SpatiaLite extension for spatial functions (adjust path as needed for your OS)
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('routing_edges');
    expect(tables).toContain('trails');
    expect(tables).toContain('regions');

    // Check that routing nodes are present
    const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
    expect(nodeCount).toBeGreaterThan(0);
    console.log(`✅ Found ${nodeCount} routing nodes in exported database`);
    
    // Check that routing edges are present
    const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
    expect(edgeCount).toBeGreaterThan(0);
    console.log(`✅ Found ${edgeCount} routing edges in exported database`);
    
    // Sample routing data to verify structure
    const nodeSample = db.prepare('SELECT * FROM routing_nodes LIMIT 1').get() as any;
    expect(nodeSample).toBeDefined();
    expect(nodeSample.lat).toBeDefined();
    expect(nodeSample.lng).toBeDefined();
    expect(nodeSample.node_type).toBeDefined();
    
    const edgeSample = db.prepare('SELECT * FROM routing_edges LIMIT 1').get() as any;
    expect(edgeSample).toBeDefined();
    expect(edgeSample.from_node_id).toBeDefined();
    expect(edgeSample.to_node_id).toBeDefined();
    expect(edgeSample.trail_id).toBeDefined();
    expect(edgeSample.distance_km).toBeDefined();

    // Check that trails are present and have correct geometry and elevation fields
    const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
    expect(trailCount).toBeGreaterThan(0);
    // Use AsText(geometry) to get WKT for validation
    const trailSample = db.prepare('SELECT *, AsText(geometry) as geometry_wkt FROM trails LIMIT 1').get() as any;
    expect(trailSample).toBeDefined();
    expect(trailSample.geometry).toBeDefined();
    expect(typeof trailSample.geometry).toBe('object'); // geometry is binary (Buffer)
    expect(typeof trailSample.geometry_wkt).toBe('string');
    expect(trailSample.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
    expect(trailSample.elevation_gain).not.toBeNull();
    expect(trailSample.elevation_loss).not.toBeNull();
    expect(trailSample.max_elevation).not.toBeNull();
    expect(trailSample.min_elevation).not.toBeNull();
    expect(trailSample.avg_elevation).not.toBeNull();

    // Strict row-by-row validation for all trails
    const allTrails = db.prepare('SELECT *, AsText(geometry) as geometry_wkt FROM trails').all();
    expect(allTrails.length).toBeGreaterThan(0);
    for (const trail of allTrails as any[]) {
      // Elevation fields must be non-null (may be zero for flat or incomplete-data trails)
      expect(trail.elevation_gain).not.toBeNull();
      expect(trail.elevation_loss).not.toBeNull();
      expect(trail.max_elevation).not.toBeNull();
      expect(trail.min_elevation).not.toBeNull();
      expect(trail.avg_elevation).not.toBeNull();
      // Geometry must be present and valid
      expect(trail.geometry).toBeDefined();
      expect(typeof trail.geometry).toBe('object'); // geometry is binary (Buffer)
      expect(trail.geometry.length).toBeGreaterThan(10);
      expect(typeof trail.geometry_wkt).toBe('string');
      expect(trail.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
      // Required fields must be present and non-empty
      expect(trail.name).toBeDefined();
      expect(trail.name).not.toBe('');
      expect(trail.app_uuid).toBeDefined();
      expect(trail.app_uuid).not.toBe('');
      expect(trail.trail_type).toBeDefined();
      expect(trail.trail_type).not.toBe('');
      // Bbox coordinates must be present and valid
      expect(trail.bbox_min_lng).not.toBeNull();
      expect(trail.bbox_max_lng).not.toBeNull();
      expect(trail.bbox_min_lat).not.toBeNull();
      expect(trail.bbox_max_lat).not.toBeNull();
      expect(trail.bbox_min_lng).toBeLessThan(trail.bbox_max_lng);
      expect(trail.bbox_min_lat).toBeLessThan(trail.bbox_max_lat);
    }

    // Check that regions table exists and has at least one row with metadata
    const regionCount = (db.prepare('SELECT COUNT(*) as n FROM regions').get() as { n: number }).n;
    expect(regionCount).toBeGreaterThan(0);
    const regionSample = db.prepare('SELECT * FROM regions LIMIT 1').get() as any;
    expect(regionSample).toBeDefined();
    expect(regionSample.bbox).toBeDefined();
    expect(regionSample.metadata).toBeDefined();

    // Optionally, check schema fields
    const nodeColumns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
    expect(nodeColumns).toEqual(expect.arrayContaining(['id', 'node_uuid', 'lat', 'lng', 'elevation', 'node_type', 'connected_trails']));
    const edgeColumns = db.prepare("PRAGMA table_info(routing_edges)").all().map((row: any) => row.name);
    expect(edgeColumns).toEqual(expect.arrayContaining(['id', 'from_node_id', 'to_node_id', 'trail_id', 'trail_name', 'distance_km', 'elevation_gain']));
    const trailColumns = db.prepare("PRAGMA table_info(trails)").all().map((row: any) => row.name);
    expect(trailColumns).toEqual(expect.arrayContaining([
      'id', 'app_uuid', 'osm_id', 'name', 'trail_type', 'surface', 'difficulty', 'source_tags',
      'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat', 'length_km',
      'elevation_gain', 'elevation_loss', 'max_elevation', 'min_elevation', 'avg_elevation', 'geometry',
      'created_at', 'updated_at'
    ]));
    const regionColumns = db.prepare("PRAGMA table_info(regions)").all().map((row: any) => row.name);
    expect(regionColumns).toEqual(expect.arrayContaining([
      'id', 'name', 'description', 'bbox', 'initial_view_bbox', 'center', 'metadata'
    ]));

    db.close();
  }, 60000);

  test('orchestrator exports routing_nodes and routing_edges with correct schema and data for seattle', async () => {
    // Arrange: create orchestrator with seattle config
    const orchestrator = new EnhancedPostgresOrchestrator({
      region: SEATTLE_REGION,
      outputPath: SEATTLE_OUTPUT_PATH,
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
      // Updated bbox to match actual Seattle trails in DB (queried 2024-06-13)
      bbox: [-122.19, 47.32, -121.78, 47.74],
    });

    // Act: run the pipeline
    await orchestrator.run();

    // Assert: open the exported SpatiaLite DB and check tables
    const db = new Database(SEATTLE_OUTPUT_PATH, { readonly: true });
    // Load SpatiaLite extension for spatial functions (adjust path as needed for your OS)
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('routing_edges');
    expect(tables).toContain('trails');
    expect(tables).toContain('regions');

    // Check that routing nodes are present
    const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
    expect(nodeCount).toBeGreaterThan(0);
    console.log(`✅ Found ${nodeCount} routing nodes in exported database`);
    
    // Check that routing edges are present
    const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
    expect(edgeCount).toBeGreaterThan(0);
    console.log(`✅ Found ${edgeCount} routing edges in exported database`);
    
    // Sample routing data to verify structure
    const nodeSample = db.prepare('SELECT * FROM routing_nodes LIMIT 1').get() as any;
    expect(nodeSample).toBeDefined();
    expect(nodeSample.lat).toBeDefined();
    expect(nodeSample.lng).toBeDefined();
    expect(nodeSample.node_type).toBeDefined();
    
    const edgeSample = db.prepare('SELECT * FROM routing_edges LIMIT 1').get() as any;
    expect(edgeSample).toBeDefined();
    expect(edgeSample.from_node_id).toBeDefined();
    expect(edgeSample.to_node_id).toBeDefined();
    expect(edgeSample.trail_id).toBeDefined();
    expect(edgeSample.distance_km).toBeDefined();

    // Strict row-by-row validation for all trails
    const allTrails = db.prepare('SELECT *, AsText(geometry) as geometry_wkt FROM trails').all();
    expect(allTrails.length).toBeGreaterThan(0);
    for (const trail of allTrails as any[]) {
      // Elevation fields must be non-null (may be zero for flat or incomplete-data trails)
      expect(trail.elevation_gain).not.toBeNull();
      expect(trail.elevation_loss).not.toBeNull();
      expect(trail.max_elevation).not.toBeNull();
      expect(trail.min_elevation).not.toBeNull();
      expect(trail.avg_elevation).not.toBeNull();
      // Geometry must be present and valid
      expect(trail.geometry).toBeDefined();
      expect(typeof trail.geometry).toBe('object'); // geometry is binary (Buffer)
      expect(trail.geometry.length).toBeGreaterThan(10);
      expect(typeof trail.geometry_wkt).toBe('string');
      expect(trail.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
      // Required fields must be present and non-empty
      expect(trail.name).toBeDefined();
      expect(trail.name).not.toBe('');
      expect(trail.app_uuid).toBeDefined();
      expect(trail.app_uuid).not.toBe('');
      expect(trail.trail_type).toBeDefined();
      expect(trail.trail_type).not.toBe('');
      // Bbox coordinates must be present and valid
      expect(trail.bbox_min_lng).not.toBeNull();
      expect(trail.bbox_max_lng).not.toBeNull();
      expect(trail.bbox_min_lat).not.toBeNull();
      expect(trail.bbox_max_lat).not.toBeNull();
      expect(trail.bbox_min_lng).toBeLessThan(trail.bbox_max_lng);
      expect(trail.bbox_min_lat).toBeLessThan(trail.bbox_max_lat);
    }

    // Check that regions table exists and has at least one row with metadata
    const regionCount = (db.prepare('SELECT COUNT(*) as n FROM regions').get() as { n: number }).n;
    expect(regionCount).toBeGreaterThan(0);
    const regionSample = db.prepare('SELECT * FROM regions LIMIT 1').get() as any;
    expect(regionSample).toBeDefined();
    expect(regionSample.bbox).toBeDefined();
    expect(regionSample.metadata).toBeDefined();

    // Optionally, check schema fields
    const nodeColumns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
    expect(nodeColumns).toEqual(expect.arrayContaining(['id', 'node_uuid', 'lat', 'lng', 'elevation', 'node_type', 'connected_trails']));
    const edgeColumns = db.prepare("PRAGMA table_info(routing_edges)").all().map((row: any) => row.name);
    expect(edgeColumns).toEqual(expect.arrayContaining(['id', 'from_node_id', 'to_node_id', 'trail_id', 'trail_name', 'distance_km', 'elevation_gain']));
    const trailColumns = db.prepare("PRAGMA table_info(trails)").all().map((row: any) => row.name);
    expect(trailColumns).toEqual(expect.arrayContaining([
      'id', 'app_uuid', 'osm_id', 'name', 'trail_type', 'surface', 'difficulty', 'source_tags',
      'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat', 'length_km',
      'elevation_gain', 'elevation_loss', 'max_elevation', 'min_elevation', 'avg_elevation', 'geometry',
      'created_at', 'updated_at'
    ]));
    const regionColumns = db.prepare("PRAGMA table_info(regions)").all().map((row: any) => row.name);
    expect(regionColumns).toEqual(expect.arrayContaining([
      'id', 'name', 'description', 'bbox', 'initial_view_bbox', 'center', 'metadata'
    ]));

    db.close();
  }, 60000);


}); 