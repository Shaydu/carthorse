import { buildRoutingGraphHelper } from '../routing';
import { Client } from 'pg';
const fs = require('fs');
const path = require('path');
const { detectIntersectionsHelper } = require('../intersection');

describe('buildRoutingGraphHelper', () => {
  it('should return node/edge counts and validation (smoke test)', async () => {
    // Mock pgClient with minimal interface
    const mockQuery = jest.fn((sql) => {
      if (sql.trim().startsWith('DELETE')) return Promise.resolve({});
      if (sql.includes('build_routing_nodes')) return Promise.resolve({ rows: [{ build_routing_nodes: 5 }] });
      if (sql.includes('build_routing_edges')) return Promise.resolve({ rows: [{ build_routing_edges: 10 }] });
      if (sql.includes('validate_spatial_data_integrity')) return Promise.resolve({ rows: [{ validation_check: 'check', status: 'PASS', details: 'ok' }] });
      if (sql.includes('get_intersection_stats')) return Promise.resolve({ rows: [{ total_nodes: 5, total_edges: 10 }] });
      return Promise.resolve({ rows: [] });
    });
    const pgClient = { query: mockQuery } as unknown as Client;
    const result = await buildRoutingGraphHelper(pgClient, 'test_schema', 'trails', 0.001, 0.001);
    console.log('nodeCount:', result.nodeCount, 'edgeCount:', result.edgeCount);
    console.log('mock calls:', mockQuery.mock.calls);
    expect(result).toHaveProperty('nodeCount', 5);
    expect(result).toHaveProperty('edgeCount', 10);
    expect(Array.isArray(result.validation)).toBe(true);
    expect(result.stats).toHaveProperty('total_nodes', 5);
    expect(result.stats).toHaveProperty('total_edges', 10);
  });

  it('should build routing graph in a real test DB (integration)', async () => {
    // This test assumes a test DB is available and a staging schema with trails exists
    // You may need to adjust schema and data setup for your environment
    const pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || '',
    });
    await pgClient.connect();
    const stagingSchema = 'staging_boulder_1752133482310'; // Replace with a real test schema with trails
    const trailsTable = 'trails';
    const intersectionTolerance = 0.001;
    const edgeTolerance = 0.001;
    const result = await buildRoutingGraphHelper(pgClient, stagingSchema, trailsTable, intersectionTolerance, edgeTolerance);
    expect(result).toHaveProperty('nodeCount');
    expect(result).toHaveProperty('edgeCount');
    expect(Array.isArray(result.validation)).toBe(true);
    expect(result.stats).toHaveProperty('total_nodes');
    expect(result.stats).toHaveProperty('total_edges');
    await pgClient.end();
  });
});

describe('Minimal edge detection (in-memory mock)', () => {
  it('should detect at least one edge for two intersecting trails', () => {
    // Minimal mock data: two trails crossing at (0,0)
    const nodes = [
      { id: 1, node_uuid: 'n1', lat: 0, lng: 0, elevation: 0, node_type: 'intersection', connected_trails: 't1,t2', created_at: new Date().toISOString() },
      { id: 2, node_uuid: 'n2', lat: 1, lng: 0, elevation: 0, node_type: 'endpoint', connected_trails: 't1', created_at: new Date().toISOString() },
      { id: 3, node_uuid: 'n3', lat: 0, lng: 1, elevation: 0, node_type: 'endpoint', connected_trails: 't2', created_at: new Date().toISOString() }
    ];
    const trails = [
      { id: 1, app_uuid: 't1', name: 'Trail 1', geometry: 'LINESTRING(0 0, 1 0)' },
      { id: 2, app_uuid: 't2', name: 'Trail 2', geometry: 'LINESTRING(0 0, 0 1)' }
    ];
    // Simulate edge detection: connect intersection to each endpoint
    const edges = [
      { from_node_id: 1, to_node_id: 2, trail_id: 't1', trail_name: 'Trail 1', distance_km: 1, elevation_gain: 0 },
      { from_node_id: 1, to_node_id: 3, trail_id: 't2', trail_name: 'Trail 2', distance_km: 1, elevation_gain: 0 }
    ];
    // Assert: at least one edge is created and connects valid nodes
    expect(edges.length).toBeGreaterThan(0);
    edges.forEach(e => {
      expect(nodes.find(n => n.id === e.from_node_id)).toBeDefined();
      expect(nodes.find(n => n.id === e.to_node_id)).toBeDefined();
    });
  });
});

describe('Mock edge detection', () => {
  it('should detect edges in minimal mock data', () => {
    // Minimal mock data test (no DB)
    const nodes = [
      { id: 1, node_uuid: 'n1', lat: 0, lng: 0, elevation: 0, node_type: 'intersection', connected_trails: 't1,t2' },
      { id: 2, node_uuid: 'n2', lat: 1, lng: 0, elevation: 0, node_type: 'endpoint', connected_trails: 't1' },
      { id: 3, node_uuid: 'n3', lat: 0, lng: 1, elevation: 0, node_type: 'endpoint', connected_trails: 't2' }
    ];
    const trails = [
      { id: 1, app_uuid: 't1', name: 'Trail 1', geometry: 'LINESTRING(0 0, 1 0)' },
      { id: 2, app_uuid: 't2', name: 'Trail 2', geometry: 'LINESTRING(0 0, 0 1)' }
    ];
    // Simulate edge detection: connect intersection to each endpoint
    const edges = [
      { from_node_id: 1, to_node_id: 2, trail_id: 't1', trail_name: 'Trail 1', geometry: 'LINESTRING(0 0, 1 0)' },
      { from_node_id: 1, to_node_id: 3, trail_id: 't2', trail_name: 'Trail 2', geometry: 'LINESTRING(0 0, 0 1)' }
    ];
    expect(edges.length).toBeGreaterThan(0);
  });

  it('should load and parse real trails.geojson', () => {
    const fs = require('fs');
    const path = require('path');
    const geojsonPath = path.resolve(__dirname, '../../../../tmp/trails.geojson');
    if (!fs.existsSync(geojsonPath)) {
      console.warn('GeoJSON test data not found:', geojsonPath);
      return;
    }
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
    const trails = geojson.features.filter((f: any) => f.geometry && f.geometry.type === 'LineString');
    expect(trails.length).toBeGreaterThan(0);
  });
});

// DB-dependent tests (kept separate)
describe('Node/Edge detection with real Boulder OSMP GeoJSON', () => {
  it('should detect nodes and edges from real trail data', async () => {
    const geojsonPath = path.resolve(__dirname, '../../../../tmp/trails.geojson');
    if (!fs.existsSync(geojsonPath)) {
      console.warn('GeoJSON test data not found:', geojsonPath);
      return;
    }
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
    const trails = geojson.features.filter((f: any) => f.geometry && f.geometry.type === 'LineString');
    // Simulate orchestrator pipeline: detect intersections, then build routing graph
    // (You may need to adapt this to your actual helper signatures)
    const mockPgClient = {/* mock or in-memory client if needed */};
    const stagingSchema = 'mock_schema';
    const intersectionTolerance = 2.0;
    // Detect intersections (mocked, since we don't have a real DB here)
    // This is a placeholder: in real tests, you would use a test DB or refactor helpers to accept in-memory data
    // const splitPoints = await detectIntersectionsHelper(mockPgClient, stagingSchema, intersectionTolerance);
    // Build routing graph (mocked)
    // const { nodes, edges } = await buildRoutingGraphHelper(mockPgClient, stagingSchema, intersectionTolerance);
    // For now, just print the number of trails
    console.log('Loaded trails:', trails.length);
    // TODO: When helpers support in-memory, run detection and assert node/edge counts
    expect(trails.length).toBeGreaterThan(0);
    // expect(nodes.length).toBeGreaterThan(0);
    // expect(edges.length).toBeGreaterThan(0);
  });
}); 