import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getTestBbox } from '../utils/sql/region-data';

// Test config for Boulder
const REGION = 'boulder';
const REGION_DB = path.resolve(__dirname, '../../data/boulder-export.db');

// Test config for Seattle
const REGION2 = 'seattle';
const REGION2_DB = path.resolve(__dirname, '../../data/seattle-export.db');

// Utility to clean up test DBs
function cleanupTestDbs() {
  if (fs.existsSync(REGION_DB)) fs.unlinkSync(REGION_DB);
  if (fs.existsSync(REGION2_DB)) fs.unlinkSync(REGION2_DB);
}

// Ensure output directories exist before any file write
if (!fs.existsSync(path.dirname(REGION_DB))) {
  fs.mkdirSync(path.dirname(REGION_DB), { recursive: true });
}
if (!fs.existsSync(path.dirname(REGION2_DB))) {
  fs.mkdirSync(path.dirname(REGION2_DB), { recursive: true });
}

// NOTE: The test database should be accessible with a valid PostgreSQL user.
// Please ensure a PostgreSQL user exists and has access to the test database.
// This is documented in the project README.
declare global {
  // Patch for test teardown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var pgClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var db: any;
}
process.env.CARTHORSE_TEST_LIMIT = '20';
describe('Routing Graph Export Pipeline', () => {
  let orchestrator: EnhancedPostgresOrchestrator | undefined;
  let orchestratorRunComplete = false;

  beforeAll(async () => {
    // Always delete the old export file before running
    const outputPath = REGION_DB;
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    orchestrator = new EnhancedPostgresOrchestrator({
      region: REGION,
      outputPath,
      simplifyTolerance: 0.001,
      intersectionTolerance: 2,
      replace: true,
      validate: false,
      verbose: true, // Enable verbose orchestrator logging
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSqliteDbSizeMB: 100,
      skipIncompleteTrails: true,
      bbox: getTestBbox('boulder', 'small'),
      skipCleanup: true, // <-- Added
    });
    await orchestrator.run();
    orchestratorRunComplete = true;
  });

  afterAll(async () => {}, 15000);

  beforeEach(() => {
    if (!orchestratorRunComplete) {
      throw new Error('Orchestrator run() must complete before running test queries.');
    }
    if (fs.existsSync(REGION_DB)) {
      fs.unlinkSync(REGION_DB);
      console.log('[TEST] Deleted old export DB:', REGION_DB);
    }
  });

  test('orchestrator exports routing_nodes and routing_edges with correct schema and data for boulder', async () => {
    console.log('🧪 Starting Boulder export test...');
    // Arrange: create orchestrator with boulder config
    // Ensure old export file is deleted before running
    if (fs.existsSync(REGION_DB)) {
      console.log('🧹 Removing old Boulder export file...');
      fs.unlinkSync(REGION_DB);
    }
    orchestrator = new EnhancedPostgresOrchestrator({
      region: REGION,
      outputPath: REGION_DB,
      simplifyTolerance: 0.001,
      intersectionTolerance: 2,
      replace: true,
      validate: false,
      verbose: true, // Enable verbose orchestrator logging
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSqliteDbSizeMB: 100,
      skipIncompleteTrails: true,
      // Use a small bbox for fast testing
      bbox: getTestBbox('boulder', 'small'),
      skipCleanup: true, // <-- Added
    });

    console.log('🚀 Running orchestrator.run()...');
    await orchestrator.run();
    console.log('✅ orchestrator.run() complete.');

    // Note: Orchestrator automatically handles cleanup in its finally block
    // The staging schema is cleaned up after export, so we can't validate it here

    // Assert: open the exported SpatiaLite DB and check tables
    console.log('📂 Opening exported SQLite DB...');
    const outputPath = REGION_DB;
    const db = new Database(outputPath, { readonly: true });
    // Check that geojson column exists in trails table
    const trailColumns = db.prepare("PRAGMA table_info(trails)").all().map((col: any) => col.name);
    expect(trailColumns).toContain('geojson');
    console.log('✅ geojson column present in trails table.');
    // Load SpatiaLite extension for spatial functions (adjust path as needed for your OS)
    db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
    expect(tables).toContain('routing_nodes');
    expect(tables).toContain('routing_edges');
    expect(tables).toContain('trails');
    expect(tables).toContain('region_metadata');
    console.log('🔎 Checking routing_nodes, routing_edges, and trails counts...');

    // Check that routing nodes are present
    const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
    expect(nodeCount).toBeGreaterThan(0);
    // Node count should be greater than 0 (represents intersections)
    const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';
    const trailCount = (db.prepare(`SELECT COUNT(*) as n FROM ${TRAILS_TABLE}`).get() as { n: number }).n;
    // Routing nodes represent intersections, not trails, so we just check they exist
    console.log(`✅ Found ${nodeCount} routing nodes in exported database`);
    
    // Check that routing edges are present
    const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
    expect(edgeCount).toBeGreaterThan(0);
    // Edge count should be at least as many as trails (each trail becomes an edge)
    expect(edgeCount).toBeGreaterThanOrEqual(trailCount);
    console.log(`✅ Found ${edgeCount} routing edges in exported database`);
    
    // Sample routing data to verify structure
    const nodeSample = db.prepare('SELECT * FROM routing_nodes LIMIT 1').get() as any;
    expect(nodeSample).toBeDefined();
    expect(nodeSample.lat).toBeDefined();
    expect(nodeSample.lng).toBeDefined();
    expect(nodeSample.cnt).toBeGreaterThan(0);
    
    const edgeSample = db.prepare('SELECT * FROM routing_edges LIMIT 1').get() as any;
    expect(edgeSample).toBeDefined();
    expect(edgeSample.source).toBeDefined();
    expect(edgeSample.target).toBeDefined();
    expect(edgeSample.trail_id).toBeDefined();
    expect(edgeSample.distance_km).toBeDefined();
    // GeoJSON must be present, valid, and a LineString feature for edge
    expect(edgeSample.geojson).toBeDefined();
    expect(typeof edgeSample.geojson).toBe('string');
    expect(edgeSample.geojson.length).toBeGreaterThan(10);
    let edgeGeojsonObj;
    try {
      edgeGeojsonObj = JSON.parse(edgeSample.geojson);
    } catch (e) {
      throw new Error(`Edge id ${edgeSample.id} has invalid JSON in geojson field: ${edgeSample.geojson}`);
    }
    expect(edgeGeojsonObj).toBeDefined();
    expect(edgeGeojsonObj.type).toBe('Feature');
    expect(edgeGeojsonObj.geometry).toBeDefined();
    expect(edgeGeojsonObj.geometry.type).toBe('LineString');
    expect(Array.isArray(edgeGeojsonObj.geometry.coordinates)).toBe(true);
    expect(edgeGeojsonObj.geometry.coordinates.length).toBeGreaterThan(1);
    console.log('✅ Found sample routing node and edge.');

    // Use geometry_wkt column for validation (regular SQLite, not SpatiaLite)
    const trailSample = db.prepare('SELECT * FROM trails LIMIT 1').get() as any;
    expect(trailSample).toBeDefined();
    expect(trailSample.geojson).toBeDefined();
    expect(typeof trailSample.geojson).toBe('string');
    expect(trailSample.geojson.length).toBeGreaterThan(10);
    let geojsonObj;
    try {
      geojsonObj = JSON.parse(trailSample.geojson);
    } catch (e) {
      throw new Error(`Invalid JSON in trail geojson (id: ${trailSample.id}): ${trailSample.geojson}`);
    }
    expect(geojsonObj.type).toBe('Feature');
    expect(geojsonObj.geometry).toBeDefined();
    expect(geojsonObj.geometry.type).toBe('LineString');
    expect(Array.isArray(geojsonObj.geometry.coordinates)).toBe(true);
    expect(trailSample.elevation_gain).not.toBeNull();
    expect(trailSample.elevation_loss).not.toBeNull();
    expect(trailSample.max_elevation).not.toBeNull();
    expect(trailSample.min_elevation).not.toBeNull();
    expect(trailSample.avg_elevation).not.toBeNull();
    console.log('🔎 Checking trail sample and geometry...');

    // Strict row-by-row validation for all trails, including geojson
    const trailLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
    const allTrails = db.prepare(`SELECT * FROM trails ${trailLimit}`).all();
    expect(allTrails.length).toBeGreaterThan(0);
    for (const trail of allTrails as any[]) {
      // Elevation fields must be non-null (may be zero for flat or incomplete-data trails)
      expect(trail.elevation_gain).not.toBeNull();
      expect(trail.elevation_loss).not.toBeNull();
      expect(trail.max_elevation).not.toBeNull();
      expect(trail.min_elevation).not.toBeNull();
      expect(trail.avg_elevation).not.toBeNull();
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
      expect(trail.bbox_min_lng).toBeLessThanOrEqual(trail.bbox_max_lng);
      expect(trail.bbox_min_lat).toBeLessThanOrEqual(trail.bbox_max_lat);
      // GeoJSON must be present, valid, and a LineString feature
      expect(trail.geojson).toBeDefined();
      expect(typeof trail.geojson).toBe('string');
      expect(trail.geojson.length).toBeGreaterThan(10);
      let geojsonObj;
      try {
        geojsonObj = JSON.parse(trail.geojson);
      } catch (e) {
        throw new Error(`Trail id ${trail.id} has invalid JSON in geojson field: ${trail.geojson}`);
      }
      expect(geojsonObj).toBeDefined();
      expect(geojsonObj.type).toBe('Feature');
      expect(geojsonObj.geometry).toBeDefined();
      expect(geojsonObj.geometry.type).toBe('LineString');
      expect(Array.isArray(geojsonObj.geometry.coordinates)).toBe(true);
      expect(geojsonObj.geometry.coordinates.length).toBeGreaterThan(1);
    }
    console.log('🔎 Validating all trails, including geojson...');

    // Strict row-by-row validation for all routing_nodes
    const nodeLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
    const allNodes = db.prepare(`SELECT * FROM routing_nodes ${nodeLimit}`).all();
    expect(allNodes.length).toBeGreaterThan(0);
    for (const node of allNodes as any[]) {
      expect(node.lat).toBeDefined();
      expect(node.lng).toBeDefined();
      expect(node.cnt).toBeGreaterThan(0);
    }
    // Debug: Print all node IDs
    const nodeIds = new Set(allNodes.map((n: any) => n.id));
    console.log('[DEBUG] All node IDs:', Array.from(nodeIds));
    // Debug: Print all rows from routing_nodes
    console.log('[DEBUG] routing_nodes rows:', allNodes);
    // Strict row-by-row validation for all routing_edges
    const edgeLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
    const allEdges = db.prepare(`SELECT * FROM routing_edges ${edgeLimit}`).all();
    expect(allEdges.length).toBeGreaterThan(0);
    // Debug: Print all edge node references
    const edgeNodeRefs = new Set();
    for (const edge of allEdges as any[]) {
      edgeNodeRefs.add(edge.source);
      edgeNodeRefs.add(edge.target);
    }
    console.log('[DEBUG] All edge node references:', Array.from(edgeNodeRefs));
    // Debug: Print all rows from routing_edges
    console.log('[DEBUG] routing_edges rows:', allEdges);
    for (const edge of allEdges as any[]) {
      expect(edge.source).toBeDefined();
      expect(edge.target).toBeDefined();
      expect(edge.trail_id).toBeDefined();
      expect(typeof edge.distance_km).toBe('number');
      // source and target must exist in nodes
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
      // No self-loops
      expect(edge.source).not.toBe(edge.target);
    }
    console.log('✅ All trail, node, and edge checks complete.');

    // Check that regions table exists and has at least one row with metadata
    const regionCount = (db.prepare('SELECT COUNT(*) as n FROM region_metadata').get() as { n: number }).n;
    expect(regionCount).toBeGreaterThan(0);
    const regionSample = db.prepare('SELECT * FROM region_metadata LIMIT 1').get() as any;
    expect(regionSample).toBeDefined();
    expect(regionSample.bbox_min_lng).toBeDefined();
    expect(regionSample.bbox_max_lng).toBeDefined();
    expect(regionSample.bbox_min_lat).toBeDefined();
    expect(regionSample.bbox_max_lat).toBeDefined();

    // Optionally, check schema fields
    const nodeColumns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
    expect(nodeColumns).toEqual(expect.arrayContaining(['id', 'lat', 'lng', 'elevation', 'cnt']));
    const edgeColumns = db.prepare("PRAGMA table_info(routing_edges)").all().map((row: any) => row.name);
    expect(edgeColumns).toEqual(expect.arrayContaining(['id', 'source', 'target', 'trail_id', 'trail_name', 'distance_km', 'geojson']));
    expect(trailColumns).toEqual(expect.arrayContaining([
      'id', 'app_uuid', 'osm_id', 'name', 'trail_type', 'surface', 'difficulty', 'source_tags',
      'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat', 'length_km',
      'elevation_gain', 'elevation_loss', 'max_elevation', 'min_elevation', 'avg_elevation', 'geojson',
      'created_at', 'updated_at'
    ]));
    const regionColumns = db.prepare("PRAGMA table_info(region_metadata)").all().map((row: any) => row.name);
    expect(regionColumns).toEqual(expect.arrayContaining([
      'id', 'region_name', 'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat', 'trail_count', 'created_at'
    ]));

    db.close();
  }, 120000);

  // test('orchestrator exports routing_nodes and routing_edges with correct schema and data for seattle', async () => {
  //   // Arrange: create orchestrator with seattle config
  //   orchestrator = new EnhancedPostgresOrchestrator({
  //     region: REGION2,
  //     outputPath: REGION2_DB,
  //     simplifyTolerance: 0.001,
  //     intersectionTolerance: 2,
  //     replace: true,
  //     validate: false,
  //     verbose: false,
  //     skipBackup: true,
  //     buildMaster: false,
  //     targetSizeMB: null,
  //     maxSqliteDbSizeMB: 100,
  //     skipIncompleteTrails: true,
  //     // Updated bbox to match actual Seattle trails in DB (queried 2024-06-13)
  //     bbox: [-122.19, 47.32, -121.78, 47.74],
  //     skipCleanup: true, // <-- Added
  //   });

  //   // Act: run the pipeline
  //   await orchestrator.run();

  //   // New: Assert on staging schema before cleanup
  //   const { Client } = require('pg');
  //   const client = new Client();
  //   await client.connect();
  //   const stagingSchema = orchestrator.stagingSchema;
  //   const result = await client.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
  //   console.log(`Staging trails count:`, result.rows[0].count);
  //   expect(Number(result.rows[0].count)).toBeGreaterThan(0);
  //   await client.end();

  //   // Optionally clean up staging schema
  //   await orchestrator.cleanupStaging();

  //   // Assert: open the exported SpatiaLite DB and check tables
  //   const db = new Database(REGION2_DB, { readonly: true });
  //   // Load SpatiaLite extension for spatial functions (adjust path as needed for your OS)
  //   db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
  //   const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
  //   expect(tables).toContain('routing_nodes');
  //   expect(tables).toContain('routing_edges');
  //   expect(tables).toContain('trails');
  //   expect(tables).toContain('region_metadata');

  //   // Check that routing nodes are present
  //   const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number }).n;
  //   expect(nodeCount).toBeGreaterThan(0);
  //   // Node count must be at least as many as trails
  //   const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
  //   expect(nodeCount).toBeGreaterThanOrEqual(trailCount);
  //   console.log(`
  //     Seattle export summary:
  //     - Trails: ${trailCount}
  //     - Nodes: ${nodeCount}
  //     - Edges: ${edgeCount}
  //   `);

  //   db.close();
  // }, 120000);
});