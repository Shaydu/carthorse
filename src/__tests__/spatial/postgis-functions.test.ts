import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
  database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
  user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
  password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
};

// Test data - simple trail geometries for testing
const TEST_TRAILS = [
  {
    id: 1,
    app_uuid: 'test-trail-1',
    name: 'Test Trail 1',
    geometry: 'LINESTRING Z(-105.3 40.0 1000, -105.2 40.1 1100)',
    length_km: 1.2,
    elevation_gain: 100
  },
  {
    id: 2,
    app_uuid: 'test-trail-2', 
    name: 'Test Trail 2',
    geometry: 'LINESTRING Z(-105.25 40.05 1050, -105.15 40.15 1150)',
    length_km: 1.5,
    elevation_gain: 100
  },
  {
    id: 3,
    app_uuid: 'test-trail-3',
    name: 'Test Trail 3', 
    geometry: 'LINESTRING Z(-105.3 40.0 1000, -105.1 40.2 1200)',
    length_km: 2.0,
    elevation_gain: 200
  },
  {
    id: 4,
    app_uuid: 'test-trail-4',
    name: 'Test Trail 4',
    geometry: 'LINESTRING Z(-105.4 40.0 1000, -105.0 40.0 1000)',
    length_km: 3.0,
    elevation_gain: 0
  }
];

describe('PostGIS Intersection Functions', () => {
  let client: Client;
  let testSchema: string;

  beforeAll(async () => {
    // Fail clearly if no test database is available
    if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
      throw new Error('❌ TEST SETUP ERROR: TEST_PGHOST or PGHOST environment variable must be set for PostGIS function tests.');
    }
    if (!process.env.TEST_PGUSER && !process.env.PGUSER) {
      throw new Error('❌ TEST SETUP ERROR: TEST_PGUSER or PGUSER environment variable must be set for PostGIS function tests.');
    }
    try {
      client = new Client(TEST_DB_CONFIG);
      await client.connect();
    } catch (err) {
      throw new Error('❌ TEST SETUP ERROR: Could not connect to test database. ' + (err as Error).message);
    }
    // Create test schema
    testSchema = `test_intersection_${Date.now()}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    // Load PostGIS functions
    const functionsSql = fs.readFileSync(path.resolve(__dirname, '../../../sql/carthorse-postgis-intersection-functions.sql'), 'utf8');
    await client.query(functionsSql);
    // Create test tables
    await client.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT NOT NULL,
        name TEXT NOT NULL,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km FLOAT,
        elevation_gain FLOAT
      )
    `);
    await client.query(`
      CREATE TABLE ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT NOT NULL,
        lat FLOAT NOT NULL,
        lng FLOAT NOT NULL,
        elevation FLOAT NOT NULL,
        node_type TEXT NOT NULL,
        connected_trails TEXT
      )
    `);
    await client.query(`
      CREATE TABLE ${testSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters REAL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE ${testSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER REFERENCES ${testSchema}.routing_nodes(id),
        to_node_id INTEGER REFERENCES ${testSchema}.routing_nodes(id),
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        distance_km FLOAT NOT NULL,
        elevation_gain FLOAT NOT NULL
      )
    `);
    // Insert test data
    for (const trail of TEST_TRAILS) {
      await client.query(`
        INSERT INTO ${testSchema}.trails (id, app_uuid, name, geometry, length_km, elevation_gain)
        VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), $5, $6)
      `, [trail.id, trail.app_uuid, trail.name, trail.geometry, trail.length_km, trail.elevation_gain]);
    }
    console.log(`✅ Test setup complete: ${TEST_TRAILS.length} test trails in schema ${testSchema}`);
  });

  afterAll(async () => {
    if (client) {
      // Clean up test schema
      if (testSchema) {
        await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      }
      await client.end();
    }
  });

  describe('detect_trail_intersections()', () => {
    test('should detect intersections between crossing trails', async () => {
      if (!client) return;

      const result = await client.query(`
        SELECT * FROM public.detect_trail_intersections('${testSchema}', 'trails', 2.0)
        ORDER BY distance_meters, ST_X(intersection_point)
      `);

      console.log('🔍 Intersection detection results:', result.rows);
      
      // Should find intersections between trails 1 and 3 (they share a start point)
      expect(Number(result.rows.length)).toBeGreaterThan(0);
      
      // Check that we have intersection points
      const intersectionPoints = result.rows.filter(row => row.node_type === 'intersection');
      expect(Number(intersectionPoints.length)).toBeGreaterThan(0);
      
      // Check that intersection points have multiple connected trails
      const multiTrailIntersections = intersectionPoints.filter(row => 
        row.connected_trail_ids && row.connected_trail_ids.length > 1
      );
      expect(Number(multiTrailIntersections.length)).toBeGreaterThan(0);
      
      console.log(`✅ Found ${intersectionPoints.length} intersection points with ${multiTrailIntersections.length} multi-trail intersections`);
    });

    test('should handle different tolerance values', async () => {
      if (!client) return;

      const tolerances = [1.0, 2.0, 5.0];
      const results: { tolerance: number; intersections: number }[] = [];

      for (const tolerance of tolerances) {
        const result = await client.query(`
          SELECT COUNT(*) as count FROM public.detect_trail_intersections('${testSchema}', 'trails', $1)
        `, [tolerance]);
        
        results.push({
          tolerance,
          intersections: parseInt(result.rows[0].count)
        });
      }

      console.log('📊 Tolerance sensitivity results:', results);
      
      // Higher tolerance should generally find more intersections
      expect(results[1]?.intersections).toBeGreaterThanOrEqual(results[0]?.intersections || 0);
      expect(results[2]?.intersections).toBeGreaterThanOrEqual(results[1]?.intersections || 0);
    });
  });

  describe('build_routing_nodes()', () => {
    test('should create routing nodes from intersection detection', async () => {
      if (!client) return;

      const nodeCount = await client.query(`
        SELECT build_routing_nodes('${testSchema}', 'trails', 2.0)
      `);

      console.log(`✅ Created ${nodeCount.rows[0].build_routing_nodes} routing nodes`);

      // Verify nodes were created
      const nodes = await client.query(`SELECT * FROM ${testSchema}.routing_nodes ORDER BY id`);
      expect(Number(nodes.rows.length)).toBeGreaterThan(0);
      
      // Check node types
      const intersectionNodes = nodes.rows.filter(n => n.node_type === 'intersection');
      const endpointNodes = nodes.rows.filter(n => n.node_type === 'endpoint');
      
      console.log(`📊 Node breakdown: ${intersectionNodes.length} intersections, ${endpointNodes.length} endpoints`);
      
      // Should have some intersection nodes
      expect(Number(intersectionNodes.length)).toBeGreaterThan(0);
      
      // Check that nodes have valid coordinates
      for (const node of nodes.rows) {
        expect(node.lat).toBeGreaterThanOrEqual(-90);
        expect(node.lat).toBeLessThanOrEqual(90);
        expect(node.lng).toBeGreaterThanOrEqual(-180);
        expect(node.lng).toBeLessThanOrEqual(180);
        expect(node.elevation).toBeDefined();
        expect(['intersection', 'endpoint']).toContain(node.node_type);
      }
    });

    test('should achieve reasonable node-to-trail ratio', async () => {
      if (!client) return;

      const stats = await client.query(`
        SELECT * FROM get_intersection_stats('${testSchema}')
      `);

      const ratio = stats.rows[0].node_to_trail_ratio;
      console.log(`📊 Node-to-trail ratio: ${(ratio * 100).toFixed(1)}%`);
      
      // Should be less than 100% (ideally < 50%)
      expect(ratio).toBeLessThan(1.0);
      
      // Should have some nodes
      expect(Number(stats.rows[0].total_nodes)).toBeGreaterThan(0);
    });
  });

  describe('build_routing_edges()', () => {
    test('should create routing edges between nodes', async () => {
      if (!client) return;

      // First create nodes
      await client.query(`SELECT build_routing_nodes('${testSchema}', 'trails', 2.0)`);
      
      // Then create edges
      const edgeCount = await client.query(`
        SELECT build_routing_edges('${testSchema}', 'trails')
      `);

      console.log(`✅ Created ${edgeCount.rows[0].build_routing_edges} routing edges`);

      // Verify edges were created
      const edges = await client.query(`SELECT * FROM ${testSchema}.routing_edges ORDER BY id`);
      expect(Number(edges.rows.length)).toBeGreaterThan(0);
      
      // Check that edges reference valid nodes
      const nodes = await client.query(`SELECT id FROM ${testSchema}.routing_nodes`);
      const nodeIds = nodes.rows.map(n => n.id);
      
      for (const edge of edges.rows) {
        expect(nodeIds).toContain(edge.from_node_id);
        expect(nodeIds).toContain(edge.to_node_id);
        expect(edge.from_node_id).not.toBe(edge.to_node_id); // No self-loops
        expect(edge.trail_id).toBeDefined();
        expect(edge.trail_name).toBeDefined();
        expect(edge.distance_km).toBeGreaterThan(0);
      }
    });
  });

  describe('get_intersection_stats()', () => {
    test('should provide accurate intersection statistics', async () => {
      if (!client) return;

      // Create nodes and edges first
      await client.query(`SELECT build_routing_nodes('${testSchema}', 'trails', 2.0)`);
      await client.query(`SELECT build_routing_edges('${testSchema}', 'trails')`);
      
      const stats = await client.query(`
        SELECT * FROM get_intersection_stats('${testSchema}')
      `);

      const stat = stats.rows[0];
      console.log('📊 Intersection statistics:', stat);
      
      // Validate statistics
      expect(Number(stat.total_nodes)).toBeGreaterThan(0);
      expect(Number(stat.intersection_nodes)).toBeGreaterThanOrEqual(0);
      expect(Number(stat.endpoint_nodes)).toBeGreaterThanOrEqual(0);
      expect(Number(stat.total_edges)).toBeGreaterThan(0);
      expect(Number(stat.node_to_trail_ratio)).toBeGreaterThan(0);
      expect(Number(stat.processing_time_ms)).toBeGreaterThan(0);
      
      // Node counts should add up
      expect(Number(stat.total_nodes)).toBe(Number(stat.intersection_nodes) + Number(stat.endpoint_nodes));
      
      // Should have reasonable ratio
      expect(Number(stat.node_to_trail_ratio)).toBeLessThan(2.0); // Less than 200%
    });
  });

  describe('validate_intersection_detection()', () => {
    test('should pass all validation checks', async () => {
      if (!client) return;

      // Create nodes and edges first
      await client.query(`SELECT build_routing_nodes('${testSchema}', 'trails', 2.0)`);
      await client.query(`SELECT build_routing_edges('${testSchema}', 'trails')`);
      
      const validation = await client.query(`
        SELECT * FROM validate_intersection_detection('${testSchema}')
        ORDER BY validation_check
      `);

      console.log('🔍 Validation results:', validation.rows);
      
      // All checks should pass
      for (const check of validation.rows) {
        expect(['PASS', 'WARNING']).toContain(check.status);
        console.log(`✅ ${check.validation_check}: ${check.status} - ${check.details}`);
      }
      
      // Should have at least some nodes and edges
      const nodesCheck = validation.rows.find(r => r.validation_check === 'Nodes exist');
      const edgesCheck = validation.rows.find(r => r.validation_check === 'Edges exist');
      
      expect(nodesCheck?.status).toBe('PASS');
      expect(edgesCheck?.status).toBe('PASS');
    });
  });

  describe('Integration Test: Full Pipeline', () => {
    test('should complete full intersection detection pipeline', async () => {
      if (!client) return;

      console.log('🚀 Running full intersection detection pipeline...');
      
      // Step 1: Detect intersections
      const intersections = await client.query(`
        SELECT COUNT(*) as count FROM public.detect_trail_intersections('${testSchema}', 'trails', 2.0)
      `);
      console.log(`✅ Step 1: Found ${intersections.rows[0].count} intersection points`);
      
      // Step 2: Build routing nodes
      const nodeCount = await client.query(`
        SELECT build_routing_nodes('${testSchema}', 'trails', 2.0)
      `);
      console.log(`✅ Step 2: Created ${nodeCount.rows[0].build_routing_nodes} routing nodes`);
      
      // Step 3: Build routing edges
      const edgeCount = await client.query(`
        SELECT build_routing_edges('${testSchema}', 'trails')
      `);
      console.log(`✅ Step 3: Created ${edgeCount.rows[0].build_routing_edges} routing edges`);
      
      // Step 4: Get statistics
      const stats = await client.query(`
        SELECT * FROM get_intersection_stats('${testSchema}')
      `);
      console.log(`✅ Step 4: Final stats - ${stats.rows[0].total_nodes} nodes, ${stats.rows[0].total_edges} edges, ${(stats.rows[0].node_to_trail_ratio * 100).toFixed(1)}% ratio`);
      
      // Step 5: Validate results
      const validation = await client.query(`
        SELECT * FROM validate_intersection_detection('${testSchema}')
      `);
      const failedChecks = validation.rows.filter(r => r.status === 'FAIL');
      console.log(`✅ Step 5: Validation - ${failedChecks.length} failed checks out of ${validation.rows.length} total`);
      
      // All validation checks should pass
      expect(failedChecks.length).toBe(0);
      
      // Should have reasonable results
      expect(Number(stats.rows[0].total_nodes)).toBeGreaterThan(0);
      expect(Number(stats.rows[0].total_edges)).toBeGreaterThan(0);
      expect(Number(stats.rows[0].node_to_trail_ratio)).toBeLessThan(2.0);
      
      console.log('🎉 Full pipeline completed successfully!');
    });
  });
}); 

 