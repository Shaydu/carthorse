import { Client } from 'pg';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';

// Static values that were hardcoded in SQL before
const STATIC_VALUES = {
  intersectionTolerance: 2.0,  // Updated to match new YAML config
  edgeTolerance: 2.0,          // Updated to match new YAML config
  simplifyTolerance: 0.001,
  batchSize: 1000,
  timeoutMs: 30000,
  maxRoutesPerBin: 10,
  minRouteScore: 0.3,          // Updated to match YAML config
  minRouteDistanceKm: 1.0,
  maxRouteDistanceKm: 20.0,    // Updated to match YAML config
  minElevationGainMeters: 10,
  maxElevationGainMeters: 5000,
  distanceWeight: 0.4,
  elevationWeight: 0.3,
  qualityWeight: 0.3,
  steepnessWeight: 2.0,
  routingDistanceWeight: 0.5
};

// Helper function to read YAML config
function readYamlConfig(filePath: string): any {
  try {
    const fileContents = readFileSync(filePath, 'utf8');
    return load(fileContents);
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error}`);
  }
}

describe('SQL Config Functions', () => {
  let client: Client;
  let yamlValues: any;

  beforeAll(async () => {
    // Read YAML configs to compare with SQL function results
    const globalConfig = readYamlConfig('configs/carthorse.config.yaml');
const routeConfig = readYamlConfig('configs/route-discovery.config.yaml');
    
    yamlValues = {
      intersectionTolerance: globalConfig?.postgis?.processing?.defaultIntersectionTolerance || 1.0,
      edgeTolerance: globalConfig?.postgis?.processing?.defaultIntersectionTolerance || 1.0,
      simplifyTolerance: globalConfig?.postgis?.processing?.defaultSimplifyTolerance || 0.001,
      batchSize: globalConfig?.postgis?.processing?.defaultBatchSize || 1000,
      timeoutMs: globalConfig?.postgis?.processing?.defaultTimeoutMs || 30000,
      maxRoutesPerBin: routeConfig?.discovery?.maxRoutesPerBin || 10,
      minRouteScore: routeConfig?.discovery?.minRouteScore || 0.7,
      minRouteDistanceKm: routeConfig?.discovery?.minRouteDistanceKm || 1.0,
      maxRouteDistanceKm: routeConfig?.discovery?.maxRouteDistanceKm || 10.0,
      minElevationGainMeters: routeConfig?.discovery?.minElevationGainMeters || 10,
      maxElevationGainMeters: routeConfig?.discovery?.maxElevationGainMeters || 5000,
      distanceWeight: routeConfig?.scoring?.distanceWeight || 0.4,
      elevationWeight: routeConfig?.scoring?.elevationWeight || 0.3,
      qualityWeight: routeConfig?.scoring?.qualityWeight || 0.3,
      steepnessWeight: routeConfig?.costWeighting?.steepnessWeight || 2.0,
      routingDistanceWeight: routeConfig?.costWeighting?.distanceWeight || 0.5
    };

    // Setup database connection
    client = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'trail_master_db_test'
    });

    await client.connect();

    // Drop any existing functions that might conflict
    await client.query(`
      DROP FUNCTION IF EXISTS calculate_route_similarity_score(float, float, float, float) CASCADE;
      DROP FUNCTION IF EXISTS calculate_route_cost(float, float) CASCADE;
      DROP FUNCTION IF EXISTS get_carthorse_config() CASCADE;
      DROP FUNCTION IF EXISTS get_intersection_tolerance() CASCADE;
      DROP FUNCTION IF EXISTS get_edge_tolerance() CASCADE;
      DROP FUNCTION IF EXISTS get_simplify_tolerance() CASCADE;
      DROP FUNCTION IF EXISTS get_batch_size() CASCADE;
      DROP FUNCTION IF EXISTS get_timeout_ms() CASCADE;
      DROP FUNCTION IF EXISTS get_max_routes_per_bin() CASCADE;
      DROP FUNCTION IF EXISTS get_min_route_score() CASCADE;
      DROP FUNCTION IF EXISTS get_route_distance_limits() CASCADE;
      DROP FUNCTION IF EXISTS get_elevation_gain_limits() CASCADE;
      DROP FUNCTION IF EXISTS get_scoring_weights() CASCADE;
      DROP FUNCTION IF EXISTS get_cost_weights() CASCADE;
      DROP FUNCTION IF EXISTS get_route_patterns() CASCADE;
    `);

    // Load the configurable SQL functions
    const configSql = readFileSync('sql/functions/carthorse-configurable-sql.sql', 'utf8');
    await client.query(configSql);
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  describe('Core Configuration Functions', () => {
    test('get_intersection_tolerance() should return YAML value', async () => {
      const result = await client.query('SELECT get_intersection_tolerance() as value');
      const sqlValue = parseFloat(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.intersectionTolerance);
      expect(sqlValue).toBe(STATIC_VALUES.intersectionTolerance);
    });

    test('get_edge_tolerance() should return YAML value', async () => {
      const result = await client.query('SELECT get_edge_tolerance() as value');
      const sqlValue = parseFloat(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.edgeTolerance);
      expect(sqlValue).toBe(STATIC_VALUES.edgeTolerance);
    });

    test('get_simplify_tolerance() should return YAML value', async () => {
      const result = await client.query('SELECT get_simplify_tolerance() as value');
      const sqlValue = parseFloat(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.simplifyTolerance);
      expect(sqlValue).toBe(STATIC_VALUES.simplifyTolerance);
    });

    test('get_batch_size() should return YAML value', async () => {
      const result = await client.query('SELECT get_batch_size() as value');
      const sqlValue = parseInt(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.batchSize);
      expect(sqlValue).toBe(STATIC_VALUES.batchSize);
    });

    test('get_timeout_ms() should return YAML value', async () => {
      const result = await client.query('SELECT get_timeout_ms() as value');
      const sqlValue = parseInt(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.timeoutMs);
      expect(sqlValue).toBe(STATIC_VALUES.timeoutMs);
    });
  });

  describe('Route Discovery Functions', () => {
    test('get_max_routes_per_bin() should return YAML value', async () => {
      const result = await client.query('SELECT get_max_routes_per_bin() as value');
      const sqlValue = parseInt(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.maxRoutesPerBin);
      expect(sqlValue).toBe(STATIC_VALUES.maxRoutesPerBin);
    });

    test('get_min_route_score() should return YAML value', async () => {
      const result = await client.query('SELECT get_min_route_score() as value');
      const sqlValue = parseFloat(result.rows[0].value);
      expect(sqlValue).toBe(yamlValues.minRouteScore);
      expect(sqlValue).toBe(STATIC_VALUES.minRouteScore);
    });

    test('get_route_distance_limits() should return YAML values', async () => {
      const result = await client.query('SELECT get_route_distance_limits() as limits');
      const limits = result.rows[0].limits;
      expect(parseFloat(limits.min_km)).toBe(yamlValues.minRouteDistanceKm);
      expect(parseFloat(limits.max_km)).toBe(yamlValues.maxRouteDistanceKm);
      expect(parseFloat(limits.min_km)).toBe(STATIC_VALUES.minRouteDistanceKm);
      expect(parseFloat(limits.max_km)).toBe(STATIC_VALUES.maxRouteDistanceKm);
    });

    test('get_elevation_gain_limits() should return YAML values', async () => {
      const result = await client.query('SELECT get_elevation_gain_limits() as limits');
      const limits = result.rows[0].limits;
      expect(parseFloat(limits.min_meters)).toBe(yamlValues.minElevationGainMeters);
      expect(parseFloat(limits.max_meters)).toBe(yamlValues.maxElevationGainMeters);
      expect(parseFloat(limits.min_meters)).toBe(STATIC_VALUES.minElevationGainMeters);
      expect(parseFloat(limits.max_meters)).toBe(STATIC_VALUES.maxElevationGainMeters);
    });
  });

  describe('Scoring and Cost Functions', () => {
    test('get_scoring_weights() should return YAML values', async () => {
      const result = await client.query('SELECT get_scoring_weights() as weights');
      const weights = result.rows[0].weights;
      expect(parseFloat(weights.distance_weight)).toBe(yamlValues.distanceWeight);
      expect(parseFloat(weights.elevation_weight)).toBe(yamlValues.elevationWeight);
      expect(parseFloat(weights.quality_weight)).toBe(yamlValues.qualityWeight);
      expect(parseFloat(weights.distance_weight)).toBe(STATIC_VALUES.distanceWeight);
      expect(parseFloat(weights.elevation_weight)).toBe(STATIC_VALUES.elevationWeight);
      expect(parseFloat(weights.quality_weight)).toBe(STATIC_VALUES.qualityWeight);
    });

    test('get_cost_weights() should return YAML values', async () => {
      const result = await client.query('SELECT get_cost_weights() as weights');
      const weights = result.rows[0].weights;
      expect(parseFloat(weights.steepness_weight)).toBe(yamlValues.steepnessWeight);
      expect(parseFloat(weights.distance_weight)).toBe(yamlValues.routingDistanceWeight);
      expect(parseFloat(weights.steepness_weight)).toBe(STATIC_VALUES.steepnessWeight);
      expect(parseFloat(weights.distance_weight)).toBe(STATIC_VALUES.routingDistanceWeight);
    });

    test('calculate_route_similarity_score() should work correctly', async () => {
      // Test perfect match
      const result1 = await client.query(`
        SELECT calculate_route_similarity_score(5.0, 5.0, 200.0, 200.0) as score
      `);
      expect(parseFloat(result1.rows[0].score)).toBeCloseTo(0.7, 2);

      // Test partial match
      const result2 = await client.query(`
        SELECT calculate_route_similarity_score(6.0, 5.0, 250.0, 200.0) as score
      `);
      const score2 = parseFloat(result2.rows[0].score);
      expect(score2).toBeGreaterThan(0);
      expect(score2).toBeLessThan(1);

      // Test poor match
      const result3 = await client.query(`
        SELECT calculate_route_similarity_score(10.0, 5.0, 500.0, 200.0) as score
      `);
      const score3 = parseFloat(result3.rows[0].score);
      expect(score3).toBeGreaterThanOrEqual(0);
      expect(score3).toBeLessThan(0.5);
    });

    test('calculate_route_cost() should work correctly', async () => {
      // Test with moderate steepness and distance
      const result = await client.query(`
        SELECT calculate_route_cost(50.0, 5.0) as cost
      `);
      const cost = parseFloat(result.rows[0].cost);
      expect(cost).toBeGreaterThan(0);
      
      // Cost should be: (steepness * steepnessWeight) + (distance * distanceWeight)
      const expectedCost = (50.0 * yamlValues.steepnessWeight) + (5.0 * yamlValues.routingDistanceWeight);
      expect(cost).toBeCloseTo(expectedCost, 2);
    });
  });

  describe('Route Patterns', () => {
    test('get_route_patterns() should return expected patterns', async () => {
      const result = await client.query('SELECT * FROM get_route_patterns()');
      expect(result.rows.length).toBeGreaterThan(0);
      
      // Check that we have the expected route patterns
      const patterns = result.rows;
      expect(patterns.some(p => p.pattern_name === 'Short Loop')).toBe(true);
      expect(patterns.some(p => p.pattern_name === 'Medium Loop')).toBe(true);
      expect(patterns.some(p => p.pattern_name === 'Long Loop')).toBe(true);
      expect(patterns.some(p => p.route_shape === 'loop')).toBe(true);
      expect(patterns.some(p => p.route_shape === 'out-and-back')).toBe(true);
      expect(patterns.some(p => p.route_shape === 'point-to-point')).toBe(true);
    });

    test('route patterns should have valid values', async () => {
      const result = await client.query('SELECT * FROM get_route_patterns()');
      
      result.rows.forEach((pattern: any) => {
        expect(pattern.target_distance_km).toBeGreaterThan(0);
        expect(pattern.target_elevation_gain).toBeGreaterThan(0);
        expect(pattern.tolerance_percent).toBeGreaterThan(0);
        expect(['loop', 'out-and-back', 'point-to-point']).toContain(pattern.route_shape);
      });
    });
  });

  describe('Complete Configuration', () => {
    test('get_carthorse_config() should return complete config', async () => {
      const result = await client.query('SELECT get_carthorse_config() as config');
      const config = result.rows[0].config;
      
      // Check that all expected keys are present
      expect(config.intersection_tolerance).toBeDefined();
      expect(config.edge_tolerance).toBeDefined();
      expect(config.simplify_tolerance).toBeDefined();
      expect(config.batch_size).toBeDefined();
      expect(config.timeout_ms).toBeDefined();
      expect(config.max_routes_per_bin).toBeDefined();
      expect(config.min_route_score).toBeDefined();
      expect(config.distance_weight).toBeDefined();
      expect(config.elevation_weight).toBeDefined();
      expect(config.quality_weight).toBeDefined();
      expect(config.steepness_weight).toBeDefined();
      expect(config.routing_distance_weight).toBeDefined();
    });

    test('config values should match YAML values', async () => {
      const result = await client.query('SELECT get_carthorse_config() as config');
      const config = result.rows[0].config;
      
      expect(parseFloat(config.intersection_tolerance)).toBe(yamlValues.intersectionTolerance);
      expect(parseFloat(config.edge_tolerance)).toBe(yamlValues.edgeTolerance);
      expect(parseFloat(config.simplify_tolerance)).toBe(yamlValues.simplifyTolerance);
      expect(parseInt(config.batch_size)).toBe(yamlValues.batchSize);
      expect(parseInt(config.timeout_ms)).toBe(yamlValues.timeoutMs);
      expect(parseInt(config.max_routes_per_bin)).toBe(yamlValues.maxRoutesPerBin);
      expect(parseFloat(config.min_route_score)).toBe(yamlValues.minRouteScore);
      expect(parseFloat(config.distance_weight)).toBe(yamlValues.distanceWeight);
      expect(parseFloat(config.elevation_weight)).toBe(yamlValues.elevationWeight);
      expect(parseFloat(config.quality_weight)).toBe(yamlValues.qualityWeight);
      expect(parseFloat(config.steepness_weight)).toBe(yamlValues.steepnessWeight);
      expect(parseFloat(config.routing_distance_weight)).toBe(yamlValues.routingDistanceWeight);
    });
  });

  describe('Value Validation', () => {
    test('all numeric values should be valid numbers', async () => {
      const result = await client.query('SELECT get_carthorse_config() as config');
      const config = result.rows[0].config;
      
      Object.entries(config).forEach(([key, value]) => {
        if (typeof value === 'string') {
          const numValue = parseFloat(value);
          expect(isNaN(numValue)).toBe(false);
          expect(numValue).toBeGreaterThanOrEqual(0);
        }
      });
    });

    test('scoring weights should sum to approximately 1.0', async () => {
      const result = await client.query('SELECT get_scoring_weights() as weights');
      const weights = result.rows[0].weights;
      
      const totalWeight = parseFloat(weights.distance_weight) + 
                         parseFloat(weights.elevation_weight) + 
                         parseFloat(weights.quality_weight);
      
      expect(totalWeight).toBeCloseTo(1.0, 2);
    });

    test('route distance limits should be valid', async () => {
      const result = await client.query('SELECT get_route_distance_limits() as limits');
      const limits = result.rows[0].limits;
      
      const minKm = parseFloat(limits.min_km);
      const maxKm = parseFloat(limits.max_km);
      
      expect(minKm).toBeGreaterThan(0);
      expect(maxKm).toBeGreaterThan(minKm);
    });

    test('elevation gain limits should be valid', async () => {
      const result = await client.query('SELECT get_elevation_gain_limits() as limits');
      const limits = result.rows[0].limits;
      
      const minMeters = parseFloat(limits.min_meters);
      const maxMeters = parseFloat(limits.max_meters);
      
      expect(minMeters).toBeGreaterThanOrEqual(0);
      expect(maxMeters).toBeGreaterThan(minMeters);
    });
  });
}); 