import { Client } from 'pg';
import { validateTestEnvironment } from '../../utils/env';
import fs from 'fs';
import path from 'path';

// Test configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
  database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
  user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
  password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
};

let client: Client | null = null;
let testSchema: string;

async function createTestEnvironment() {
  try {
    const testClient = new Client(TEST_DB_CONFIG);
    await testClient.connect();
    client = testClient;
    
    // Create unique test schema
    testSchema = `test_intersection_${Date.now()}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Load PostGIS functions into the test schema
    const sqlPath = path.resolve(__dirname, '../../../docs/sql/carthorse-postgis-intersection-functions.sql');
    if (fs.existsSync(sqlPath)) {
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      // Replace function names to use the test schema
      const testSql = sqlContent
        .replace(/CREATE OR REPLACE FUNCTION public\./g, `CREATE OR REPLACE FUNCTION ${testSchema}.`)
        .replace(/CREATE OR REPLACE FUNCTION /g, `CREATE OR REPLACE FUNCTION ${testSchema}.`)
        .replace(/public\.detect_trail_intersections/g, `${testSchema}.detect_trail_intersections`)
        .replace(/public\.build_routing_nodes/g, `${testSchema}.build_routing_nodes`)
        .replace(/public\.build_routing_edges/g, `${testSchema}.build_routing_edges`)
        .replace(/public\.get_intersection_stats/g, `${testSchema}.get_intersection_stats`)
        .replace(/public\.validate_intersection_detection/g, `${testSchema}.validate_intersection_detection`)
        .replace(/public\.validate_spatial_data_integrity/g, `${testSchema}.validate_spatial_data_integrity`);
      
      await client.query(testSql);
      console.log('✅ Loaded PostGIS intersection functions');
    } else {
      throw new Error(`❌ PostGIS functions file not found: ${sqlPath}`);
    }
    
    return client;
  } catch (error) {
    console.error('❌ Error creating test environment:', error);
    throw error;
  }
}

async function cleanupTestEnvironment() {
  if (client && testSchema) {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      console.log('✅ Cleaned up test schema');
    } catch (error) {
      console.error('❌ Error cleaning up test schema:', error);
    }
  }
}

describe('Real-world Intersection Detection Tests', () => {
  beforeAll(async () => {
    validateTestEnvironment();
    client = await createTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
    if (client) {
      try {
        await client.end();
      } catch (error) {
        console.error('❌ Error closing client:', error);
      }
    }
  });

  describe('T-Intersection: Hurd Creek Road', () => {
    beforeEach(async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      // Create trails table in test schema
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          app_uuid TEXT UNIQUE NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326) NOT NULL
        )
      `);

      // Copy real intersecting trails from the main database
      await client.query(`
        INSERT INTO ${testSchema}.trails (name, app_uuid, geometry)
        SELECT name, app_uuid, geometry 
        FROM public.trails 
        WHERE name = 'Hurd Creek Road' 
        LIMIT 2
      `);
    });

    afterEach(async () => {
      if (client) {
        await client.query(`DROP TABLE IF EXISTS ${testSchema}.trails CASCADE`);
      }
    });

    test('should detect T-intersection between Hurd Creek Road segments', async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      const result = await client.query(`
        SELECT * FROM ${testSchema}.detect_trail_intersections('${testSchema}', 'trails', 2.0)
      `);
      
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      
      // Check that we have intersection nodes
      const nodes = result.rows.filter((row: any) => row.node_type === 'intersection');
      expect(nodes.length).toBeGreaterThan(0);
      
      console.log(`✅ T-intersection test: Found ${result.rows.length} nodes, ${nodes.length} intersections`);
    });
  });

  describe('Y-Intersection: Caribou Trails', () => {
    beforeEach(async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      // Create trails table in test schema
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          app_uuid TEXT UNIQUE NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326) NOT NULL
        )
      `);

      // Copy real intersecting trails from the main database
      await client.query(`
        INSERT INTO ${testSchema}.trails (name, app_uuid, geometry)
        SELECT name, app_uuid, geometry 
        FROM public.trails 
        WHERE name LIKE '%Caribou%' 
        LIMIT 3
      `);
    });

    afterEach(async () => {
      if (client) {
        await client.query(`DROP TABLE IF EXISTS ${testSchema}.trails CASCADE`);
      }
    });

    test('should detect Y-intersection between Caribou trails', async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      const result = await client.query(`
        SELECT * FROM ${testSchema}.detect_trail_intersections('${testSchema}', 'trails', 2.0)
      `);
      
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      
      // Check that we have intersection nodes
      const nodes = result.rows.filter((row: any) => row.node_type === 'intersection');
      expect(nodes.length).toBeGreaterThan(0);
      
      console.log(`✅ Y-intersection test: Found ${result.rows.length} nodes, ${nodes.length} intersections`);
    });
  });

  describe('X-Intersection: Grassy Area Trails', () => {
    beforeEach(async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      // Create trails table in test schema
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          app_uuid TEXT UNIQUE NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326) NOT NULL
        )
      `);

      // Copy real intersecting trails from the main database
      await client.query(`
        INSERT INTO ${testSchema}.trails (name, app_uuid, geometry)
        SELECT name, app_uuid, geometry 
        FROM public.trails 
        WHERE name LIKE '%Grassy%' 
        LIMIT 4
      `);
    });

    afterEach(async () => {
      if (client) {
        await client.query(`DROP TABLE IF EXISTS ${testSchema}.trails CASCADE`);
      }
    });

    test('should detect X-intersection between Grassy Area trails', async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      const result = await client.query(`
        SELECT * FROM ${testSchema}.detect_trail_intersections('${testSchema}', 'trails', 2.0)
      `);
      
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      
      // Check that we have intersection nodes
      const nodes = result.rows.filter((row: any) => row.node_type === 'intersection');
      expect(nodes.length).toBeGreaterThan(0);
      
      console.log(`✅ X-intersection test: Found ${result.rows.length} nodes, ${nodes.length} intersections`);
    });
  });

  describe('Multiple Intersections: Caribou Spur Trails', () => {
    beforeEach(async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      // Create trails table in test schema
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          app_uuid TEXT UNIQUE NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326) NOT NULL
        )
      `);

      // Copy real intersecting trails from the main database
      await client.query(`
        INSERT INTO ${testSchema}.trails (name, app_uuid, geometry)
        SELECT name, app_uuid, geometry 
        FROM public.trails 
        WHERE name LIKE '%Caribou Spur%' 
        LIMIT 5
      `);
    });

    afterEach(async () => {
      if (client) {
        await client.query(`DROP TABLE IF EXISTS ${testSchema}.trails CASCADE`);
      }
    });

    test('should detect multiple intersections between Caribou Spur trails', async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      const result = await client.query(`
        SELECT * FROM ${testSchema}.detect_trail_intersections('${testSchema}', 'trails', 2.0)
      `);
      
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      
      // Check that we have intersection nodes
      const nodes = result.rows.filter((row: any) => row.node_type === 'intersection');
      expect(nodes.length).toBeGreaterThan(0);
      
      console.log(`✅ Multiple intersections test: Found ${result.rows.length} nodes, ${nodes.length} intersections`);
    });
  });

  describe('Integration Test: Complete Pipeline with Real Data', () => {
    beforeEach(async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      // Create trails table in test schema
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          app_uuid TEXT UNIQUE NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326) NOT NULL
        )
      `);

      // Copy a small set of real trails for testing
      await client.query(`
        INSERT INTO ${testSchema}.trails (name, app_uuid, geometry)
        SELECT name, app_uuid, geometry 
        FROM public.trails 
        WHERE name IN ('Hurd Creek Road', 'Caribou Trail', 'Grassy Area Trail')
        LIMIT 10
      `);
    });

    afterEach(async () => {
      if (client) {
        await client.query(`DROP TABLE IF EXISTS ${testSchema}.trails CASCADE`);
      }
    });

    test('should run complete intersection detection pipeline', async () => {
      if (!client) {
        throw new Error('Client not initialized');
      }
      
      // Step 1: Detect intersections
      const intersections = await client.query(`
        SELECT * FROM ${testSchema}.detect_trail_intersections('${testSchema}', 'trails', 2.0)
      `);
      
      expect(intersections.rows).toBeDefined();
      expect(intersections.rows.length).toBeGreaterThan(0);
      
      // Step 2: Build routing nodes
      const nodes = await client.query(`
        SELECT * FROM ${testSchema}.build_routing_nodes('${testSchema}', 'trails', 2.0)
      `);
      
      expect(nodes.rows).toBeDefined();
      expect(nodes.rows.length).toBeGreaterThan(0);
      
      // Step 3: Build routing edges
      const edges = await client.query(`
        SELECT * FROM ${testSchema}.build_routing_edges('${testSchema}', 'trails')
      `);
      
      expect(edges.rows).toBeDefined();
      expect(edges.rows.length).toBeGreaterThan(0);
      
      console.log(`✅ Complete pipeline test: ${intersections.rows.length} intersections, ${nodes.rows.length} nodes, ${edges.rows.length} edges`);
    });
  });
}); 