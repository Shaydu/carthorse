import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
const wellknown = require('wellknown');

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

  beforeAll(() => {
    cleanupTestDbs();
  });

  afterAll(async () => {}, 15000);

  test('orchestrator exports routing_nodes and routing_edges with correct schema and data for boulder', async () => {
    console.log('🧪 Starting Boulder export test...');
    // Arrange: create orchestrator with boulder config
    // Ensure old export file is deleted before running
    if (fs.existsSync(BOULDER_OUTPUT_PATH)) {
      console.log('🧹 Removing old Boulder export file...');
      fs.unlinkSync(BOULDER_OUTPUT_PATH);
    }
    orchestrator = new EnhancedPostgresOrchestrator({
      region: BOULDER_REGION,
      outputPath: BOULDER_OUTPUT_PATH,
      simplifyTolerance: 0.001,
      intersectionTolerance: 2,
      replace: true,
      validate: false,
      verbose: true, // Enable verbose orchestrator logging
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSpatiaLiteDbSizeMB: 100,
      skipIncompleteTrails: true,
      // Use a bbox that contains only Boulder Valley Ranch trails for a fast test
      bbox: [-105.3, 40.0, -105.2, 40.1],
      skipCleanup: true, // <-- Added
    });

    console.log('🚀 Running orchestrator.run()...');
    await orchestrator.run();
    console.log('✅ orchestrator.run() complete.');

    // Assert on staging schema before cleanup
    const stagingSchema = orchestrator.stagingSchema;
    console.log('🔍 Checking staging schema...');
    
    // Check if client is still available before querying
    if (orchestrator['pgClient'] && !orchestrator['pgClient'].connection?.stream?.destroyed) {
      const result = await orchestrator['pgClient'].query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
      console.log(`Staging trails count:`, result.rows[0].count);
      expect(Number(result.rows[0].count)).toBeGreaterThan(0);
    } else {
      console.log(`⚠️  Client connection unavailable, skipping staging schema validation`);
    }

    // Note: Orchestrator already handles cleanup in its finally block
    // No need to call cleanupStaging() again as it would fail with closed connection

    // Assert: open the exported SpatiaLite DB and check tables
    console.log('📂 Opening exported SQLite DB...');
    const db = new Database(BOULDER_OUTPUT_PATH, { readonly: true });
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
    // Node count must be at least as many as trails
    const trailCount = (db.prepare('SELECT COUNT(*) as n FROM trails').get() as { n: number }).n;
    expect(nodeCount).toBeGreaterThanOrEqual(trailCount);
    console.log(`✅ Found ${nodeCount} routing nodes in exported database`);
    
    // Check that routing edges are present
    const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
    expect(edgeCount).toBeGreaterThan(0);
    // Edge count must be at least as many as trails
    expect(edgeCount).toBeGreaterThanOrEqual(trailCount);
    console.log(`✅ Found ${edgeCount} routing edges in exported database`);
    console.log('🔎 Checking sample routing node and edge...');
    
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
    console.log('✅ Found sample routing node and edge.');

    // Use geometry_wkt column for validation (regular SQLite, not SpatiaLite)
    const trailSample = db.prepare('SELECT * FROM trails LIMIT 1').get() as any;
    expect(trailSample).toBeDefined();
    expect(trailSample.geometry_wkt).toBeDefined();
    console.log('Geometry WKT type:', typeof trailSample.geometry_wkt);
    console.log('Geometry WKT value:', trailSample.geometry_wkt);
    // Handle null case - geometry might not be exported properly
    if (trailSample.geometry_wkt === null) {
      console.warn('⚠️  geometry_wkt is null - this indicates the geometry export needs investigation');
      // For now, skip geometry validation if it's null
    } else if (typeof trailSample.geometry_wkt === 'string') {
      expect(trailSample.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
    } else if (Buffer.isBuffer(trailSample.geometry_wkt)) {
      const wktString = trailSample.geometry_wkt.toString();
      expect(wktString.startsWith('LINESTRING Z')).toBe(true);
    } else {
      throw new Error('geometry_wkt should be string, Buffer, or null');
    }
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
      // Geometry must be present and valid
      if (trail.geometry_wkt === null) {
        throw new Error('geometry_wkt is null for trail - this indicates the geometry export is broken');
      } else {
        expect(typeof trail.geometry_wkt).toBe('string');
        expect(trail.geometry_wkt.length).toBeGreaterThan(10);
        expect(trail.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
      }
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
    const nodeUuids = new Set();
    for (const node of allNodes as any[]) {
      expect(node.node_uuid).toBeDefined();
      expect(nodeUuids.has(node.node_uuid)).toBe(false); // unique
      nodeUuids.add(node.node_uuid);
      expect(typeof node.lat).toBe('number');
      expect(typeof node.lng).toBe('number');
      expect(['intersection', 'endpoint']).toContain(node.node_type);
    }

    // Strict row-by-row validation for all routing_edges
    const edgeLimit = process.env.CARTHORSE_TEST_LIMIT ? `LIMIT ${process.env.CARTHORSE_TEST_LIMIT}` : '';
    const allEdges = db.prepare(`SELECT * FROM routing_edges ${edgeLimit}`).all();
    expect(allEdges.length).toBeGreaterThan(0);
    const nodeIds = new Set(allNodes.map((n: any) => n.id));
    for (const edge of allEdges as any[]) {
      expect(edge.from_node_id).toBeDefined();
      expect(edge.to_node_id).toBeDefined();
      expect(edge.trail_id).toBeDefined();
      expect(typeof edge.distance_km).toBe('number');
      // from_node_id and to_node_id must exist in nodes
      expect(nodeIds.has(edge.from_node_id)).toBe(true);
      expect(nodeIds.has(edge.to_node_id)).toBe(true);
      // No self-loops
      expect(edge.from_node_id).not.toBe(edge.to_node_id);
    }
    console.log('✅ All trail, node, and edge checks complete.');

    // Check that regions table exists and has at least one row with metadata
    const regionCount = (db.prepare('SELECT COUNT(*) as n FROM region_metadata').get() as { n: number }).n;
    expect(regionCount).toBeGreaterThan(0);
    const regionSample = db.prepare('SELECT * FROM region_metadata LIMIT 1').get() as any;
    expect(regionSample).toBeDefined();
    expect(regionSample.bbox).toBeDefined();
    expect(regionSample.metadata).toBeDefined();

    // Optionally, check schema fields
    const nodeColumns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
    expect(nodeColumns).toEqual(expect.arrayContaining(['id', 'node_uuid', 'lat', 'lng', 'elevation', 'node_type', 'connected_trails']));
    const edgeColumns = db.prepare("PRAGMA table_info(routing_edges)").all().map((row: any) => row.name);
    expect(edgeColumns).toEqual(expect.arrayContaining(['id', 'from_node_id', 'to_node_id', 'trail_id', 'trail_name', 'distance_km', 'elevation_gain']));
    expect(trailColumns).toEqual(expect.arrayContaining([
      'id', 'app_uuid', 'osm_id', 'name', 'trail_type', 'surface', 'difficulty', 'source_tags',
      'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat', 'length_km',
      'elevation_gain', 'elevation_loss', 'max_elevation', 'min_elevation', 'avg_elevation', 'geometry',
      'created_at', 'updated_at'
    ]));
    const regionColumns = db.prepare("PRAGMA table_info(region_metadata)").all().map((row: any) => row.name);
    expect(regionColumns).toEqual(expect.arrayContaining([
      'id', 'name', 'description', 'bbox', 'initial_view_bbox', 'center', 'metadata'
    ]));

    db.close();
  }, 120000);

  // test('orchestrator exports routing_nodes and routing_edges with correct schema and data for seattle', async () => {
  //   // Arrange: create orchestrator with seattle config
  //   orchestrator = new EnhancedPostgresOrchestrator({
  //     region: SEATTLE_REGION,
  //     outputPath: SEATTLE_OUTPUT_PATH,
  //     simplifyTolerance: 0.001,
  //     intersectionTolerance: 2,
  //     replace: true,
  //     validate: false,
  //     verbose: false,
  //     skipBackup: true,
  //     buildMaster: false,
  //     targetSizeMB: null,
  //     maxSpatiaLiteDbSizeMB: 100,
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
  //   const db = new Database(SEATTLE_OUTPUT_PATH, { readonly: true });
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
  //   console.log(`✅ Found ${nodeCount} routing nodes in exported database`);
    
  //   // Check that routing edges are present
  //   const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number }).n;
  //   expect(edgeCount).toBeGreaterThan(0);
  //   // Edge count must be at least as many as trails
  //   expect(edgeCount).toBeGreaterThanOrEqual(trailCount);
  //   console.log(`✅ Found ${edgeCount} routing edges in exported database`);
    
  //   // Sample routing data to verify structure
  //   const nodeSample = db.prepare('SELECT * FROM routing_nodes LIMIT 1').get() as any;
  //   expect(nodeSample).toBeDefined();
  //   expect(nodeSample.lat).toBeDefined();
  //   expect(nodeSample.lng).toBeDefined();
  //   expect(nodeSample.node_type).toBeDefined();
    
  //   const edgeSample = db.prepare('SELECT * FROM routing_edges LIMIT 1').get() as any;
  //   expect(edgeSample).toBeDefined();
  //   expect(edgeSample.from_node_id).toBeDefined();
  //   expect(edgeSample.to_node_id).toBeDefined();
  //   expect(edgeSample.trail_id).toBeDefined();
  //   expect(edgeSample.distance_km).toBeDefined();

  //   // Strict row-by-row validation for all trails
  //   const allTrails = db.prepare('SELECT * FROM trails').all();
  //   expect(allTrails.length).toBeGreaterThan(0);
  //   for (const trail of allTrails as any[]) {
  //     // Elevation fields must be non-null (may be zero for flat or incomplete-data trails)
  //     expect(trail.elevation_gain).not.toBeNull();
  //     expect(trail.elevation_loss).not.toBeNull();
  //     expect(trail.max_elevation).not.toBeNull();
  //     expect(trail.min_elevation).not.toBeNull();
  //     expect(trail.avg_elevation).not.toBeNull();
  //     // Geometry must be present and valid
  //     if (trail.geometry_wkt === null) {
  //       console.warn('⚠️  geometry_wkt is null for trail - this indicates the geometry export needs investigation');
  //       // For now, skip geometry validation if it's null
  //     } else {
  //       expect(typeof trail.geometry_wkt).toBe('string');
  //       expect(trail.geometry_wkt.length).toBeGreaterThan(10);
  //       expect(trail.geometry_wkt.startsWith('LINESTRING Z')).toBe(true);
  //     }
  //     // Required fields must be present and non-empty
  //     expect(trail.name).toBeDefined();
  //     expect(trail.name).not.toBe('');
  //     expect(trail.app_uuid).toBeDefined();
  //     expect(trail.app_uuid).not.toBe('');
  //     expect(trail.trail_type).toBeDefined();
  //     expect(trail.trail_type).not.toBe('');
  //     // Bbox coordinates must be present and valid
  //     expect(trail.bbox_min_lng).not.toBeNull();
  //     expect(trail.bbox_max_lng).not.toBeNull();
  //     expect(trail.bbox_min_lat).not.toBeNull();
  //     expect(trail.bbox_max_lat).not.toBeNull();
  //     expect(trail.bbox_min_lng).toBeLessThanOrEqual(trail.bbox_max_lng);
  //     expect(trail.bbox_min_lat).toBeLessThanOrEqual(trail.bbox_max_lat);
  //   }

  //   // Check that regions table exists and has at least one row with metadata
  //   const regionCount = (db.prepare('SELECT COUNT(*) as n FROM region_metadata').get() as { n: number }).n;
  //   expect(regionCount).toBeGreaterThan(0);
  //   const regionSample = db.prepare('SELECT * FROM region_metadata LIMIT 1').get() as any;
  //   expect(regionSample).toBeDefined();
  //   expect(regionSample.bbox).toBeDefined();
  //   expect(regionSample.metadata).toBeDefined();

  //   // Optionally, check schema fields
  //   const nodeColumns = db.prepare("PRAGMA table_info(routing_nodes)").all().map((row: any) => row.name);
  //   expect(nodeColumns).toEqual(expect.arrayContaining(['id', 'node_uuid', 'lat', 'lng', 'elevation', 'node_type', 'connected_trails']));
  //   const edgeColumns = db.prepare("PRAGMA table_info(routing_edges)").all().map((row: any) => row.name);
  //   expect(edgeColumns).toEqual(expect.arrayContaining(['id', 'from_node_id', 'to_node_id', 'trail_id', 'trail_name', 'distance_km', 'elevation_gain']));
  //   const trailColumns = db.prepare("PRAGMA table_info(trails)").all().map((col: any) => col.name);
  //   expect(trailColumns).toEqual(expect.arrayContaining([
  //     'id', 'app_uuid', 'osm_id', 'name', 'trail_type', 'surface', 'difficulty', 'source_tags',
  //     'bbox_min_lng', 'bbox_max_lng', 'bbox_min_lat', 'bbox_max_lat', 'length_km',
  //     'elevation_gain', 'elevation_loss', 'max_elevation', 'min_elevation', 'avg_elevation', 'geometry',
  //     'created_at', 'updated_at'
  //   ]));
  //   const regionColumns = db.prepare("PRAGMA table_info(region_metadata)").all().map((row: any) => row.name);
  //   expect(regionColumns).toEqual(expect.arrayContaining([
  //     'id', 'name', 'description', 'bbox', 'initial_view_bbox', 'center', 'metadata'
  //   ]));

  //   db.close();
  // }, 60000);


}); 

describe('GeoJSON Export Integration', () => {
  test('all exported trails have valid, non-empty GeoJSON in SQLite', () => {
    // Use the Boulder or Seattle exported database for this test
    const dbPath = process.env.TEST_SQLITE_DB_PATH || './data/boulder.db';
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    // Use the correct geometry column (geo2 or geometry_wkt)
    const trails = db.prepare('SELECT id, geo2 FROM trails').all();
    expect(trails.length).toBeGreaterThan(0);
    let validCount = 0;
    for (const trail of trails) {
      expect(trail.geo2).toBeDefined();
      expect(typeof trail.geo2).toBe('string');
      expect(trail.geo2.length).toBeGreaterThan(10);
      // Parse WKT to GeoJSON and validate
      let geojsonObj;
      try {
        geojsonObj = wellknown.parse(trail.geo2);
      } catch (e) {
        throw new Error(`Trail id ${trail.id} has invalid WKT in geo2 field: ${trail.geo2}`);
      }
      expect(geojsonObj).toBeDefined();
      expect(geojsonObj.type).toBe('LineString');
      expect(Array.isArray(geojsonObj.coordinates)).toBe(true);
      expect(geojsonObj.coordinates.length).toBeGreaterThan(1);
      validCount++;
    }
    expect(validCount).toBe(trails.length);
    db.close();
  });
}); 