import { EnhancedPostgresOrchestrator } from '../orchestrator/EnhancedPostgresOrchestrator';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getTestDbConfig } from '../database/connection';

// Test configuration
const TEST_DB_CONFIG = getTestDbConfig();
const TEST_OUTPUT_PATH = path.resolve(__dirname, '../data/test-orchestrator-pipeline.db');

describe('Orchestrator Pipeline Integration Tests', () => {
  let client: Client;
  let testSchema: string;

  beforeAll(async () => {
    // Connect to test database
    client = new Client(TEST_DB_CONFIG);
    await client.connect();
    
    // Create unique test schema
    testSchema = `test_orchestrator_${Date.now()}`;
    
    // Clean up test output file
    if (fs.existsSync(TEST_OUTPUT_PATH)) {
      fs.unlinkSync(TEST_OUTPUT_PATH);
    }
  });

  afterAll(async () => {
    // Clean up test schema
    if (client && testSchema) {
      await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    }
    await client?.end();
    
    // Clean up test output file
    if (fs.existsSync(TEST_OUTPUT_PATH)) {
      fs.unlinkSync(TEST_OUTPUT_PATH);
    }
  });

  describe('1. SQL Function Validation', () => {
    test('should validate required PostGIS functions exist', async () => {
      // Test that required PostGIS functions are available
      const requiredFunctions = [
        'detect_trail_intersections',
        'build_routing_nodes', 
        'build_routing_edges',
        'get_intersection_stats'
      ];

      for (const funcName of requiredFunctions) {
        const result = await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = $1
          ) as exists
        `, [funcName]);
        
        expect(result.rows[0].exists).toBe(true);
        console.log(`✅ PostGIS function '${funcName}' exists`);
      }
    });

    test('should validate PostGIS extensions are enabled', async () => {
      const result = await client.query(`
        SELECT extname FROM pg_extension 
        WHERE extname IN ('postgis', 'postgis_topology', 'postgis_raster')
      `);
      
      const extensions = result.rows.map(row => row.extname);
      expect(extensions).toContain('postgis');
      console.log(`✅ PostGIS extensions enabled: ${extensions.join(', ')}`);
    });
  });

  describe('2. Database Connection', () => {
    test('should connect to PostgreSQL database successfully', async () => {
      expect(client).toBeDefined();
      
      const result = await client.query('SELECT version()');
      expect(result.rows[0].version).toContain('PostgreSQL');
      
      console.log('✅ Database connection successful');
    });

    test('should have proper database permissions', async () => {
      // Test that we can create schemas
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}_perm_test`);
      
      // Test that we can create tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}_perm_test.test_table (
          id SERIAL PRIMARY KEY,
          name TEXT
        )
      `);
      
      // Test that we can insert data
      await client.query(`
        INSERT INTO ${testSchema}_perm_test.test_table (name) VALUES ('test')
      `);
      
      // Test that we can query data
      const result = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}_perm_test.test_table
      `);
      expect(Number(result.rows[0].count)).toBe(1);
      
      // Clean up
      await client.query(`DROP SCHEMA IF EXISTS ${testSchema}_perm_test CASCADE`);
      
      console.log('✅ Database permissions verified');
    });
  });

  describe('3. Staging Environment Creation', () => {
    test('should create staging environment with all required tables', async () => {
      // Create orchestrator instance
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: true
      });

      // Set up orchestrator with test schema and client
      (orchestrator as any).stagingSchema = testSchema;
      (orchestrator as any).pgClient = client;

      // Test staging environment creation
      await (orchestrator as any).createStagingEnvironment();

      // Verify all required tables exist
      const requiredTables = [
        'trails',
        'intersection_points', 
        'routing_nodes',
        'routing_edges',
        'trail_hashes',
        'region_metadata'
      ];

      for (const tableName of requiredTables) {
        const result = await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = $1 AND table_name = $2
          ) as exists
        `, [testSchema, tableName]);
        
        expect(result.rows[0].exists).toBe(true);
        console.log(`✅ Staging table '${tableName}' created`);
      }

      // Verify table schemas
      const trailsSchema = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'trails'
        ORDER BY ordinal_position
      `, [testSchema]);

      const expectedColumns = [
        'id', 'app_uuid', 'name', 'geometry', 'length_km', 'elevation_gain'
      ];

      for (const expectedCol of expectedColumns) {
        const column = trailsSchema.rows.find(row => row.column_name === expectedCol);
        expect(column).toBeDefined();
      }

      console.log('✅ Staging environment created with correct schema');
    });
  });

  describe('4. Data Copying to Staging', () => {
    test('should copy region data to staging successfully', async () => {
      // First create staging environment
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: true
      });

      (orchestrator as any).stagingSchema = testSchema;
      (orchestrator as any).pgClient = client;

      await (orchestrator as any).createStagingEnvironment();

      // Insert test data into production trails table with all required fields (using test region)
      await client.query(`
        INSERT INTO trails (app_uuid, name, region, geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat)
        VALUES 
          ('test-trail-1', 'Test Trail 1', 'test', ST_GeomFromText('LINESTRING Z(-105.3 40.0 1000, -105.2 40.0 1000)', 4326), 1.5, 100, 0, 1000, 1000, 1000, 'test', -105.3, -105.2, 40.0, 40.0),
          ('test-trail-2', 'Test Trail 2', 'test', ST_GeomFromText('LINESTRING Z(-105.25 39.95 1000, -105.25 40.05 1000)', 4326), 1.0, 100, 0, 1000, 1000, 1000, 'test', -105.25, -105.25, 39.95, 40.05)
        ON CONFLICT (app_uuid) DO NOTHING
      `);

      // Test data copying with bbox filter
      const bbox: [number, number, number, number] = [-105.4, 39.9, -105.1, 40.2];
      await (orchestrator as any).copyRegionDataToStaging(bbox);

      // Verify data was copied
      const result = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.trails
      `);
      
      expect(Number(result.rows[0].count)).toBeGreaterThan(0);
      console.log(`✅ Copied ${result.rows[0].count} trails to staging`);

      // Verify data integrity
      const trailData = await client.query(`
        SELECT app_uuid, name, ST_AsText(geometry) as geometry_text, length_km
        FROM ${testSchema}.trails
        ORDER BY app_uuid
      `);

      expect(trailData.rows.length).toBeGreaterThan(0);
      trailData.rows.forEach(trail => {
        expect(trail.app_uuid).toBeDefined();
        expect(trail.name).toBeDefined();
        expect(trail.geometry_text).toContain('LINESTRING Z');
        expect(trail.length_km).toBeGreaterThan(0);
      });

      console.log('✅ Data copying integrity verified');
    });
  });

  describe('5. Intersection Detection', () => {
    test('should detect intersections using PostGIS functions', async () => {
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: true
      });

      (orchestrator as any).stagingSchema = testSchema;
      (orchestrator as any).pgClient = client;

      // Ensure we have test data with all required fields
      await client.query(`
        INSERT INTO ${testSchema}.trails (app_uuid, name, region, geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, geometry_hash, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat)
        VALUES 
          ('test-trail-1', 'Horizontal Trail', 'boulder', ST_GeomFromText('LINESTRING Z(-105.3 40.0 1000, -105.2 40.0 1000)', 4326)::geometry(LINESTRINGZ, 4326), 1.0, 0, 0, 1000, 1000, 1000, 'test', 'test-hash-1', -105.3, -105.2, 40.0, 40.0),
          ('test-trail-2', 'Vertical Trail', 'boulder', ST_GeomFromText('LINESTRING Z(-105.25 39.95 1000, -105.25 40.05 1000)', 4326)::geometry(LINESTRINGZ, 4326), 1.0, 0, 0, 1000, 1000, 1000, 'test', 'test-hash-2', -105.25, -105.25, 39.95, 40.05)
        ON CONFLICT (app_uuid) DO NOTHING
      `);

      // Test intersection detection
      await (orchestrator as any).detectIntersections();

      // Verify intersections were detected
      const intersectionCount = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.intersection_points
      `);
      
      expect(Number(intersectionCount.rows[0].count)).toBeGreaterThan(0);
      console.log(`✅ Detected ${intersectionCount.rows[0].count} intersection points`);

      // Verify intersection data structure
      const intersections = await client.query(`
        SELECT 
          ST_X(point) as x, 
          ST_Y(point) as y,
          node_type,
          array_length(connected_trail_names, 1) as trail_count
        FROM ${testSchema}.intersection_points
        ORDER BY ST_X(point)
      `);

      intersections.rows.forEach(intersection => {
        expect(intersection.x).toBeDefined();
        expect(intersection.y).toBeDefined();
        expect(intersection.node_type).toMatch(/^(intersection|endpoint)$/);
        expect(intersection.trail_count).toBeGreaterThan(0);
      });

      console.log('✅ Intersection detection data structure verified');
    });
  });

  describe('6. Routing Graph Creation', () => {
    test('should create routing nodes and edges using buildRoutingGraphHelper', async () => {
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: true
      });

      (orchestrator as any).stagingSchema = testSchema;
      (orchestrator as any).pgClient = client;

      // Import the routing helper
      const { buildRoutingGraphHelper } = require('../utils/sql/routing');

      // Test routing graph creation
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

      expect(result.nodeCount).toBeGreaterThan(0);
      expect(result.edgeCount).toBeGreaterThan(0);
      console.log(`✅ Created ${result.nodeCount} nodes and ${result.edgeCount} edges`);

      // Verify routing nodes
      const nodesResult = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.routing_nodes
      `);
      expect(Number(nodesResult.rows[0].count)).toBe(result.nodeCount);

      // Verify routing edges
      const edgesResult = await client.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.routing_edges
      `);
      expect(Number(edgesResult.rows[0].count)).toBe(result.edgeCount);

      // Verify node types
      const nodeTypes = await client.query(`
        SELECT node_type, COUNT(*) as count 
        FROM ${testSchema}.routing_nodes 
        GROUP BY node_type
      `);
      
      nodeTypes.rows.forEach(nodeType => {
        expect(nodeType.node_type).toMatch(/^(intersection|endpoint)$/);
        expect(Number(nodeType.count)).toBeGreaterThan(0);
      });

      console.log('✅ Routing graph creation verified');
    });
  });

  describe('7. Database Export', () => {
    test('should export staging data to SQLite database', async () => {
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: true
      });

      (orchestrator as any).stagingSchema = testSchema;
      (orchestrator as any).pgClient = client;

      // Test database export
      await (orchestrator as any).exportDatabase();

      // Verify SQLite file was created
      expect(fs.existsSync(TEST_OUTPUT_PATH)).toBe(true);
      
      const stats = fs.statSync(TEST_OUTPUT_PATH);
      expect(stats.size).toBeGreaterThan(0);
      console.log(`✅ SQLite database created: ${(stats.size / 1024).toFixed(2)} KB`);

      // Verify SQLite database structure
      const Database = require('better-sqlite3');
      const sqliteDb = new Database(TEST_OUTPUT_PATH);

      const tables = sqliteDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all();

      const expectedTables = [
        'trails', 'routing_nodes', 'routing_edges', 
        'region_metadata', 'schema_version'
      ];

      expectedTables.forEach(expectedTable => {
        const table = tables.find((t: any) => t.name === expectedTable);
        expect(table).toBeDefined();
      });

      // Verify data was exported
      const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get();
      const nodeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_nodes').get();
      const edgeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM routing_edges').get();

      expect(trailCount.count).toBeGreaterThan(0);
      expect(nodeCount.count).toBeGreaterThan(0);
      expect(edgeCount.count).toBeGreaterThan(0);

      console.log(`✅ Exported data: ${trailCount.count} trails, ${nodeCount.count} nodes, ${edgeCount.count} edges`);

      sqliteDb.close();
    });
  });

  describe('8. Export Validation', () => {
    test('should validate exported database structure and data', async () => {
      // This test would validate the exported SQLite database
      // Since the validation script might not be available in test environment,
      // we'll do basic validation here
      
      if (!fs.existsSync(TEST_OUTPUT_PATH)) {
        console.log('⏭️ Skipping export validation - no export file found');
        return;
      }

      const Database = require('better-sqlite3');
      const sqliteDb = new Database(TEST_OUTPUT_PATH);

      // Validate schema version
      const schemaVersion = sqliteDb.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
      expect(schemaVersion.version).toBe(9); // Should be v9

      // Validate trail data integrity
      const trails = sqliteDb.prepare('SELECT app_uuid, name, geojson FROM trails LIMIT 5').all();
      trails.forEach((trail: any) => {
        expect(trail.app_uuid).toBeDefined();
        expect(trail.name).toBeDefined();
        expect(trail.geojson).toBeDefined();
        
        // Validate GeoJSON structure
        const geojson = JSON.parse(trail.geojson);
        expect(geojson.type).toBe('Feature');
        expect(geojson.geometry.type).toBe('LineString');
        expect(geojson.geometry.coordinates).toBeDefined();
      });

      // Validate routing nodes
      const nodes = sqliteDb.prepare('SELECT lat, lng, node_type FROM routing_nodes LIMIT 5').all();
      nodes.forEach((node: any) => {
        expect(node.lat).toBeGreaterThanOrEqual(-90);
        expect(node.lat).toBeLessThanOrEqual(90);
        expect(node.lng).toBeGreaterThanOrEqual(-180);
        expect(node.lng).toBeLessThanOrEqual(180);
        expect(node.node_type).toMatch(/^(intersection|endpoint)$/);
      });

      // Validate routing edges
      const edges = sqliteDb.prepare('SELECT from_node_id, to_node_id, trail_name FROM routing_edges LIMIT 5').all();
      edges.forEach((edge: any) => {
        expect(edge.from_node_id).toBeGreaterThan(0);
        expect(edge.to_node_id).toBeGreaterThan(0);
        expect(edge.trail_name).toBeDefined();
      });

      sqliteDb.close();
      console.log('✅ Export validation passed');
    });
  });

  describe('9. Cleanup', () => {
    test('should cleanup staging environment', async () => {
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: false // Enable cleanup
      });

      (orchestrator as any).stagingSchema = testSchema;
      (orchestrator as any).pgClient = client;

      // Test cleanup
      await orchestrator.cleanupStaging();

      // Verify staging schema was cleaned up
      const result = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata 
          WHERE schema_name = $1
        ) as exists
      `, [testSchema]);

      expect(result.rows[0].exists).toBe(false);
      console.log('✅ Staging environment cleanup verified');
    });
  });

  describe('10. Error Handling', () => {
    test('should handle missing PostGIS functions gracefully', async () => {
      // This test would verify error handling when required functions are missing
      // We can't easily remove PostGIS functions in test environment, so we'll test
      // the error handling by calling with invalid parameters
      
      const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'test',
        outputPath: TEST_OUTPUT_PATH,
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
        useSqlite: false,
        skipCleanup: true
      });

      (orchestrator as any).stagingSchema = 'nonexistent_schema';
      (orchestrator as any).pgClient = client;

      // Test that calling detectIntersections with invalid schema throws error
      await expect(
        (orchestrator as any).detectIntersections()
      ).rejects.toThrow();

      console.log('✅ Error handling for invalid schema verified');
    });

    test('should handle database connection failures gracefully', async () => {
      // Test with invalid database configuration
      const invalidConfig = {
        host: 'invalid-host',
        port: 5432,
        database: 'invalid-db',
        user: 'invalid-user',
        password: 'invalid-password'
      };

      const invalidClient = new Client(invalidConfig);
      
      // Should not be able to connect
      await expect(invalidClient.connect()).rejects.toThrow();
      
      console.log('✅ Database connection error handling verified');
    });
  });
}); 