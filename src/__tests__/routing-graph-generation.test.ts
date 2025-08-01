import { Client } from 'pg';
import { getTestDbConfig } from '../database/connection';

describe.skip('Routing Graph Generation (Moved to staging-integration.test.ts)', () => {
  let pgClient: Client;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  afterEach(async () => {
    // Clean up test schemas
    const schemas = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'test_routing_%'
    `);
    
    for (const schema of schemas.rows) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    }
  });

  describe('generateRoutingGraph', () => {
    it('should generate routing nodes and edges from trail data', async () => {
      const testSchema = `test_routing_static`;
      
      // Create test schema and table
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          osm_type TEXT,
          length_km REAL CHECK(length_km > 0),
          elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
          elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface_type TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRING, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // Create routing tables with the structure the functions expect
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
          id SERIAL PRIMARY KEY,
          node_uuid TEXT UNIQUE NOT NULL,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          elevation DOUBLE PRECISION,
          node_type TEXT,
          connected_trails TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          source INTEGER,
          target INTEGER,
          trail_id TEXT,
          trail_name TEXT,
          distance_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRING, 4326),
          geojson TEXT
        )
      `);
      
      // Insert test trail data that will create intersections
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry, length_km
        ) VALUES 
        ('trail-1', 'Test Trail 1', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.0 40.0, -104.9 40.1)', 4326), 1.0),
        ('trail-2', 'Test Trail 2', 'test-region', 
         ST_GeomFromText('LINESTRING(-104.9 40.1, -104.8 40.2)', 4326), 1.0),
        ('trail-3', 'Test Trail 3', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.0 40.0, -104.8 40.2)', 4326), 1.5)
      `);

      // Test routing nodes generation
      const nodesResult = await pgClient.query(
        `SELECT * FROM generate_routing_nodes_native($1, $2)`,
        [testSchema, 2.0]
      );
      
      expect(nodesResult.rows).toBeDefined();
      expect(nodesResult.rows.length).toBeGreaterThan(0);
      
      const nodeData = nodesResult.rows[0];
      expect(nodeData).toBeDefined();
      expect(typeof nodeData.success).toBe('boolean');
      expect(typeof nodeData.node_count).toBe('number');
      expect(typeof nodeData.message).toBe('string');

      // Test routing edges generation
      const edgesResult = await pgClient.query(
        `SELECT * FROM generate_routing_edges_native($1, $2)`,
        [testSchema, 2.0]
      );
      
      expect(edgesResult.rows).toBeDefined();
      expect(edgesResult.rows.length).toBeGreaterThan(0);
      
      const edgeData = edgesResult.rows[0];
      expect(edgeData).toBeDefined();
      expect(typeof edgeData.success).toBe('boolean');
      expect(typeof edgeData.edge_count).toBe('number');
      expect(typeof edgeData.message).toBe('string');

      // Verify routing tables were created and populated
      const nodesTableExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'routing_nodes'
        )
      `, [testSchema]);
      
      const edgesTableExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'routing_edges'
        )
      `, [testSchema]);

      expect(nodesTableExists.rows[0].exists).toBe(true);
      expect(edgesTableExists.rows[0].exists).toBe(true);
    });

    it('should handle empty trail data gracefully', async () => {
      const testSchema = `test_routing_empty_static`;
      
      // Create test schema and empty table
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          osm_type TEXT,
          length_km REAL CHECK(length_km > 0),
          elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
          elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface_type TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRING, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // Create routing tables with the structure the functions expect
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
          id SERIAL PRIMARY KEY,
          node_uuid TEXT UNIQUE NOT NULL,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          elevation DOUBLE PRECISION,
          node_type TEXT,
          connected_trails TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          source INTEGER,
          target INTEGER,
          trail_id TEXT,
          trail_name TEXT,
          distance_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRING, 4326),
          geojson TEXT
        )
      `);
      
      // Test with empty trails table - should fail gracefully
      const nodesResult = await pgClient.query(
        `SELECT * FROM generate_routing_nodes_native($1, $2)`,
        [testSchema, 2.0]
      );
      
      const nodeData = nodesResult.rows[0];
      expect(nodeData.success).toBe(true); // Should succeed even when no trails exist
      expect(nodeData.node_count).toBe(0);
      expect(nodeData.message).toContain('Generated 0 routing nodes');

      const edgesResult = await pgClient.query(
        `SELECT * FROM generate_routing_edges_native($1, $2)`,
        [testSchema, 2.0]
      );
      
      const edgeData = edgesResult.rows[0];
      expect(edgeData.success).toBe(true); // Should succeed but return 0 edges when no nodes exist
      expect(edgeData.edge_count).toBe(0);
      expect(edgeData.message).toContain('Successfully generated 0 routing edges from 0 nodes');
    });

    it('should handle different intersection tolerances', async () => {
      const testSchema = `test_routing_tolerance_static`;
      
      // Create test schema and table
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          osm_type TEXT,
          length_km REAL CHECK(length_km > 0),
          elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
          elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface_type TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRING, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // Create routing tables with the structure the functions expect
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
          id SERIAL PRIMARY KEY,
          node_uuid TEXT UNIQUE NOT NULL,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          elevation DOUBLE PRECISION,
          node_type TEXT,
          connected_trails TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          source INTEGER,
          target INTEGER,
          trail_id TEXT,
          trail_name TEXT,
          distance_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRING, 4326),
          geojson TEXT
        )
      `);
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry, length_km
        ) VALUES 
        ('trail-1', 'Test Trail 1', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.0 40.0, -104.9 40.1)', 4326), 1.0),
        ('trail-2', 'Test Trail 2', 'test-region', 
         ST_GeomFromText('LINESTRING(-104.9 40.1, -104.8 40.2)', 4326), 1.0)
      `);

      // Test with different tolerances
      const tolerances = [1.0, 2.0, 5.0];
      
      for (const tolerance of tolerances) {
        const nodesResult = await pgClient.query(
          `SELECT * FROM generate_routing_nodes_native($1, $2)`,
          [testSchema, tolerance]
        );
        
        const nodeData = nodesResult.rows[0];
        expect(typeof nodeData.success).toBe('boolean');
        expect(typeof nodeData.node_count).toBe('number');
        expect(typeof nodeData.message).toBe('string');
        
        const edgesResult = await pgClient.query(
          `SELECT * FROM generate_routing_edges_native($1, $2)`,
          [testSchema, tolerance]
        );
        
        const edgeData = edgesResult.rows[0];
        expect(typeof edgeData.success).toBe('boolean');
        expect(typeof edgeData.edge_count).toBe('number');
        expect(typeof edgeData.message).toBe('string');
      }
    });

    it('should create proper routing table structure', async () => {
      const testSchema = `test_routing_structure_static`;
      
      // Create test schema and table
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          osm_type TEXT,
          length_km REAL CHECK(length_km > 0),
          elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
          elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface_type TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRING, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // Create routing tables with the structure the functions expect
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
          id SERIAL PRIMARY KEY,
          node_uuid TEXT UNIQUE NOT NULL,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          elevation DOUBLE PRECISION,
          node_type TEXT,
          connected_trails TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
          id SERIAL PRIMARY KEY,
          source INTEGER,
          target INTEGER,
          trail_id TEXT,
          trail_name TEXT,
          distance_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          geometry GEOMETRY(LINESTRING, 4326),
          geojson TEXT
        )
      `);
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry, length_km
        ) VALUES 
        ('trail-1', 'Test Trail 1', 'test-region', 
         ST_GeomFromText('LINESTRING(-105.0 40.0, -104.9 40.1)', 4326), 1.0)
      `);

      // Generate routing graph
      await pgClient.query(
        `SELECT * FROM generate_routing_nodes_native($1, $2)`,
        [testSchema, 2.0]
      );
      
      await pgClient.query(
        `SELECT * FROM generate_routing_edges_native($1, $2)`,
        [testSchema, 2.0]
      );

      // Check routing_nodes table structure
      const nodesColumns = await pgClient.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'routing_nodes'
        ORDER BY ordinal_position
      `, [testSchema]);

      expect(nodesColumns.rows.length).toBeGreaterThan(0);
      
      const expectedNodeColumns = ['id', 'node_uuid', 'lat', 'lng', 'elevation', 'node_type', 'connected_trails', 'created_at'];
      const actualNodeColumns = nodesColumns.rows.map(row => row.column_name);
      
      expectedNodeColumns.forEach(column => {
        expect(actualNodeColumns).toContain(column);
      });

      // Check routing_edges table structure
      const edgesColumns = await pgClient.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'routing_edges'
        ORDER BY ordinal_position
      `, [testSchema]);

      expect(edgesColumns.rows.length).toBeGreaterThan(0);
      
      const expectedEdgeColumns = ['id', 'source', 'target', 'trail_id', 'trail_name', 'distance_km', 'elevation_gain', 'elevation_loss', 'geometry', 'geojson'];
      const actualEdgeColumns = edgesColumns.rows.map(row => row.column_name);
      
      expectedEdgeColumns.forEach(column => {
        expect(actualEdgeColumns).toContain(column);
      });
    });

    it('should handle errors gracefully when functions are not available', async () => {
      const testSchema = `test_routing_error_static`;
      
      // Test with non-existent schema (should fail gracefully)
      try {
        await pgClient.query(
          `SELECT * FROM generate_routing_nodes_native($1, $2)`,
          ['non_existent_schema', 2.0]
        );
      } catch (error) {
        expect(error).toBeDefined();
        // Should not crash the application
      }

      try {
        await pgClient.query(
          `SELECT * FROM generate_routing_edges_native($1, $2)`,
          ['non_existent_schema', 2.0]
        );
      } catch (error) {
        expect(error).toBeDefined();
        // Should not crash the application
      }
    });
  });
});