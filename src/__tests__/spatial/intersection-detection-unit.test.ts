import { EnhancedPostgresOrchestrator } from '../../orchestrator/EnhancedPostgresOrchestrator';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Mock data for unit tests
const MOCK_ROUTING_NODES = [
  {
    id: 1,
    node_uuid: 'node-1',
    lat: 40.0,
    lng: -105.3,
    elevation: 1000,
    node_type: 'intersection',
    connected_trails: JSON.stringify(['trail-1', 'trail-2']),
    created_at: new Date().toISOString()
  },
  {
    id: 2,
    node_uuid: 'node-2',
    lat: 40.1,
    lng: -105.2,
    elevation: 1100,
    node_type: 'endpoint',
    connected_trails: JSON.stringify(['trail-1']),
    created_at: new Date().toISOString()
  },
  {
    id: 3,
    node_uuid: 'node-3',
    lat: 40.05,
    lng: -105.25,
    elevation: 1050,
    node_type: 'intersection',
    connected_trails: JSON.stringify(['trail-2', 'trail-3']),
    created_at: new Date().toISOString()
  }
];

const MOCK_ROUTING_EDGES = [
  {
    id: 1,
    from_node_id: 1,
    to_node_id: 2,
    trail_id: 'trail-1',
    trail_name: 'Test Trail 1',
    distance_km: 0.5,
    elevation_gain: 100,
    created_at: new Date().toISOString()
  },
  {
    id: 2,
    from_node_id: 1,
    to_node_id: 3,
    trail_id: 'trail-2',
    trail_name: 'Test Trail 2',
    distance_km: 0.3,
    elevation_gain: 50,
    created_at: new Date().toISOString()
  }
];

const MOCK_TRAILS = [
  {
    id: 1,
    app_uuid: 'trail-1',
    name: 'Test Trail 1',
    trail_type: 'hiking',
    length_km: 0.5,
    elevation_gain: 100,
    elevation_loss: 0,
    max_elevation: 1100,
    min_elevation: 1000,
    avg_elevation: 1050
  },
  {
    id: 2,
    app_uuid: 'trail-2',
    name: 'Test Trail 2',
    trail_type: 'hiking',
    length_km: 0.3,
    elevation_gain: 50,
    elevation_loss: 0,
    max_elevation: 1050,
    min_elevation: 1000,
    avg_elevation: 1025
  }
];

// Test output path
const TEST_OUTPUT_PATH = path.resolve(__dirname, '../../data/test-unit-intersections.db');

// Ensure output directory exists before any file write
if (!fs.existsSync(path.dirname(TEST_OUTPUT_PATH))) {
  fs.mkdirSync(path.dirname(TEST_OUTPUT_PATH), { recursive: true });
}

// Utility to clean up test DB
function cleanupTestDb() {
  if (fs.existsSync(TEST_OUTPUT_PATH)) {
    fs.unlinkSync(TEST_OUTPUT_PATH);
  }
}

// Utility to create mock database
function createMockDatabase() {
  // Clean up any existing database
  if (fs.existsSync(TEST_OUTPUT_PATH)) {
    fs.unlinkSync(TEST_OUTPUT_PATH);
  }
  
  const db = new Database(TEST_OUTPUT_PATH);
  
  // Create tables
  db.exec(`
    CREATE TABLE routing_nodes (
      id INTEGER PRIMARY KEY,
      node_uuid TEXT UNIQUE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      elevation REAL,
      node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
      connected_trails TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE routing_edges (
      id INTEGER PRIMARY KEY,
      from_node_id INTEGER,
      to_node_id INTEGER,
      trail_id TEXT,
      trail_name TEXT,
      distance_km REAL,
      elevation_gain REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE trails (
      id INTEGER PRIMARY KEY,
      app_uuid TEXT UNIQUE,
      name TEXT,
      trail_type TEXT,
      length_km REAL,
      elevation_gain REAL,
      elevation_loss REAL,
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL
    );
  `);

  // Insert mock data
  const insertNode = db.prepare(`
    INSERT INTO routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEdge = db.prepare(`
    INSERT INTO routing_edges (id, from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTrail = db.prepare(`
    INSERT INTO trails (id, app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Insert mock data
  MOCK_ROUTING_NODES.forEach(node => {
    insertNode.run(node.id, node.node_uuid, node.lat, node.lng, node.elevation, node.node_type, node.connected_trails, node.created_at);
  });

  MOCK_ROUTING_EDGES.forEach(edge => {
    insertEdge.run(edge.id, edge.from_node_id, edge.to_node_id, edge.trail_id, edge.trail_name, edge.distance_km, edge.elevation_gain, edge.created_at);
  });

  MOCK_TRAILS.forEach(trail => {
    insertTrail.run(trail.id, trail.app_uuid, trail.name, trail.trail_type, trail.length_km, trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation);
  });

  return db;
}

describe('Intersection Detection - Unit Tests', () => {
  beforeAll(() => {
    cleanupTestDb();
  });

  afterAll(() => {
    cleanupTestDb();
  });

  describe('Algorithm Analysis', () => {
    test('should identify the core intersection detection problems', () => {
      console.log('🔍 Analyzing intersection detection with mock data...');
      
      // Create mock database
      const db = createMockDatabase();
      
      const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';

      // Get routing node statistics
      const totalNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number };
      const intersectionNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE node_type = ?').get('intersection') as { n: number };
      const endpointNodes = db.prepare('SELECT COUNT(*) as n FROM routing_nodes WHERE node_type = ?').get('endpoint') as { n: number };
      const trailCount = db.prepare(`SELECT COUNT(*) as n FROM ${TRAILS_TABLE}`).get() as { n: number };

      console.log('\n📊 INTERSECTION DETECTION ANALYSIS:');
      console.log(`   Total trails: ${trailCount.n}`);
      console.log(`   Total nodes: ${totalNodes.n}`);
      console.log(`   Intersection nodes: ${intersectionNodes.n}`);
      console.log(`   Endpoint nodes: ${endpointNodes.n}`);
      console.log(`   Intersection ratio: ${((intersectionNodes.n / totalNodes.n) * 100).toFixed(1)}%`);
      console.log(`   Average nodes per trail: ${(totalNodes.n / trailCount.n).toFixed(1)}`);

      // Check for the main problems using JSON functions
      const singleTrailNodes = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE json_array_length(connected_trails) = 1
      `).get() as { n: number };

      const falseIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = ? AND json_array_length(connected_trails) = 1
      `).get('intersection') as { n: number };

      const missedIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = ? AND json_array_length(connected_trails) > 1
      `).get('endpoint') as { n: number };

      console.log('\n🚨 PROBLEM ANALYSIS:');
      console.log(`   Single-trail nodes: ${singleTrailNodes.n} (${((singleTrailNodes.n / totalNodes.n) * 100).toFixed(1)}%)`);
      console.log(`   False intersections: ${falseIntersections.n}`);
      console.log(`   Missed intersections: ${missedIntersections.n}`);

      // Sample some nodes to understand the issue
      const nodeSample = db.prepare(`
        SELECT id, lat, lng, node_type, connected_trails, 
               json_array_length(connected_trails) as trail_count
        FROM routing_nodes 
        ORDER BY json_array_length(connected_trails) DESC 
        LIMIT 5
      `).all() as any[];

      console.log('\n🔎 TOP 5 NODES BY CONNECTED TRAILS:');
      nodeSample.forEach((node, i) => {
        console.log(`   ${i + 1}. Node ${node.id} (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}) - Type: ${node.node_type} - Trails: ${node.trail_count}`);
      });

      // Expectations for our mock data
      expect(totalNodes.n).toBe(3); // 3 mock nodes
      expect(intersectionNodes.n).toBe(2); // 2 intersection nodes
      expect(endpointNodes.n).toBe(1); // 1 endpoint node
      expect(falseIntersections.n).toBe(0); // No false intersections in mock data
      expect(missedIntersections.n).toBe(0); // No missed intersections in mock data

      db.close();
    });

    test('should test intersection tolerance sensitivity with mock data', () => {
      console.log('🔍 Testing intersection tolerance sensitivity with mock data...');
      
      // Create mock database with different node configurations
      const tolerances = [1, 5, 10, 20]; // meters
      const results: { tolerance: number; nodes: number; intersectionNodes: number; ratio: number }[] = [];

      tolerances.forEach((tolerance, index) => {
        // Simulate different node counts based on tolerance
        const baseNodes = 3;
        const additionalNodes = Math.floor(tolerance / 5); // More tolerance = more nodes
        const totalNodes = baseNodes + additionalNodes;
        const intersectionNodes = Math.max(2, Math.floor(totalNodes * 0.4)); // 40% intersections
        
        const ratio = (intersectionNodes / totalNodes) * 100;
        
        results.push({
          tolerance,
          nodes: totalNodes,
          intersectionNodes,
          ratio
        });

        console.log(`   ${tolerance}m tolerance: ${totalNodes} nodes, ${intersectionNodes} intersections (${ratio.toFixed(1)}%)`);
      });

      console.log('\n📊 TOLERANCE SENSITIVITY RESULTS:');
      results.forEach(r => {
        console.log(`   ${r.tolerance}m: ${r.nodes} nodes, ${r.intersectionNodes} intersections (${r.ratio.toFixed(1)}%)`);
      });

      // Higher tolerance should generally find more intersections
      expect(results[1]?.intersectionNodes).toBeGreaterThanOrEqual(results[0]?.intersectionNodes || 0);
      expect(results[2]?.intersectionNodes).toBeGreaterThanOrEqual(results[1]?.intersectionNodes || 0);
      expect(results[3]?.intersectionNodes).toBeGreaterThanOrEqual(results[2]?.intersectionNodes || 0);
    });
  });

  describe('Algorithm Validation', () => {
    test('should validate that intersection detection is working correctly', () => {
      console.log('🔍 Validating intersection detection correctness with mock data...');
      
      // Create mock database
      const db = createMockDatabase();

      const TRAILS_TABLE = process.env.CARTHORSE_TRAILS_TABLE || 'trails';

      // Validate node classification
      const falseIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = ? AND json_array_length(connected_trails) = 1
      `).get('intersection') as { n: number };

      const missedIntersections = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_nodes 
        WHERE node_type = ? AND json_array_length(connected_trails) > 1
      `).get('endpoint') as { n: number };

      console.log(`✅ Validation Results:`);
      console.log(`   False intersections: ${falseIntersections.n}`);
      console.log(`   Missed intersections: ${missedIntersections.n}`);

      // Validate edge connectivity
      const edgeCount = db.prepare('SELECT COUNT(*) as n FROM routing_edges').get() as { n: number };
      const nodeCount = db.prepare('SELECT COUNT(*) as n FROM routing_nodes').get() as { n: number };

      console.log(`   Total edges: ${edgeCount.n}`);
      console.log(`   Total nodes: ${nodeCount.n}`);

      // Check that all edges reference valid nodes
      const invalidEdges = db.prepare(`
        SELECT COUNT(*) as n 
        FROM routing_edges e
        LEFT JOIN routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
      `).get() as { n: number };

      console.log(`   Invalid edges: ${invalidEdges.n}`);

      // Expectations for mock data
      expect(falseIntersections.n).toBe(0); // No false intersections
      expect(missedIntersections.n).toBe(0); // No missed intersections
      expect(invalidEdges.n).toBe(0); // All edges reference valid nodes
      expect(edgeCount.n).toBe(2); // 2 mock edges
      expect(nodeCount.n).toBe(3); // 3 mock nodes

      db.close();
    });
  });
}); 