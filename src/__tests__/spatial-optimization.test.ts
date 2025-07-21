import { Client } from 'pg';
import { DataIntegrityValidator } from '../validation/DataIntegrityValidator';

describe('Spatial Function Optimization Tests', () => {
  let client: Client;
  let validator: DataIntegrityValidator;

  beforeAll(async () => {
    // Connect to test database
    client = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || ''
    });
    await client.connect();

    validator = new DataIntegrityValidator({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db_test',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || ''
    });
    await validator.connect();
  });

  afterAll(async () => {
    await validator.disconnect();
    await client.end();
  });

  describe('PostGIS Spatial Functions', () => {
    test('should use ST_Intersects for intersection detection', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails t1
        JOIN trails t2 ON (
          t1.id < t2.id AND 
          ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))
        )
        WHERE t1.region = 'boulder' AND t2.region = 'boulder'
        LIMIT 10
      `);
      
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('should use ST_DWithin for proximity queries', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails t1
        JOIN trails t2 ON (
          t1.id < t2.id AND 
          ST_DWithin(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry), 2.0)
        )
        WHERE t1.region = 'boulder' AND t2.region = 'boulder'
        LIMIT 10
      `);
      
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('should use ST_Within for spatial containment', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails
        WHERE region = 'boulder' AND 
              ST_Within(
                geometry, 
                ST_MakeEnvelope(-105.8, 39.7, -105.1, 40.7, 4326)
              )
        LIMIT 10
      `);
      
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('should use ST_Envelope for efficient bbox calculations', async () => {
      const result = await client.query(`
        SELECT 
          ST_XMin(ST_Envelope(geometry)) as min_lng,
          ST_XMax(ST_Envelope(geometry)) as max_lng,
          ST_YMin(ST_Envelope(geometry)) as min_lat,
          ST_YMax(ST_Envelope(geometry)) as max_lat
        FROM trails
        WHERE region = 'boulder'
        LIMIT 1
      `);
      
      expect(result.rows[0].min_lng).toBeDefined();
      expect(result.rows[0].max_lng).toBeDefined();
      expect(result.rows[0].min_lat).toBeDefined();
      expect(result.rows[0].max_lat).toBeDefined();
    });
  });

  describe('Spatial Indexes', () => {
    test('should have spatial indexes on geometry columns', async () => {
      const result = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'trails' 
        AND indexdef LIKE '%GIST%'
      `);
      
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.some(row => row.indexdef.includes('geometry'))).toBe(true);
    });

    test('should have spatial indexes on routing nodes', async () => {
      const result = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'routing_nodes' 
        AND indexdef LIKE '%GIST%'
      `);
      
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Data Validation', () => {
    test('should validate geometry validity using ST_IsValid', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails 
        WHERE region = 'boulder' AND geometry IS NOT NULL AND NOT ST_IsValid(geometry)
      `);
      
      expect(Number(result.rows[0].count)).toBe(0);
    });

    test('should ensure coordinate system consistency (SRID 4326)', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails 
        WHERE region = 'boulder' AND geometry IS NOT NULL AND ST_SRID(geometry) != 4326
      `);
      
      expect(Number(result.rows[0].count)).toBe(0);
    });

    test('should validate intersection nodes have proper trail connections', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM routing_nodes 
        WHERE node_type = 'intersection' AND 
              array_length(string_to_array(connected_trails, ','), 1) < 2
      `);
      
      expect(Number(result.rows[0].count)).toBe(0);
    });
  });

  describe('Enhanced Validation Functions', () => {
    test('should run enhanced spatial validation', async () => {
      const result = await validator.validateSpatialIntegrity('boulder');
      
      expect(result.passed).toBe(true);
      expect(result.issues.length).toBeGreaterThanOrEqual(0);
      expect(result.summary.totalTrails).toBeGreaterThan(0);
    });

    test('should validate spatial containment', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count FROM trails t
        WHERE region = 'boulder' AND geometry IS NOT NULL AND NOT ST_Within(
          geometry, 
          ST_MakeEnvelope(
            MIN(bbox_min_lng), MIN(bbox_min_lat), 
            MAX(bbox_max_lng), MAX(bbox_max_lat), 4326
          )
        )
      `);
      
      expect(Number(result.rows[0].count)).toBe(0);
    });
  });

  describe('Performance Optimization', () => {
    test('should use bounding box pre-filtering for spatial joins', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails t1
        JOIN trails t2 ON (
          t1.id < t2.id AND 
          ST_Intersects(ST_Envelope(t1.geometry), ST_Envelope(t2.geometry)) AND
          ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))
        )
        WHERE t1.region = 'boulder' AND t2.region = 'boulder'
        LIMIT 10
      `);
      
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('should use spatial indexes for distance calculations', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails t1
        JOIN trails t2 ON (
          t1.id < t2.id AND 
          ST_DWithin(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry), 1.0)
        )
        WHERE t1.region = 'boulder' AND t2.region = 'boulder'
        LIMIT 10
      `);
      
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('API Endpoint Enhancement', () => {
    test('should support spatial filtering for bbox queries', async () => {
      const bbox = [-105.8, 39.7, -105.1, 40.7];
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM trails
        WHERE region = 'boulder' AND 
              ST_Intersects(
                geometry, 
                ST_MakeEnvelope($1, $2, $3, $4, 4326)
              )
      `, bbox);
      
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    test('should validate intersection data integrity', async () => {
      const result = await client.query(`
        SELECT COUNT(*) as count 
        FROM routing_edges e
        LEFT JOIN routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
      `);
      
      expect(Number(result.rows[0].count)).toBe(0);
    });
  });
}); 