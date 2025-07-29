import { Client } from 'pg';
import { ElevationService } from '../utils/elevation-service';

describe('Elevation Validation Tests', () => {
  let client: Client;
  let elevationService: ElevationService;

  beforeAll(async () => {
    // Connect to test database
    client = new Client({
      host: process.env.TEST_PGHOST || 'localhost',
      port: parseInt(process.env.TEST_PGPORT || '5432'),
      database: process.env.TEST_PGDATABASE || 'trail_master_db_test',
      user: process.env.TEST_PGUSER || 'tester',
      password: process.env.TEST_PGPASSWORD || '',
    });
    
    await client.connect();
    elevationService = new ElevationService(client);
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  test('should fail validation when trails are missing elevation data', async () => {
    // Create a test schema
    const testSchema = `test_elevation_validation_${Date.now()}`;
    
    try {
      // Create test schema
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Create trails table with missing elevation data
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT,
          name TEXT,
          osm_id TEXT,
          elevation_gain NUMERIC,
          elevation_loss NUMERIC,
          max_elevation NUMERIC,
          min_elevation NUMERIC,
          avg_elevation NUMERIC,
          geometry GEOMETRY(LINESTRING, 4326)
        )
      `);
      
      // Insert test trail with missing elevation data
      await client.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, osm_id, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation, geometry
        ) VALUES (
          'test-trail-1', 'Test Trail Missing Elevation', '123456789',
          NULL, NULL, NULL, NULL, NULL,
          ST_GeomFromText('LINESTRING(-105.2705 40.0150, -105.2706 40.0151)', 4326)
        )
      `);
      
      // Test that validation fails when elevation data is missing
      const validation = await elevationService.validateElevationData(testSchema);
      
      expect(validation.isValid).toBe(false);
      expect(validation.nullElevationCount).toBeGreaterThan(0);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(error => error.includes('missing elevation data'))).toBe(true);
      
      console.log('✅ Elevation validation correctly failed for missing elevation data');
      
    } finally {
      // Clean up
      await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    }
  });

  test('should pass validation when trails have complete elevation data', async () => {
    // Create a test schema
    const testSchema = `test_elevation_validation_${Date.now()}`;
    
    try {
      // Create test schema
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
      
      // Create trails table with complete elevation data
      await client.query(`
        CREATE TABLE ${testSchema}.trails (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT,
          name TEXT,
          osm_id TEXT,
          elevation_gain NUMERIC,
          elevation_loss NUMERIC,
          max_elevation NUMERIC,
          min_elevation NUMERIC,
          avg_elevation NUMERIC,
          geometry GEOMETRY(LINESTRING, 4326)
        )
      `);
      
      // Insert test trail with complete elevation data
      await client.query(`
        INSERT INTO ${testSchema}.trails (
          app_uuid, name, osm_id, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation, geometry
        ) VALUES (
          'test-trail-2', 'Test Trail With Elevation', '123456790',
          100, 50, 2000, 1900, 1950,
          ST_GeomFromText('LINESTRING(-105.2705 40.0150, -105.2706 40.0151)', 4326)
        )
      `);
      
      // Test that validation passes when elevation data is complete
      const validation = await elevationService.validateElevationData(testSchema);
      
      expect(validation.isValid).toBe(true);
      expect(validation.nullElevationCount).toBe(0);
      expect(validation.errors.length).toBe(0);
      
      console.log('✅ Elevation validation correctly passed for complete elevation data');
      
    } finally {
      // Clean up
      await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    }
  });
});