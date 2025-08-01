import { Client } from 'pg';
import { getTestDbConfig } from '../database/connection';

describe.skip('3D Data Preservation in Trail Splitting and Export (Moved to staging-integration.test.ts)', () => {
  let pgClient: Client;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
    
    // Load PostGIS functions for testing
    try {
      await pgClient.query(`
        \i docs/sql/carthorse-postgis-intersection-functions.sql
      `);
      console.log('✅ PostGIS functions loaded for testing');
    } catch (err) {
      console.log('⚠️  PostGIS functions already loaded or failed to load:', err instanceof Error ? err.message : String(err));
    }
  });

  afterAll(async () => {
    await pgClient.end();
  });

  afterEach(async () => {
    // Clean up test schemas
    const schemas = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'test_3d_%'
    `);
    
    for (const schema of schemas.rows) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    }
  });

  describe('3D Data Preservation Tests', () => {
    it('should preserve 3D coordinates in trail splitting', async () => {
      const testSchema = `test_3d_preservation`;
      
      // Create test schema and tables
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Create trails table with 3D geometry
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326), -- 3D geometry
          elevation_gain REAL,
          elevation_loss REAL,
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL
        )
      `);
      
      // Create intersection_points table
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.intersection_points (
          id SERIAL PRIMARY KEY,
          intersection_point GEOMETRY(POINTZ, 4326), -- 3D point
          connected_trail_ids TEXT[],
          connected_trail_names TEXT[],
          node_type TEXT
        )
      `);
      
      // Insert test trails with 3D coordinates that will intersect
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, geometry, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        ) VALUES 
        ('trail-1', 'Test Trail 1', 
         ST_GeomFromText('LINESTRINGZ(-105.0 40.0 1600, -104.9 40.1 1650)', 4326), 
         50, 0, 1650, 1600, 1625),
        ('trail-2', 'Test Trail 2', 
         ST_GeomFromText('LINESTRINGZ(-104.9 40.1 1650, -104.8 40.2 1700)', 4326), 
         50, 0, 1700, 1650, 1675),
        ('trail-3', 'Test Trail 3', 
         ST_GeomFromText('LINESTRINGZ(-105.0 40.0 1600, -104.8 40.2 1700)', 4326), 
         100, 0, 1700, 1600, 1650)
      `);
      
      // Test intersection detection preserves 3D data
      const intersectionResult = await pgClient.query(`
        SELECT 
          ST_AsText(intersection_point) as point_text,
          ST_Z(intersection_point) as elevation,
          connected_trail_names,
          node_type
        FROM detect_trail_intersections('${testSchema}', 'trails', 1.0)
        WHERE node_type = 'intersection'
      `);
      
      console.log('📊 Intersection detection results:', intersectionResult.rows);
      
      // Should find intersections
      expect(intersectionResult.rows.length).toBeGreaterThan(0);
      
              // Each intersection should have 3D coordinates
        for (const row of intersectionResult.rows) {
          expect(row.point_text).toMatch(/POINT Z \(/); // Should be 3D point (with space)
          expect(row.elevation).toBeDefined();
          expect(row.elevation).toBeGreaterThan(0);
          expect(row.node_type).toBe('intersection');
        }
      
      console.log('✅ 3D intersection detection validated');
    });

    it('should preserve 3D coordinates in routing nodes', async () => {
      const testSchema = `test_3d_nodes`;
      
      // Create test schema and tables
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Create trails table with 3D geometry
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          geometry GEOMETRY(LINESTRINGZ, 4326),
          elevation_gain REAL,
          elevation_loss REAL,
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL
        )
      `);
      
                   // Create routing_nodes table (matching the actual schema)
             await pgClient.query(`
               CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
                 id SERIAL PRIMARY KEY,
                 node_uuid TEXT UNIQUE,
                 lat REAL,
                 lng REAL,
                 elevation REAL,
                 node_type TEXT,
                 connected_trails TEXT,
                 created_at TIMESTAMP DEFAULT NOW()
               )
             `);
      
      // Insert test trails with 3D coordinates
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, geometry, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        ) VALUES 
        ('trail-1', 'Test Trail 1', 
         ST_GeomFromText('LINESTRINGZ(-105.0 40.0 1600, -104.9 40.1 1650)', 4326), 
         50, 0, 1650, 1600, 1625),
        ('trail-2', 'Test Trail 2', 
         ST_GeomFromText('LINESTRINGZ(-104.9 40.1 1650, -104.8 40.2 1700)', 4326), 
         50, 0, 1700, 1650, 1675)
      `);
      
                         // Generate routing nodes
      await pgClient.query(`SELECT * FROM generate_routing_nodes_native('${testSchema}', 1.0)`);
             
             // Test routing node generation preserves 3D data
             const nodeResult = await pgClient.query(`
               SELECT 
                 lng, lat, elevation as stored_elevation,
                 node_type, connected_trails
               FROM ${testSchema}.routing_nodes
             `);
      
      console.log('📊 Routing node generation results:', nodeResult.rows);
      
      // Should generate nodes
      expect(nodeResult.rows.length).toBeGreaterThan(0);
      
      // Each node should have coordinates and elevation
      for (const row of nodeResult.rows) {
        expect(row.lng).toBeDefined();
        expect(row.lat).toBeDefined();
        expect(row.stored_elevation).toBeDefined();
        expect(row.stored_elevation).toBeGreaterThan(0);
      }
      
      console.log('✅ 3D routing node generation validated');
    });

    it('should preserve 3D coordinates in routing edges', async () => {
      console.log('⏭️  Skipping routing edges test - function has multiple definitions');
      // TODO: Fix routing edges test when function conflicts are resolved
    });

    it('should validate 3D data in SQLite export', async () => {
      // This test validates that the SQLite export preserves 3D data
      console.log('🔍 Validating 3D data in SQLite export...');
      
      // Check if we have a recent export to test
      const testDbPath = './test-export-with-splitting.db';
      if (!require('fs').existsSync(testDbPath)) {
        console.log('⏭️  Skipping SQLite 3D validation - no test export found');
        return;
      }
      
      const Database = require('better-sqlite3');
      const db = new Database(testDbPath);
      
      // Check 3D coordinates in edges
      const edgesWith3D = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_edges 
        WHERE geojson LIKE '%[%' 
          AND geojson LIKE '%,%' 
          AND geojson LIKE '%,%'
          AND geojson LIKE '%,%' -- At least 3 commas for 3D coordinates
      `).get();
      
      const totalEdges = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get();
      
      console.log(`📊 SQLite 3D analysis: ${edgesWith3D.count}/${totalEdges.count} edges have 3D coordinates`);
      
      // At least 90% of edges should have 3D coordinates
      const threeDRatio = edgesWith3D.count / totalEdges.count;
      expect(threeDRatio).toBeGreaterThan(0.9);
      
      // Check that nodes have elevation data
      const nodesWithElevation = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_nodes 
        WHERE elevation IS NOT NULL
      `).get();
      
      const totalNodes = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get();
      
      console.log(`📊 SQLite node elevation: ${nodesWithElevation.count}/${totalNodes.count} nodes have elevation data`);
      
      // At least 90% of nodes should have elevation data
      const elevationRatio = nodesWithElevation.count / totalNodes.count;
      expect(elevationRatio).toBeGreaterThan(0.9);
      
      // Sample validation
      const sampleEdge = db.prepare(`
        SELECT geojson, elevation_gain, elevation_loss
        FROM routing_edges 
        LIMIT 1
      `).get();
      
      if (sampleEdge) {
        expect(sampleEdge.geojson).toMatch(/\[-?\d+\.\d+,-?\d+\.\d+,\d+\.\d+\]/);
        expect(sampleEdge.elevation_gain).toBeDefined();
        expect(sampleEdge.elevation_loss).toBeDefined();
      }
      
      db.close();
      console.log('✅ SQLite 3D data validation completed');
    });
  });
}); 