import { Client } from 'pg';
import { ValidationService } from '../utils/validation-service';
import { getTestDbConfig } from '../database/connection';

describe('ValidationService', () => {
  let pgClient: Client;
  let validationService: ValidationService;

  beforeAll(async () => {
    pgClient = new Client(getTestDbConfig());
    await pgClient.connect();
    validationService = new ValidationService(pgClient);
  });

  afterAll(async () => {
    await pgClient.end();
  });

  beforeEach(async () => {
    // Create a test schema for each test
    const testSchema = `test_validation_${Date.now()}`;
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
      const testSchema = `test_validation_${Date.now()}`;
      
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
      const testSchema = `test_validation_${Date.now()}`;
      
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

    it('should fail validation when bbox data is invalid (min >= max)', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      // Insert test trail with invalid bbox data (min_lng >= max_lng)
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES (
          'test-uuid-3', 'Test Trail 3', 'test-region', -104.0, -104.0, 40.0, 41.0
        )
      `);

      const validation = await validationService.validateBboxData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have invalid bbox data');
      expect(validation.invalidBboxCount).toBe(1);
    });
  });

  describe('validateGeometryData', () => {
    it('should pass validation when all trails have valid geometry', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      // Insert test trail with valid geometry
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-4', 'Test Trail 4', 'test-region', 
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326)
        )
      `);

      const validation = await validationService.validateGeometryData(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.emptyGeometryCount).toBe(0);
      expect(validation.invalidGeometryCount).toBe(0);
    });

    it('should fail validation when trails have empty geometry', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      // Insert test trail with empty geometry
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-5', 'Test Trail 5', 'test-region', 
          ST_GeomFromText('LINESTRING EMPTY', 4326)
        )
      `);

      const validation = await validationService.validateGeometryData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have empty or invalid geometry');
      expect(validation.emptyGeometryCount).toBe(1);
    });

    it('should fail validation when trails have wrong geometry type', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      // Insert test trail with point geometry instead of linestring
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, geometry
        ) VALUES (
          'test-uuid-6', 'Test Trail 6', 'test-region', 
          ST_GeomFromText('POINT(-105.0 40.0)', 4326)
        )
      `);

      const validation = await validationService.validateGeometryData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have wrong geometry type');
      expect(validation.invalidGeometryCount).toBe(1);
    });
  });

  describe('validateAllTrailData', () => {
    it('should pass comprehensive validation when all data is valid', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      // Insert test trail with all valid data
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation
        ) VALUES (
          'test-uuid-7', 'Test Trail 7', 'test-region', -105.0, -104.0, 40.0, 41.0,
          ST_GeomFromText('LINESTRING(-105.0 40.0, -104.0 41.0)', 4326),
          100, 50, 2000, 1800, 1900
        )
      `);

      const validation = await validationService.validateAllTrailData(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.summary.totalTrails).toBe(1);
      expect(validation.summary.validTrails).toBe(1);
      expect(validation.summary.invalidTrails).toBe(0);
    });

    it('should fail validation when trails have missing required fields', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      // Insert test trail with missing required fields
      await pgClient.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, region
        ) VALUES (
          'test-uuid-8', '', 'test-region'
        )
      `);

      const validation = await validationService.validateAllTrailData(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 trails have missing required fields');
      expect(validation.summary.invalidTrails).toBe(1);
    });
  });

  describe('validateRoutingGraph', () => {
    it('should pass validation when routing graph is valid', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
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

      // Insert test routing data
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (id, node_type, trail_id, trail_name, geometry) VALUES
        (1, 'intersection', 'trail-1', 'Test Trail', ST_GeomFromText('POINT(-105.0 40.0)', 4326)),
        (2, 'endpoint', 'trail-1', 'Test Trail', ST_GeomFromText('POINT(-104.0 41.0)', 4326))
      `);

      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, distance_km) VALUES
        (1, 2, 'trail-1', 'Test Trail', 1.0)
      `);

      const validation = await validationService.validateRoutingGraph(testSchema);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.nodeCount).toBe(2);
      expect(validation.edgeCount).toBe(1);
      expect(validation.orphanedNodes).toBe(0);
      expect(validation.selfLoops).toBe(0);
    });

    it('should fail validation when routing tables do not exist', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
      const validation = await validationService.validateRoutingGraph(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toBe('Routing tables do not exist');
    });

    it('should detect self-loops in routing edges', async () => {
      const testSchema = `test_validation_${Date.now()}`;
      
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

      // Insert test routing data with self-loop
      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_nodes (id, node_type, trail_id, trail_name, geometry) VALUES
        (1, 'intersection', 'trail-1', 'Test Trail', ST_GeomFromText('POINT(-105.0 40.0)', 4326))
      `);

      await pgClient.query(`
        INSERT INTO ${testSchema}.routing_edges (source, target, trail_id, trail_name, distance_km) VALUES
        (1, 1, 'trail-1', 'Test Trail', 0.0)
      `);

      const validation = await validationService.validateRoutingGraph(testSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toContain('1 self-loops found in routing edges');
      expect(validation.selfLoops).toBe(1);
    });
  });
});