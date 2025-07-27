import { EnhancedPostgresOrchestrator } from '../../orchestrator/EnhancedPostgresOrchestrator';
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

// Test data for trail splitting scenarios
const SPLITTING_TEST_TRAILS = [
  // Scenario 1: Simple T-intersection (should split into 2 segments)
  {
    id: 1,
    app_uuid: 'split-test-1',
    name: 'Horizontal Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.3 40.0 1000, -105.2 40.0 1000, -105.1 40.0 1000)', // 3 points
    length_km: 2.0,
    elevation_gain: 100,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  {
    id: 2,
    app_uuid: 'split-test-2',
    name: 'Vertical Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.25 39.95 1000, -105.25 40.0 1000, -105.25 40.05 1000)', // Crosses at middle point
    length_km: 1.5,
    elevation_gain: 100,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  
  // Scenario 2: X-intersection (should split into 4 segments)
  {
    id: 3,
    app_uuid: 'split-test-3',
    name: 'Diagonal Trail 1',
    region: 'test',
    geometry: 'LINESTRING Z(-105.35 39.95 1000, -105.25 40.0 1000, -105.15 40.05 1000)', // Crosses at middle
    length_km: 2.0,
    elevation_gain: 200,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  {
    id: 4,
    app_uuid: 'split-test-4',
    name: 'Diagonal Trail 2',
    region: 'test',
    geometry: 'LINESTRING Z(-105.35 40.05 1000, -105.25 40.0 1000, -105.15 39.95 1000)', // Crosses Trail 3
    length_km: 2.0,
    elevation_gain: 200,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  
  // Scenario 3: No intersection (should not split)
  {
    id: 5,
    app_uuid: 'split-test-5',
    name: 'Isolated Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.1 40.0 1000, -105.05 40.0 1000)', // No intersections
    length_km: 0.5,
    elevation_gain: 0,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  },
  
  // Scenario 4: Multiple intersections (should split into multiple segments)
  {
    id: 6,
    app_uuid: 'split-test-6',
    name: 'Multi-Intersection Trail',
    region: 'test',
    geometry: 'LINESTRING Z(-105.4 40.0 1000, -105.25 40.0 1000, -105.1 40.0 1000)', // Crosses both vertical trails
    length_km: 3.0,
    elevation_gain: 150,
    elevation_loss: 0,
    max_elevation: 1000,
    min_elevation: 1000,
    avg_elevation: 1000,
    source: 'test'
  }
];

describe('Trail Splitting Functionality (PostGIS Only)', () => {
  let client: Client;
  let testSchema: string;
  let orchestrator: EnhancedPostgresOrchestrator;

  beforeAll(async () => {
    // Fail clearly if no test database is available
    if (!process.env.TEST_PGHOST && !process.env.PGHOST) {
      throw new Error('❌ TEST SETUP ERROR: TEST_PGHOST or PGHOST environment variable must be set for trail splitting tests.');
    }
    if (!process.env.TEST_PGUSER && !process.env.PGUSER) {
      throw new Error('❌ TEST SETUP ERROR: TEST_PGUSER or PGUSER environment variable must be set for trail splitting tests.');
    }
    
    try {
      client = new Client(TEST_DB_CONFIG);
      await client.connect();
    } catch (err) {
      throw new Error('❌ TEST SETUP ERROR: Could not connect to test database. ' + (err as Error).message);
    }
    
    // Create test schema
    testSchema = `test_trail_splitting_${Date.now()}`;
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
    
    // Create staging tables using PostGIS functions
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
    for (const trail of SPLITTING_TEST_TRAILS) {
      await client.query(`
        INSERT INTO ${testSchema}.trails (id, app_uuid, name, region, geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source)
        VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $7, $8, $9, $10, $11, $12)
      `, [trail.id, trail.app_uuid, trail.name, trail.region, trail.geometry, trail.length_km, trail.elevation_gain, trail.elevation_loss, trail.max_elevation, trail.min_elevation, trail.avg_elevation, trail.source]);
    }
    
    console.log(`✅ Created test schema ${testSchema} with ${SPLITTING_TEST_TRAILS.length} test trails`);
    
    // Create orchestrator instance for testing
    orchestrator = new EnhancedPostgresOrchestrator({
      region: 'test',
      outputPath: '/tmp/test-export.db',
      simplifyTolerance: 0.001,
      intersectionTolerance: 2.0,
      replace: false,
      validate: false,
      verbose: true,
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSpatiaLiteDbSizeMB: 400,
      skipIncompleteTrails: false,
      useSqlite: false
    });
    
    // Set up orchestrator with test schema and client
    (orchestrator as any).stagingSchema = testSchema;
    (orchestrator as any).pgClient = client;
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

  describe('PostGIS Intersection Detection', () => {
    test('should detect intersections using PostGIS functions', async () => {
      // Use PostGIS function to detect intersections
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Check that intersection points were created
      const intersectionCount = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.intersection_points
      `);
      
      expect(Number(intersectionCount.rows[0].count)).toBeGreaterThan(0);
      console.log(`✅ Found ${intersectionCount.rows[0].count} intersection points using PostGIS`);
      
      // Verify specific intersections using PostGIS functions
      const intersections = await client.query(`
        SELECT 
          ST_X(point) as x, 
          ST_Y(point) as y, 
          ST_Z(point_3d) as z,
          connected_trail_names,
          node_type
        FROM ${testSchema}.intersection_points
        ORDER BY ST_X(point)
      `);
      
      // Should have intersection at (-105.25, 40.0) where trails cross
      const centerIntersection = intersections.rows.find(row => 
        Math.abs(row.x - (-105.25)) < 0.001 && 
        Math.abs(row.y - 40.0) < 0.001
      );
      
      expect(centerIntersection).toBeDefined();
      console.log('✅ Found expected center intersection using PostGIS functions');
      
      // Log all intersections found
      console.log('📊 Intersections detected:');
      intersections.rows.forEach((row, i) => {
        console.log(`  ${i + 1}. (${row.x.toFixed(4)}, ${row.y.toFixed(4)}) - ${row.node_type} - Trails: ${row.connected_trail_names.join(', ')}`);
      });
    });
  });

  describe('PostGIS Routing Graph Creation', () => {
    test('should create routing nodes using PostGIS functions', async () => {
      // Use PostGIS function to build routing nodes
      const nodeCount = await client.query(`
        SELECT build_routing_nodes('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Check that routing nodes were created
      const nodesResult = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.routing_nodes
      `);
      
      expect(Number(nodesResult.rows[0].count)).toBeGreaterThan(0);
      console.log(`✅ Created ${nodesResult.rows[0].count} routing nodes using PostGIS`);
      
      // Verify node types and connections
      const nodes = await client.query(`
        SELECT 
          lat, lng, elevation, node_type, connected_trails,
          array_length(string_to_array(connected_trails, ','), 1) as trail_count
        FROM ${testSchema}.routing_nodes
        ORDER BY lat, lng
      `);
      
      console.log('📊 Routing nodes created:');
      nodes.rows.forEach((node, i) => {
        console.log(`  ${i + 1}. (${node.lat.toFixed(4)}, ${node.lng.toFixed(4)}) - ${node.node_type} - ${node.trail_count} trails`);
      });
      
      // Should have intersection nodes with multiple connected trails
      const intersectionNodes = nodes.rows.filter(node => node.node_type === 'intersection');
      expect(intersectionNodes.length).toBeGreaterThan(0);
      
      // All intersection nodes should have 2+ connected trails
      intersectionNodes.forEach(node => {
        expect(node.trail_count).toBeGreaterThanOrEqual(2);
      });
      
      console.log(`✅ All ${intersectionNodes.length} intersection nodes have 2+ connected trails`);
    });

    test('should create routing edges using PostGIS functions', async () => {
      // First create routing nodes
      await client.query(`
        SELECT build_routing_nodes('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Then create routing edges
      const edgeCount = await client.query(`
        SELECT build_routing_edges('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Check that routing edges were created
      const edgesResult = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.routing_edges
      `);
      
      expect(Number(edgesResult.rows[0].count)).toBeGreaterThan(0);
      console.log(`✅ Created ${edgesResult.rows[0].count} routing edges using PostGIS`);
      
      // Verify edge connectivity
      const edges = await client.query(`
        SELECT 
          from_node_id, to_node_id, trail_name, distance_km,
          ST_Length(geometry::geography) / 1000 as calculated_distance_km
        FROM ${testSchema}.routing_edges
        ORDER BY from_node_id, to_node_id
      `);
      
      console.log('📊 Routing edges created:');
      edges.rows.forEach((edge, i) => {
        console.log(`  ${i + 1}. Node ${edge.from_node_id} → Node ${edge.to_node_id} - ${edge.trail_name} (${edge.distance_km.toFixed(3)}km)`);
      });
      
      // Verify no self-loops
      const selfLoops = edges.rows.filter(edge => edge.from_node_id === edge.to_node_id);
      expect(selfLoops.length).toBe(0);
      console.log('✅ No self-looping edges detected');
      
      // Verify all edges reference valid nodes
      const validEdges = await client.query(`
        SELECT COUNT(*) as count
        FROM ${testSchema}.routing_edges e
        JOIN ${testSchema}.routing_nodes n1 ON e.from_node_id = n1.id
        JOIN ${testSchema}.routing_nodes n2 ON e.to_node_id = n2.id
      `);
      
      expect(Number(validEdges.rows[0].count)).toBe(Number(edgesResult.rows[0].count));
      console.log('✅ All edges reference valid nodes');
    });
  });

  describe('PostGIS Trail Splitting Validation', () => {
    test('should validate that trails are properly split at intersections', async () => {
      // Run full PostGIS intersection detection and routing graph creation
      await client.query(`
        INSERT INTO ${testSchema}.intersection_points
          (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
        FROM detect_trail_intersections('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      await client.query(`
        SELECT build_routing_nodes('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      await client.query(`
        SELECT build_routing_edges('${testSchema}', 'trails', $1)
      `, [2.0]);
      
      // Get intersection statistics using PostGIS function
      const stats = await client.query(`
        SELECT * FROM get_intersection_stats('${testSchema}')
      `);
      
      console.log('📊 PostGIS Intersection Statistics:');
      console.log(`  Total nodes: ${stats.rows[0].total_nodes}`);
      console.log(`  Total edges: ${stats.rows[0].total_edges}`);
      console.log(`  Node-to-trail ratio: ${stats.rows[0].node_to_trail_ratio}`);
      
      // Validate that we have the expected number of intersections
      expect(stats.rows[0].total_nodes).toBeGreaterThan(0);
      expect(stats.rows[0].total_edges).toBeGreaterThan(0);
      
      // Check that trails with intersections created multiple edges
      const trailEdgeCounts = await client.query(`
        SELECT 
          trail_name,
          COUNT(*) as edge_count
        FROM ${testSchema}.routing_edges
        GROUP BY trail_name
        ORDER BY trail_name
      `);
      
      console.log('📊 Trail edge counts:');
      trailEdgeCounts.rows.forEach(row => {
        console.log(`  ${row.trail_name}: ${row.edge_count} edges`);
      });
      
      // Horizontal and vertical trails should have multiple edges due to intersection
      const horizontalTrail = trailEdgeCounts.rows.find(row => row.trail_name === 'Horizontal Trail');
      const verticalTrail = trailEdgeCounts.rows.find(row => row.trail_name === 'Vertical Trail');
      
      if (horizontalTrail) {
        expect(horizontalTrail.edge_count).toBeGreaterThanOrEqual(2);
        console.log(`✅ Horizontal Trail split into ${horizontalTrail.edge_count} segments`);
      }
      
      if (verticalTrail) {
        expect(verticalTrail.edge_count).toBeGreaterThanOrEqual(2);
        console.log(`✅ Vertical Trail split into ${verticalTrail.edge_count} segments`);
      }
      
      // Validate spatial integrity using PostGIS
      const spatialValidation = await client.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN ST_IsValid(geometry) THEN 1 END) as valid_geometries,
          COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_d_geometries
        FROM ${testSchema}.routing_edges
      `);
      
      const validation = spatialValidation.rows[0];
      expect(validation.total_edges).toBe(validation.valid_geometries);
      expect(validation.three_d_geometries).toBe(validation.total_edges);
      
      console.log(`✅ Spatial validation passed: ${validation.total_edges} edges, all valid 3D geometries`);
    });
  });
}); 