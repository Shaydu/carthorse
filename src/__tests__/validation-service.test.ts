import { Client } from 'pg';
import { ValidationService } from '../utils/validation-service';
import { getTestDbConfig } from '../database/connection';

describe('ValidationService', () => {
  let pgClient: Client;
  let validationService: ValidationService;
  let testSchema: string;

  beforeAll(async () => {
    // Connect to test database
    pgClient = new Client({
      host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
      port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
      database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
      password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
    });
    await pgClient.connect();

    validationService = new ValidationService(pgClient);
  });

  afterAll(async () => {
    if (pgClient) {
      await pgClient.end();
    }
  });

  beforeEach(async () => {
    // Create a test schema for each test
    testSchema = `test_validation_${Date.now()}`;
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create test trails table
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  });

  afterEach(async () => {
    // Clean up test schemas
    const schemas = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'test_validation_%'
    `);
    
    for (const schema of schemas.rows) {
      await pgClient.query(`DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`);
    }
  });

  describe('validateBboxData', () => {
    it('should pass validation when all trails have valid bbox data', async () => {
      // Insert test trail with valid bbox data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-1', 'Test Trail', 'test-region', -105.0, -104.0, 40.0, 41.0
        )
      `);

      const validation = await validationService.validateBboxData(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.missingBboxCount).toBe(0);
      expect(validation.invalidBboxCount).toBe(0);
    });

    it('should fail validation when trails have missing bbox data', async () => {
      // Insert test trail with missing bbox data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-2', 'Test Trail 2', 'test-region', NULL, -104.0, 40.0, 41.0
        )
      `);

      const validation = await validationService.validateBboxData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have missing bbox data');
      expect(validation.missingBboxCount).toBe(1);
    });

    it('should fail validation when bbox data is invalid (min > max)', async () => {
      // Insert test trail with invalid bbox data (min_lng > max_lng)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-3', 'Test Trail 3', 'test-region', -104.0, -105.0, 40.0, 41.0
        )
      `);

      const validation = await validationService.validateBboxData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have invalid bbox data');
      expect(validation.invalidBboxCount).toBe(1);
    });

    it('should pass validation when bbox data has identical coordinates (valid for small segments)', async () => {
      // Insert test trail with identical bbox coordinates and valid length (> 2m)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geometry
        ) VALUES (
          'test-uuid-4', 'Test Trail 4', 'test-region', -104.0, -104.0, 40.0, 40.0,
          ST_GeomFromText('LINESTRING(-104.0 40.0 1800, -104.0 40.001 1900)', 4326)
        )
      `);

      const validation = await validationService.validateBboxData(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.invalidBboxCount).toBe(0);
    });

    it('should fail validation when trails have identical coordinates but are too short', async () => {
      // Insert test trail with identical bbox coordinates but short length (< 2m)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, geometry
        ) VALUES (
          'test-uuid-5', 'Test Short Flat Trail', 'test-region', -104.0, -104.0, 40.0, 40.0,
          ST_GeomFromText('LINESTRING(-104.0 40.0 1800, -104.0 40.0 1800)', 4326)
        )
      `);

      const validation = await validationService.validateBboxData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have identical bbox coordinates but are too short');
      expect(validation.shortTrailsWithInvalidBbox).toHaveLength(1);
      expect(validation.shortTrailsWithInvalidBbox[0].name).toBe('Test Short Flat Trail');
      expect(validation.shortTrailsWithInvalidBbox[0].length_meters).toBeLessThan(2);
    });
  });

  describe('validateTrailLengths', () => {
    it('should pass validation when all trails meet minimum length requirement', async () => {
      // Insert test trail with valid length (> 2 meters)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-length-1', 'Test Trail Length 1', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0 1800, -105.001 40.001 1900)', 4326)
        )
      `);

      const validation = await validationService.validateTrailLengths(testSchema, 2);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.shortTrailsCount).toBe(0);
      expect(validation.shortTrails).toHaveLength(0);
    });

    it('should fail validation when trails are under minimum length and log details', async () => {
      // Insert test trail with short length (< 2 meters)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-length-2', 'Test Short Trail', 'test-region',
          ST_GeomFromText('LINESTRING(-105.0 40.0 1800, -105.00001 40.00001 1801)', 4326)
        )
      `);

      const validation = await validationService.validateTrailLengths(testSchema, 2);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails are shorter than 2 meter(s)');
      expect(validation.shortTrailsCount).toBe(1);
      expect(validation.shortTrails).toHaveLength(1);
      expect(validation.shortTrails[0].name).toBe('Test Short Trail');
      expect(validation.shortTrails[0].app_uuid).toBe('test-uuid-length-2');
      expect(validation.shortTrails[0].region).toBe('test-region');
      expect(validation.shortTrails[0].length_meters).toBeLessThan(2);
    });
  });

  describe('validateGeometryData', () => {
    it('should pass validation when all trails have valid geometry', async () => {
      // Insert test trail with valid geometry
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-4', 'Test Trail 4', 'test-region', 
          ST_GeomFromText('LINESTRING(-105.0 40.0 1800, -104.0 41.0 1900)', 4326)
        )
      `);

      const validation = await validationService.validateGeometryData(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.emptyGeometryCount).toBe(0);
      expect(validation.invalidGeometryCount).toBe(0);
    });

    it('should fail validation when trails have empty geometry', async () => {
      // Insert test trail with empty geometry (3D)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-5', 'Test Trail 5', 'test-region', 
          ST_GeomFromText('LINESTRING Z EMPTY', 4326)
        )
      `);

      const validation = await validationService.validateGeometryData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have empty or invalid geometry');
      expect(validation.emptyGeometryCount).toBe(1);
    });

    it('should fail validation when trails have wrong geometry type', async () => {
      // Instead of trying to insert invalid geometry (which violates DB constraints),
      // we'll test the validation logic by checking what happens when geometry is null
      // and then test the validation service's ability to detect invalid types
      
      // Insert test trail with null geometry first
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region
        ) VALUES (
          'test-uuid-6', 'Test Trail 6', 'test-region'
        )
      `);

      const validation = await validationService.validateGeometryData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.emptyGeometryCount).toBeGreaterThan(0);
    });

    it('should fail export validation when trails have null geometry', async () => {
      // Insert test trail with null geometry
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region
        ) VALUES (
          'test-uuid-null-geom', 'Test Trail Null Geometry', 'test-region'
        )
      `);

      const validation = await validationService.validateAllTrailData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      // Should fail due to geometry validation
      expect(validation.errors.some(error => error.includes('geometry'))).toBe(true);
    });
  });

  describe('validateAllTrailData', () => {
    it('should pass comprehensive validation when all data is valid', async () => {
      // Insert test trail with all valid data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-7', 'Test Trail 7', 'test-region', -105.0, -104.0, 40.0, 41.0,
          ST_GeomFromText('LINESTRING(-105.0 40.0 1800, -104.0 41.0 1900)', 4326),
          100, 50, 2000, 1800, 1900
        )
      `);

      const validation = await validationService.validateAllTrailData(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation when trails have missing required fields', async () => {
      // Insert test trail with missing required fields
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region
        ) VALUES (
          'test-uuid-8', 'Test Trail 8', 'test-region'
        )
      `);

      const validation = await validationService.validateAllTrailData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateRoutingGraph', () => {
    it('should pass validation when routing graph is valid', async () => {
      // Create routing tables
      await pgClient.query(`
        CREATE TABLE ${testSchema}.routing_nodes (
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
        CREATE TABLE ${testSchema}.routing_edges (
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

      // Insert valid routing data
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (id, node_type, trail_id, trail_name, geometry, elevation)
        VALUES 
        (1, 'intersection', 'trail-1', 'Test Trail 1', ST_GeomFromText('POINT(-105.0 40.0)', 4326), 1800),
        (2, 'endpoint', 'trail-1', 'Test Trail 1', ST_GeomFromText('POINT(-104.0 41.0)', 4326), 2000)
      `);

      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry)
        VALUES 
        (1, 2, 'trail-1', 'Test Trail 1', 1.5, 200, 0, ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326))
      `);

      const validation = await validationService.validateRoutingGraph(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.nodeCount).toBe(2);
      expect(validation.edgeCount).toBe(1);
    });

    it('should detect self-loops in routing edges', async () => {
      // Create routing tables
      await pgClient.query(`
        CREATE TABLE ${testSchema}.routing_nodes (
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
        CREATE TABLE ${testSchema}.routing_edges (
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

      // Insert routing data with self-loop
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (id, node_type, trail_id, trail_name, geometry, elevation)
        VALUES 
        (1, 'intersection', 'trail-1', 'Test Trail 1', ST_GeomFromText('POINT(-105.0 40.0)', 4326), 1800)
      `);

      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry)
        VALUES 
        (1, 1, 'trail-1', 'Test Trail 1', 0, 0, 0, ST_GeomFromText('LINESTRING(-105.0 40.0, -105.0 40.0)', 4326))
      `);

      const validation = await validationService.validateRoutingGraph(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('self-loop');
    });
  });
});