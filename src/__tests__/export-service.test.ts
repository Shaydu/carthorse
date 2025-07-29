import { Client } from 'pg';
import { ExportService } from '../utils/export-service';
import { getTestDbConfig } from '../database/connection';
import * as fs from 'fs';
import * as path from 'path';

describe('ExportService', () => {
  let pgClient: Client;
  let exportService: ExportService;
  let testDbPath: string;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
    testDbPath = './test-export.db';
    exportService = new ExportService(pgClient, {
      sqliteDbPath: testDbPath,
      maxDbSizeMB: 100,
      validate: true,
      region: 'test-region'
    });
  });

  afterAll(async () => {
    await pgClient.end();
    // Clean up test database file
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  beforeEach(async () => {
    // Create a test schema for each test
    const testSchema = `test_export_${Date.now()}`;
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create test trails table with PostGIS
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

    // Create test routing tables
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_type TEXT NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        geometry GEOMETRY(POINT, 4326),
        elevation REAL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        source INTEGER NOT NULL,
        target INTEGER NOT NULL,
        trail_id TEXT,
        trail_name TEXT,
        distance_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        geometry GEOMETRY(LINESTRING, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  });

  afterEach(async () => {
    // Clean up test schemas
    const schemas = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'test_export_%'
    `);
    
    for (const schema of schemas.rows) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    }

    // Clean up test database file
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('exportDatabase', () => {
    it('should export trails to SQLite database', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, osm_id, osm_type, length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          difficulty, surface_type, trail_type, geometry,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-1', 'Test Trail', 'test-region', '123', 'way', 1.5,
          100, 50, 2000, 1800, 1900,
          'easy', 'dirt', 'hiking',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326),
          -105.0, -104.0, 40.0, 41.0
        )
      `);

      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);
      expect(result.nodesExported).toBe(0);
      expect(result.edgesExported).toBe(0);
      expect(result.dbSizeMB).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify SQLite database was created
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should export routing nodes and edges when available', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-2', 'Test Trail 2', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326)
        )
      `);

      // Insert test routing nodes
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (
          id, node_type, trail_id, trail_name, geometry, elevation
        ) VALUES
        (1, 'intersection', 'test-uuid-2', 'Test Trail 2', ST_GeomFromText('POINT(-105.0 40.0)', 4326), 1800),
        (2, 'endpoint', 'test-uuid-2', 'Test Trail 2', ST_GeomFromText('POINT(-104.0 41.0)', 4326), 2000)
      `);

      // Insert test routing edges
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_edges (
          source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry
        ) VALUES (
          1, 2, 'test-uuid-2', 'Test Trail 2', 1.5, 200, 0,
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326)
        )
      `);

      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);
      expect(result.nodesExported).toBe(2);
      expect(result.edgesExported).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when no trails are found', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(false);
      expect(result.trailsExported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('No trails found to export');
    });

    it('should handle null elevation values correctly', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail with null elevation data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, osm_id, osm_type, length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          difficulty, surface_type, trail_type, geometry,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-3', 'Test Trail 3', 'test-region', '123', 'way', 1.5,
          NULL, NULL, NULL, NULL, NULL,
          'easy', 'dirt', 'hiking',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326),
          -105.0, -104.0, 40.0, 41.0
        )
      `);

      const result = await exportService.exportDatabase(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('exportStagingData', () => {
    it('should export staging data to SQLite database', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, osm_id, osm_type, length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          difficulty, surface_type, trail_type, geometry,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-4', 'Test Trail 4', 'test-region', '123', 'way', 1.5,
          100, 50, 2000, 1800, 1900,
          'easy', 'dirt', 'hiking',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326),
          -105.0, -104.0, 40.0, 41.0
        )
      `);

      const result = await exportService.exportStagingData(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);
      expect(result.nodesExported).toBe(0);
      expect(result.edgesExported).toBe(0);
      expect(result.dbSizeMB).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing routing tables gracefully', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail data only (no routing tables)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-5', 'Test Trail 5', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326)
        )
      `);

      const result = await exportService.exportStagingData(testSchema);

      expect(result.isValid).toBe(true);
      expect(result.trailsExported).toBe(1);
      expect(result.nodesExported).toBe(0);
      expect(result.edgesExported).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when trails table does not exist', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      const result = await exportService.exportStagingData(testSchema);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Trails table not found in schema');
    });
  });

  describe('validateExport', () => {
    it('should validate exported database successfully', async () => {
      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-6', 'Test Trail 6', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326)
        )
      `);

      // Export database first
      await exportService.exportDatabase(testSchema);

      // Validate the export
      const isValid = await exportService['validateExport']();

      expect(isValid).toBe(true);
    });

    it('should fail validation when database size exceeds limit', async () => {
      const largeDbService = new ExportService(pgClient, {
        sqliteDbPath: testDbPath,
        maxDbSizeMB: 0.001, // Very small limit
        validate: true,
        region: 'test-region'
      });

      const testSchema = `test_export_${Date.now()}`;
      
      // Insert test trail data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-7', 'Test Trail 7', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326)
        )
      `);

      // Export database first
      await largeDbService.exportDatabase(testSchema);

      // Validate the export
      const isValid = await largeDbService['validateExport']();

      expect(isValid).toBe(false);
    });
  });
});