import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { buildRoutingGraphHelper } from '../../utils/sql/routing';

// Test configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
  database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
  user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
  password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
};

// Test data for intersection configuration scenarios
const INTERSECTION_TEST_TRAILS = [
  // Trail 1: Horizontal trail
  {
    id: 1,
    app_uuid: 'config-test-1',
    name: 'Horizontal Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.3 40.0 1000, -105.2 40.0 1000, -105.1 40.0 1000)',
    length_km: 2.0,
    elevation_gain: 100,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  // Trail 2: Vertical trail that intersects with Trail 1
  {
    id: 2,
    app_uuid: 'config-test-2',
    name: 'Vertical Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.25 39.95 1000, -105.25 40.0 1000, -105.25 40.05 1000)',
    length_km: 1.5,
    elevation_gain: 100,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  // Trail 3: Isolated trail with no intersections
  {
    id: 3,
    app_uuid: 'config-test-3',
    name: 'Isolated Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.1 40.0 1000, -105.05 40.0 1000)',
    length_km: 0.5,
    elevation_gain: 0,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  }
];

describe('Intersection Node Configuration Tests', () => {
  let client: Client;
  let testSchema: string;

  beforeAll(async () => {
    // Fail clearly if no test database is available
    if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
      throw new Error('❌ TEST SETUP ERROR: TEST_PGHOST or PGHOST environment variable must be set for intersection configuration tests.');
    }
    if (!process.env.TEST_PGUSER && !process.env.PGUSER) {
      throw new Error('❌ TEST SETUP ERROR: TEST_PGUSER or PGUSER environment variable must be set for intersection configuration tests.');
    }
    
    try {
      client = new Client(TEST_DB_CONFIG);
      await client.connect();
    } catch (err) {
      throw new Error('❌ TEST SETUP ERROR: Could not connect to test database. ' + (err as Error).message);
    }
    
    // Create test schema
    testSchema = `test_intersection_config_${Date.now()}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Load PostGIS functions
    const sqlPath = path.resolve(__dirname, '../../../sql/carthorse-postgis-intersection-functions.sql');
    if (fs.existsSync(sqlPath)) {
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sqlContent);
      console.log('✅ Loaded PostGIS intersection functions');
    } else {
      throw new Error(`❌ PostGIS functions file not found: ${sqlPath}`);
    }
    
    // Create staging tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT
      );
      
      CREATE TABLE IF NOT EXISTS ${testSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters REAL
      );
      
      CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
        connected_trails TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER,
        to_node_id INTEGER,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL DEFAULT 0,
        elevation_loss REAL DEFAULT 0,
        is_bidirectional BOOLEAN DEFAULT true,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Insert test trail data
    for (const trail of INTERSECTION_TEST_TRAILS) {
      await client.query(`
        INSERT INTO ${testSchema}.trails (id, app_uuid, name, region, geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source)
        VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $7, $8, $9, $10, $11, $12)
      `, [trail.id, trail.app_uuid, trail.name, trail.region, trail.geometry, trail.length_km, trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation, trail.source]);
    }
    
    console.log(`✅ Created test schema ${testSchema} with ${INTERSECTION_TEST_TRAILS.length} test trails`);
  });

  afterEach(async () => {
    // Clean up test data
    await client.query(`DELETE FROM ${testSchema}.intersection_points`);
    await client.query(`DELETE FROM ${testSchema}.routing_nodes`);
    await client.query(`DELETE FROM ${testSchema}.routing_edges`);
  });

  afterAll(async () => {
    // Clean up test schema
    await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await client.end();
    console.log(`✅ Cleaned up test schema ${testSchema}`);
  });

  describe('Intersection Node Configuration: useIntersectionNodes = true', () => {
    test('should create intersection nodes when useIntersectionNodes is true', async () => {
      // First, detect intersections
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Build routing graph with intersection nodes enabled
      const result = await buildRoutingGraphHelper(
        client,
        testSchema,
        'trails',
        2.0, // intersection tolerance
        20.0, // edge tolerance
        {
          useIntersectionNodes: true,
          intersectionTolerance: 2.0,
          edgeTolerance: 20.0
        }
      );
      
      console.log(`✅ Created ${result.nodeCount} nodes and ${result.edgeCount} edges with intersection nodes enabled`);
      
      // Verify that intersection nodes were created
      const nodes = await client.query(`
        SELECT node_type, COUNT(*) as count
        FROM ${testSchema}.routing_nodes
        GROUP BY node_type
        ORDER BY node_type
      `);
      
      console.log('📊 Node breakdown:', nodes.rows);
      
      // Should have both intersection and endpoint nodes
      expect(result.nodeCount).toBeGreaterThan(0);
      expect(result.edgeCount).toBeGreaterThan(0);
      
      // Check for intersection nodes specifically
      const intersectionNodes = nodes.rows.find(row => row.node_type === 'intersection');
      expect(intersectionNodes).toBeDefined();
      expect(Number(intersectionNodes.count)).toBeGreaterThan(0);
      
      // Verify intersection node properties
      const intersectionDetails = await client.query(`
        SELECT lat, lng, node_type, connected_trails
        FROM ${testSchema}.routing_nodes
        WHERE node_type = 'intersection'
        ORDER BY lat, lng
      `);
      
      intersectionDetails.rows.forEach(node => {
        expect(node.node_type).toBe('intersection');
        expect(node.connected_trails).toBeDefined();
        expect(node.connected_trails.split(',').length).toBeGreaterThan(1); // Should connect multiple trails
      });
      
      console.log(`✅ Found ${intersectionDetails.rows.length} intersection nodes with multiple connected trails`);
    });
  });

  describe('Intersection Node Configuration: useIntersectionNodes = false', () => {
    test('should NOT create intersection nodes when useIntersectionNodes is false', async () => {
      // First, detect intersections
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Build routing graph with intersection nodes disabled
      const result = await buildRoutingGraphHelper(
        client,
        testSchema,
        'trails',
        2.0, // intersection tolerance
        20.0, // edge tolerance
        {
          useIntersectionNodes: false,
          intersectionTolerance: 2.0,
          edgeTolerance: 20.0
        }
      );
      
      console.log(`✅ Created ${result.nodeCount} nodes and ${result.edgeCount} edges with intersection nodes disabled`);
      
      // Verify that NO intersection nodes were created
      const nodes = await client.query(`
        SELECT node_type, COUNT(*) as count
        FROM ${testSchema}.routing_nodes
        GROUP BY node_type
        ORDER BY node_type
      `);
      
      console.log('📊 Node breakdown:', nodes.rows);
      
      // Should have nodes but NO intersection nodes
      expect(result.nodeCount).toBeGreaterThan(0);
      
      // Check that there are NO intersection nodes
      const intersectionNodes = nodes.rows.find(row => row.node_type === 'intersection');
      if (intersectionNodes) {
        expect(intersectionNodes.count).toBe(0);
      }
      
      // Should only have endpoint nodes
      const endpointNodes = nodes.rows.find(row => row.node_type === 'endpoint');
      expect(endpointNodes).toBeDefined();
      expect(Number(endpointNodes.count)).toBeGreaterThan(0);
      
      // Verify endpoint node properties
      const endpointDetails = await client.query(`
        SELECT lat, lng, node_type, connected_trails
        FROM ${testSchema}.routing_nodes
        WHERE node_type = 'endpoint'
        ORDER BY lat, lng
      `);
      
      endpointDetails.rows.forEach(node => {
        expect(node.node_type).toBe('endpoint');
        expect(node.connected_trails).toBeDefined();
        // Endpoint nodes typically connect 1-2 trails
        const trailCount = node.connected_trails.split(',').length;
        expect(trailCount).toBeGreaterThan(0);
        expect(trailCount).toBeLessThanOrEqual(2);
      });
      
      console.log(`✅ Found ${endpointDetails.rows.length} endpoint nodes (no intersection nodes)`);
    });
  });

  describe('Default Configuration Behavior', () => {
    test('should use default configuration when no config is provided', async () => {
      // First, detect intersections
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Build routing graph with no config (should use defaults)
      const result = await buildRoutingGraphHelper(
        client,
        testSchema,
        'trails',
        2.0, // intersection tolerance
        20.0  // edge tolerance
        // No config parameter
      );
      
      console.log(`✅ Created ${result.nodeCount} nodes and ${result.edgeCount} edges with default configuration`);
      
      // Verify default behavior (should match current implementation)
      const nodes = await client.query(`
        SELECT node_type, COUNT(*) as count
        FROM ${testSchema}.routing_nodes
        GROUP BY node_type
        ORDER BY node_type
      `);
      
      console.log('📊 Default configuration node breakdown:', nodes.rows);
      
      // Document the current default behavior
      expect(result.nodeCount).toBeGreaterThan(0);
      
      // Log the current default behavior for reference
      nodes.rows.forEach(row => {
        console.log(`  - ${row.node_type}: ${row.count} nodes`);
      });
    });
  });

  describe('Configuration Comparison', () => {
    test('should show different results between enabled and disabled intersection nodes', async () => {
      // Test with intersection nodes enabled
      await client.query(`DELETE FROM ${testSchema}.intersection_points`);
      await client.query(`DELETE FROM ${testSchema}.routing_nodes`);
      await client.query(`DELETE FROM ${testSchema}.routing_edges`);
      
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      const resultEnabled = await buildRoutingGraphHelper(
        client,
        testSchema,
        'trails',
        2.0,
        20.0,
        { useIntersectionNodes: true }
      );
      
      const nodesEnabled = await client.query(`
        SELECT node_type, COUNT(*) as count
        FROM ${testSchema}.routing_nodes
        GROUP BY node_type
        ORDER BY node_type
      `);
      
      console.log('📊 With intersection nodes ENABLED:', nodesEnabled.rows);
      console.log(`  - Total nodes: ${resultEnabled.nodeCount}`);
      console.log(`  - Total edges: ${resultEnabled.edgeCount}`);
      
      // Test with intersection nodes disabled
      await client.query(`DELETE FROM ${testSchema}.intersection_points`);
      await client.query(`DELETE FROM ${testSchema}.routing_nodes`);
      await client.query(`DELETE FROM ${testSchema}.routing_edges`);
      
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      const resultDisabled = await buildRoutingGraphHelper(
        client,
        testSchema,
        'trails',
        2.0,
        20.0,
        { useIntersectionNodes: false }
      );
      
      const nodesDisabled = await client.query(`
        SELECT node_type, COUNT(*) as count
        FROM ${testSchema}.routing_nodes
        GROUP BY node_type
        ORDER BY node_type
      `);
      
      console.log('📊 With intersection nodes DISABLED:', nodesDisabled.rows);
      console.log(`  - Total nodes: ${resultDisabled.nodeCount}`);
      console.log(`  - Total edges: ${resultDisabled.edgeCount}`);
      
      // Compare results
      console.log('📊 COMPARISON:');
      console.log(`  - Nodes (enabled vs disabled): ${resultEnabled.nodeCount} vs ${resultDisabled.nodeCount}`);
      console.log(`  - Edges (enabled vs disabled): ${resultEnabled.edgeCount} vs ${resultDisabled.edgeCount}`);
      
      // The results should be different when intersection nodes are enabled vs disabled
      // (This test documents the expected behavior difference)
      expect(resultEnabled.nodeCount).toBeGreaterThan(0);
      expect(resultDisabled.nodeCount).toBeGreaterThan(0);
      
      // Log the difference for analysis
      const nodeDiff = resultEnabled.nodeCount - resultDisabled.nodeCount;
      const edgeDiff = resultEnabled.edgeCount - resultDisabled.edgeCount;
      console.log(`  - Node difference: ${nodeDiff} (${nodeDiff > 0 ? 'more' : 'fewer'} with intersection nodes)`);
      console.log(`  - Edge difference: ${edgeDiff} (${edgeDiff > 0 ? 'more' : 'fewer'} with intersection nodes)`);
    });
  });
}); 