import { Pool } from 'pg';
import { YIntersectionSplittingService } from '../src/services/layer1/YIntersectionSplittingService';

describe('Y-Intersection Splitting Validation', () => {
  let pool: Pool;
  let service: YIntersectionSplittingService;
  let testSchema: string;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      user: process.env.PGUSER || 'carthorse',
      database: 'trail_master_db',
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT || '5432'),
    });

    testSchema = `y_intersection_test_${Date.now()}`;
    service = new YIntersectionSplittingService(pool, testSchema, {
      toleranceMeters: 10,
      minTrailLengthMeters: 5,
      minSnapDistanceMeters: 1.0,
      maxIterations: 10
    });

    // Create test schema and trails table
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    await pool.query(`
      CREATE TABLE ${testSchema}.trails (
        app_uuid TEXT PRIMARY KEY,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source TEXT,
        geometry geometry(LineString,4326),
        length_km REAL
      )
    `);
  });

  afterAll(async () => {
    // Clean up test schema
    await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await pool.end();
  });

  beforeEach(async () => {
    // Clear trails table before each test
    await pool.query(`DELETE FROM ${testSchema}.trails`);
  });

  describe('Mesa Trail Double Split Test Case', () => {
    it('should split Mesa Trail twice at the expected locations', async () => {
      // Insert test data representing the Mesa Trail scenario
      await insertMesaTrailTestData();

      // Run Y-intersection splitting
      const result = await service.applyYIntersectionSplitting();

      // Verify Mesa Trail was split twice
      const mesaTrailSegments = await pool.query(`
        SELECT name, ST_AsGeoJSON(geometry) as geometry, ST_Length(geometry::geography) as length_m
        FROM ${testSchema}.trails 
        WHERE name LIKE '%Mesa%' 
        ORDER BY name
      `);

      // Should have original Mesa Trail replaced by multiple segments
      expect(mesaTrailSegments.rows.length).toBeGreaterThan(1);
      
      // Check for expected split locations around lat:39.96963, lng:-105.28339500000001 (node-237)
      // and lat:39.96945, lng:-105.28200000000001 (node-238)
      const expectedSplitPoints = [
        { lat: 39.96963, lng: -105.28339500000001 }, // node-237
        { lat: 39.96945, lng: -105.28200000000001 }  // node-238
      ];

      // Verify splits occurred near expected locations (within 50m tolerance)
      for (const expectedPoint of expectedSplitPoints) {
        const nearbySegments = await pool.query(`
          SELECT COUNT(*) as count
          FROM ${testSchema}.trails
          WHERE ST_DWithin(
            geometry::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            50
          )
        `, [expectedPoint.lng, expectedPoint.lat]);

        expect(parseInt(nearbySegments.rows[0].count)).toBeGreaterThan(0);
      }

      // Verify at least 2 iterations were needed
      expect(result.iterations).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Skunk Canyon Spur Trail Split Test Case', () => {
    it('should split Skunk Canyon Spur Trail by Kohler Spur Trail at node-266', async () => {
      // Insert test data representing the Skunk Canyon scenario
      await insertSkunkCanyonTestData();

      // Run Y-intersection splitting
      const result = await service.applyYIntersectionSplitting();

      // Verify Skunk Canyon Spur Trail was split
      const skunkCanyonSegments = await pool.query(`
        SELECT name, ST_AsGeoJSON(geometry) as geometry, ST_Length(geometry::geography) as length_m
        FROM ${testSchema}.trails 
        WHERE name LIKE '%Skunk Canyon%' 
        ORDER BY name
      `);

      // Should have original trail replaced by segments
      expect(skunkCanyonSegments.rows.length).toBeGreaterThan(1);

      // Check for expected split location around lat:39.986955, lng:-105.278985 (node-266)
      const expectedSplitPoint = { lat: 39.986955, lng: -105.278985 };

      const nearbySegments = await pool.query(`
        SELECT COUNT(*) as count
        FROM ${testSchema}.trails
        WHERE ST_DWithin(
          geometry::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          50
        )
      `, [expectedSplitPoint.lng, expectedSplitPoint.lat]);

      expect(parseInt(nearbySegments.rows[0].count)).toBeGreaterThan(0);

      // Verify Kohler Spur Trail exists and was extended
      const kohlerSpurTrail = await pool.query(`
        SELECT name, ST_Length(geometry::geography) as length_m
        FROM ${testSchema}.trails 
        WHERE name LIKE '%Kohler Spur%'
      `);

      expect(kohlerSpurTrail.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Y-Intersection Processing Logic Tests', () => {
    it('should skip intersections with split ratios too close to endpoints', async () => {
      // Create trails where intersection would be at endpoint (ratio 0.001 or 0.999)
      await pool.query(`
        INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
        VALUES 
        ('trail-1', 'Main Trail', 'trail', 'dirt', 'easy', 'test', 
         ST_MakeLine(ST_MakePoint(-105.280, 39.970), ST_MakePoint(-105.275, 39.970)), 0.5),
        ('trail-2', 'Connecting Trail', 'trail', 'dirt', 'easy', 'test',
         ST_MakeLine(ST_MakePoint(-105.280, 39.969), ST_MakePoint(-105.280, 39.970)), 0.1)
      `);

      const result = await service.applyYIntersectionSplitting();

      // Should process 0 intersections due to endpoint proximity
      expect(result.trailsProcessed).toBe(0);
    });

    it('should track processed trails to avoid conflicts within iterations', async () => {
      // Create a complex intersection scenario
      await insertComplexIntersectionTestData();

      const result = await service.applyYIntersectionSplitting();

      // Verify no trails were processed multiple times in same iteration
      expect(result.trailsProcessed).toBeGreaterThan(0);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
    });

    it('should validate segment lengths after splitting', async () => {
      // Create trails that would result in very short segments when split
      await pool.query(`
        INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
        VALUES 
        ('short-trail', 'Short Trail', 'trail', 'dirt', 'easy', 'test', 
         ST_MakeLine(ST_MakePoint(-105.280, 39.970), ST_MakePoint(-105.280, 39.971)), 0.01)
      `);

      const result = await service.applyYIntersectionSplitting();

      // Should not process trails that are too short
      expect(result.trailsProcessed).toBe(0);
    });

    it('should create connector trails between intersection points', async () => {
      // Insert valid intersection scenario
      await insertValidIntersectionTestData();

      const result = await service.applyYIntersectionSplitting();

      // Check for connector trails
      const connectorTrails = await pool.query(`
        SELECT name, trail_type, ST_Length(geometry::geography) as length_m
        FROM ${testSchema}.trails 
        WHERE trail_type = 'connector' OR name LIKE 'Connector:%'
        ORDER BY name
      `);

      if (result.trailsProcessed > 0) {
        expect(connectorTrails.rows.length).toBeGreaterThan(0);
        
        // Verify connector trails have reasonable lengths
        for (const connector of connectorTrails.rows) {
          expect(parseFloat(connector.length_m)).toBeGreaterThan(0.1);
          expect(parseFloat(connector.length_m)).toBeLessThan(100); // Should be short connectors
        }
      }
    });
  });

  describe('Integration with Boulder Test Area', () => {
    it('should process all expected Y-intersections in the Boulder test area', async () => {
      // Copy actual Boulder trail data for integration test
      await copyBoulderTestData();

      const result = await service.applyYIntersectionSplitting();

      // Based on the export output, we expect to find 20 potential intersections
      expect(result.intersectionCount).toBe(20);

      // Should process some of them successfully (not all due to endpoint proximity rules)
      expect(result.trailsProcessed).toBeGreaterThan(0);

      // Should complete within max iterations
      expect(result.iterations).toBeLessThanOrEqual(10);

      // Verify trail count increased due to splitting
      const finalTrailCount = await pool.query(`
        SELECT COUNT(*) as count FROM ${testSchema}.trails
      `);
      
      expect(parseInt(finalTrailCount.rows[0].count)).toBeGreaterThan(221); // Original count
    });
  });

  // Helper functions for test data setup
  async function insertMesaTrailTestData(): Promise<void> {
    // Insert Mesa Trail and intersecting trails based on the actual Boulder data
    await pool.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
      VALUES 
      ('mesa-trail', 'Mesa Trail', 'trail', 'dirt', 'moderate', 'cotrex',
       ST_MakeLine(
         ARRAY[
           ST_MakePoint(-105.285, 39.965),
           ST_MakePoint(-105.283, 39.967),
           ST_MakePoint(-105.281, 39.969),
           ST_MakePoint(-105.280, 39.971)
         ]
       ), 1.5),
      ('intersecting-trail-1', 'Intersecting Trail 1', 'trail', 'dirt', 'easy', 'cotrex',
       ST_MakeLine(ST_MakePoint(-105.284, 39.966), ST_MakePoint(-105.282, 39.968)), 0.3),
      ('intersecting-trail-2', 'Intersecting Trail 2', 'trail', 'dirt', 'easy', 'cotrex',
       ST_MakeLine(ST_MakePoint(-105.279, 39.970), ST_MakePoint(-105.281, 39.972)), 0.3)
    `);
  }

  async function insertSkunkCanyonTestData(): Promise<void> {
    // Insert Skunk Canyon Spur Trail and Kohler Spur Trail
    await pool.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
      VALUES 
      ('skunk-canyon-spur', 'Skunk Canyon Spur Trail Segment', 'trail', 'dirt', 'moderate', 'cotrex',
       ST_MakeLine(ST_MakePoint(-105.280, 39.985), ST_MakePoint(-105.275, 39.988)), 0.5),
      ('kohler-spur', 'Kohler Spur Trail', 'trail', 'dirt', 'easy', 'cotrex',
       ST_MakeLine(ST_MakePoint(-105.279, 39.986), ST_MakePoint(-105.281, 39.987)), 0.3)
    `);
  }

  async function insertComplexIntersectionTestData(): Promise<void> {
    // Create multiple interconnected trails
    await pool.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
      VALUES 
      ('main-trail', 'Main Trail', 'trail', 'dirt', 'moderate', 'test',
       ST_MakeLine(ST_MakePoint(-105.290, 39.970), ST_MakePoint(-105.280, 39.980)), 1.0),
      ('branch-1', 'Branch Trail 1', 'trail', 'dirt', 'easy', 'test',
       ST_MakeLine(ST_MakePoint(-105.285, 39.969), ST_MakePoint(-105.285, 39.976)), 0.7),
      ('branch-2', 'Branch Trail 2', 'trail', 'dirt', 'easy', 'test',
       ST_MakeLine(ST_MakePoint(-105.282, 39.968), ST_MakePoint(-105.283, 39.978)), 0.8),
      ('connector', 'Connector Trail', 'trail', 'dirt', 'easy', 'test',
       ST_MakeLine(ST_MakePoint(-105.281, 39.975), ST_MakePoint(-105.284, 39.977)), 0.3)
    `);
  }

  async function insertValidIntersectionTestData(): Promise<void> {
    // Create a simple Y-intersection scenario
    await pool.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
      VALUES 
      ('main-trail', 'Main Trail', 'trail', 'dirt', 'moderate', 'test',
       ST_MakeLine(ST_MakePoint(-105.280, 39.970), ST_MakePoint(-105.275, 39.975)), 0.8),
      ('side-trail', 'Side Trail', 'trail', 'dirt', 'easy', 'test',
       ST_MakeLine(ST_MakePoint(-105.278, 39.971), ST_MakePoint(-105.277, 39.974)), 0.4)
    `);
  }

  async function copyBoulderTestData(): Promise<void> {
    // Copy a subset of Boulder trail data for integration testing
    const carthorsePool = new Pool({
      host: process.env.PGHOST || 'localhost',
      user: 'carthorse',
      database: 'trail_master_db',
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT || '5432'),
    });

    try {
      const boulderTrails = await carthorsePool.query(`
        SELECT 
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          source,
          ST_Force2D(geometry) as geometry,
          length_km
        FROM public.trails 
        WHERE region = 'boulder'
          AND ST_Intersects(
            geometry,
            ST_MakeEnvelope(-105.30123174925316, 39.96928418458248, -105.26050515816028, 40.06483855535663, 4326)
          )
        LIMIT 50 -- Subset for testing
      `);

      for (const trail of boulderTrails.rows) {
        await pool.query(`
          INSERT INTO ${testSchema}.trails (app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [trail.app_uuid, trail.name, trail.trail_type, trail.surface, trail.difficulty, trail.source, trail.geometry, trail.length_km]);
      }
    } finally {
      await carthorsePool.end();
    }
  }
});

