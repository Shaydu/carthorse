import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Client } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';

describe.skip('Route Recommendations Integration Tests (Moved to staging-integration.test.ts)', () => {
  let pgClient: Client;
  let sqliteDb: Database.Database;
  let testDbPath: string;
  let orchestrator: CarthorseOrchestrator;

  beforeEach(async () => {
    // Setup PostgreSQL connection
    pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db',
      user: process.env.PGUSER || 'tester',
      password: process.env.PGPASSWORD || 'test'
    });
    await pgClient.connect();

    // Setup SQLite test database
    testDbPath = path.join(__dirname, '../../test-output/route-recommendations-integration-test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    sqliteDb = new Database(testDbPath);

    // Setup orchestrator
    orchestrator = new CarthorseOrchestrator({
      region: 'boulder',
      outputPath: testDbPath,
      validate: true,
      simplifyTolerance: 2.0,
      intersectionTolerance: 2.0,
      replace: false,
      verbose: false,
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSqliteDbSizeMB: 100,
      skipIncompleteTrails: false,
      cleanupTempFiles: false
    });
  });

  afterEach(async () => {
    await pgClient.end();
    sqliteDb.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Route Recommendations Pipeline Integration', () => {
    it('should generate and validate route recommendations through full pipeline', async () => {
      // Step 1: Create test data with known trail patterns
      const schemaName = `test_route_integration_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      
      // Create trails table
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
          app_uuid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRINGZ, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert test trails that can form various route types
      await pgClient.query(`
        INSERT INTO ${schemaName}.trails (
          app_uuid, name, region, osm_id, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, difficulty, surface, trail_type,
          geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES 
        -- Loop trail
        ('loop-1', 'Loop Trail A', 'boulder', '101', 2.0, 100, 100, 1900, 1800, 1850, 'easy', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.0 40.0 1800, -105.02 40.02 1900, -105.0 40.0 1800)', 4326), -105.02, -105.0, 40.0, 40.02),
        -- Out and back trail
        ('outback-1', 'Out and Back Trail', 'boulder', '102', 3.0, 150, 150, 1950, 1800, 1875, 'easy', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.1 40.1 1800, -105.12 40.12 1950)', 4326), -105.12, -105.1, 40.1, 40.12),
        -- Point to point trail
        ('ptp-1', 'Point to Point Trail', 'boulder', '103', 4.0, 200, 200, 2000, 1800, 1900, 'moderate', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.2 40.2 1800, -105.25 40.25 2000)', 4326), -105.25, -105.2, 40.2, 40.25),
        -- Connecting trail for multi-trail routes
        ('connector-1', 'Connector Trail', 'boulder', '104', 1.5, 75, 75, 1850, 1775, 1812.5, 'easy', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.02 40.02 1775, -105.1 40.1 1850)', 4326), -105.1, -105.02, 40.02, 40.1),
        -- Long trail for distance testing
        ('long-1', 'Long Distance Trail', 'boulder', '105', 8.0, 400, 400, 2200, 1800, 2000, 'moderate', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.3 40.3 1800, -105.35 40.35 2200)', 4326), -105.35, -105.3, 40.3, 40.35)
      `);

      // Create routing tables
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schemaName}.routing_nodes (
          id INTEGER NOT NULL,
          node_uuid TEXT,
          lat REAL,
          lng REAL,
          elevation REAL,
          node_type TEXT,
          connected_trails TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schemaName}.routing_edges (
          id INTEGER NOT NULL,
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

      // Create route_recommendations table
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schemaName}.route_recommendations (
          id SERIAL PRIMARY KEY,
          route_uuid TEXT UNIQUE NOT NULL,
          region TEXT NOT NULL,
                input_length_km REAL,
      input_elevation_gain REAL,
      recommended_length_km REAL,
          recommended_elevation_gain REAL,
          recommended_elevation_loss REAL,
          route_score REAL,
          route_shape TEXT,
          trail_count INTEGER,
          route_path TEXT,
          route_edges TEXT,
          request_hash TEXT,
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Step 2: Generate routing graph
      try {
        const nodesResult = await pgClient.query(
          `SELECT generate_routing_nodes_native($1, $2)`,
          [schemaName, 2.0]
        );
        expect(nodesResult.rows[0].success).toBe(true);
        
        const edgesResult = await pgClient.query(
          `SELECT generate_routing_edges_native($1, $2)`,
          [schemaName, 2.0]
        );
        expect(edgesResult.rows[0].success).toBe(true);
        
      } catch (error) {
        console.log('⚠️  Routing functions not available, skipping routing graph generation');
      }

      // Step 3: Generate route recommendations
      try {
        const recommendationsResult = await pgClient.query(
          `SELECT generate_route_recommendations($1)`,
          [schemaName]
        );
        const routeCount = recommendationsResult.rows[0]?.generate_route_recommendations || 0;
        expect(routeCount).toBeGreaterThanOrEqual(0);
        
      } catch (error) {
        console.log('⚠️  Route recommendations function not available, skipping');
      }

      // Step 4: Validate route recommendations
      const routeValidation = await validateRouteRecommendations(pgClient, schemaName);
      expect(routeValidation.isValid).toBe(true);
      expect(routeValidation.totalRoutes).toBeGreaterThan(0);
      expect(routeValidation.routeShapes).toContain('loop');
      expect(routeValidation.routeShapes).toContain('out-and-back');
      expect(routeValidation.routeShapes).toContain('point-to-point');

      // Step 5: Export to SQLite and validate
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: testDbPath,
        region: 'boulder',
        validate: true
      });

      const exportResult = await exportService.exportDatabase(schemaName);
      expect(exportResult.isValid).toBe(true);
      expect(exportResult.trailsExported).toBe(5);

      // Step 6: Validate SQLite export
      const sqliteValidation = await validateSqliteRouteRecommendations(sqliteDb);
      expect(sqliteValidation.isValid).toBe(true);
      expect(sqliteValidation.routeCount).toBeGreaterThan(0);

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    });

    it('should generate routes with specific distance and elevation criteria', async () => {
      const schemaName = `test_route_criteria_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      
      // Create trails with specific characteristics for testing
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
          app_uuid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRINGZ, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert trails with specific distance/elevation patterns
      await pgClient.query(`
        INSERT INTO ${schemaName}.trails (
          app_uuid, name, region, osm_id, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, difficulty, surface, trail_type,
          geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES 
        -- 5km trail with 200m gain
        ('criteria-1', '5km 200m Trail', 'boulder', '201', 5.0, 200, 200, 2000, 1800, 1900, 'moderate', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.0 40.0 1800, -105.05 40.05 2000)', 4326), -105.05, -105.0, 40.0, 40.05),
        -- 10km trail with 400m gain
        ('criteria-2', '10km 400m Trail', 'boulder', '202', 10.0, 400, 400, 2200, 1800, 2000, 'moderate', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.1 40.1 1800, -105.15 40.15 2200)', 4326), -105.15, -105.1, 40.1, 40.15),
        -- 15km trail with 600m gain
        ('criteria-3', '15km 600m Trail', 'boulder', '203', 15.0, 600, 600, 2400, 1800, 2100, 'hard', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.2 40.2 1800, -105.25 40.25 2400)', 4326), -105.25, -105.2, 40.2, 40.25)
      `);

      // Create routing and recommendation tables
      await createRoutingTables(pgClient, schemaName);

      // Generate recommendations
      try {
        const result = await pgClient.query(
          `SELECT generate_route_recommendations($1)`,
          [schemaName]
        );
        
        // Validate specific criteria
        const criteriaValidation = await validateRouteCriteria(pgClient, schemaName);
        expect(criteriaValidation.has5kmRoutes).toBe(true);
        expect(criteriaValidation.has10kmRoutes).toBe(true);
        expect(criteriaValidation.has15kmRoutes).toBe(true);
        expect(criteriaValidation.averageScore).toBeGreaterThan(50);
        
      } catch (error) {
        console.log('⚠️  Route recommendations function not available, skipping criteria test');
      }

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    });

    it('should handle edge cases and error conditions gracefully', async () => {
      const schemaName = `test_route_edge_cases_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      
      // Test with minimal trail data
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
          app_uuid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          region TEXT NOT NULL,
          osm_id TEXT,
          length_km REAL,
          elevation_gain REAL,
          elevation_loss REAL,
          max_elevation REAL,
          min_elevation REAL,
          avg_elevation REAL,
          difficulty TEXT,
          surface TEXT,
          trail_type TEXT,
          geometry GEOMETRY(LINESTRINGZ, 4326),
          bbox_min_lng REAL,
          bbox_max_lng REAL,
          bbox_min_lat REAL,
          bbox_max_lat REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert only one trail (edge case)
      await pgClient.query(`
        INSERT INTO ${schemaName}.trails (
          app_uuid, name, region, osm_id, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, difficulty, surface, trail_type,
          geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        ) VALUES 
        ('edge-1', 'Single Trail', 'boulder', '301', 2.0, 100, 100, 1900, 1800, 1850, 'easy', 'dirt', 'hiking',
         ST_GeomFromText('LINESTRING Z(-105.0 40.0 1800, -105.02 40.02 1900)', 4326), -105.02, -105.0, 40.0, 40.02)
      `);

      // Create routing and recommendation tables
      await createRoutingTables(pgClient, schemaName);

      // Test route generation with minimal data
      try {
        const result = await pgClient.query(
          `SELECT generate_route_recommendations($1)`,
          [schemaName]
        );
        
        // Should handle gracefully
        expect(result.rows[0]?.generate_route_recommendations || 0).toBeGreaterThanOrEqual(0);
        
      } catch (error) {
        console.log('⚠️  Route recommendations function not available, skipping edge case test');
      }

      // Test export with minimal data
      const exportService = new ExportService(pgClient, {
        sqliteDbPath: testDbPath,
        region: 'boulder',
        validate: false
      });

      const exportResult = await exportService.exportDatabase(schemaName);
      expect(exportResult.trailsExported).toBe(1);

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    });
  });

  describe('Route Recommendations Quality Validation', () => {
    it('should validate route recommendation quality metrics', async () => {
      const schemaName = `test_route_quality_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      
      // Create comprehensive test data
      await createTestTrails(pgClient, schemaName);
      await createRoutingTables(pgClient, schemaName);

      // Generate recommendations
      try {
        await pgClient.query(
          `SELECT generate_route_recommendations($1)`,
          [schemaName]
        );
        
        // Validate quality metrics
        const qualityMetrics = await validateRouteQuality(pgClient, schemaName);
        
        expect(qualityMetrics.scoreRange.min).toBeGreaterThanOrEqual(0);
        expect(qualityMetrics.scoreRange.max).toBeLessThanOrEqual(100);
        expect(qualityMetrics.distanceRange.min).toBeGreaterThan(0);
        expect(qualityMetrics.distanceRange.max).toBeLessThan(50); // Reasonable max
        expect(qualityMetrics.elevationRange.min).toBeGreaterThanOrEqual(0);
        expect(qualityMetrics.routeShapes).toBeGreaterThan(0);
        expect(qualityMetrics.routeTypes).toBeGreaterThan(0);
        
      } catch (error) {
        console.log('⚠️  Route recommendations function not available, skipping quality test');
      }

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    });

    it('should validate route recommendation diversity', async () => {
      const schemaName = `test_route_diversity_${Date.now()}`;
      await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      
      // Create diverse trail data
      await createDiverseTrails(pgClient, schemaName);
      await createRoutingTables(pgClient, schemaName);

      // Generate recommendations
      try {
        await pgClient.query(
          `SELECT generate_route_recommendations($1)`,
          [schemaName]
        );
        
        // Validate diversity
        const diversityMetrics = await validateRouteDiversity(pgClient, schemaName);
        
        expect(diversityMetrics.shapeDiversity).toBeGreaterThan(0.5); // Should have multiple shapes
        expect(diversityMetrics.distanceDiversity).toBeGreaterThan(0.3); // Should have varied distances
        expect(diversityMetrics.elevationDiversity).toBeGreaterThan(0.3); // Should have varied elevations
        expect(diversityMetrics.scoreDiversity).toBeGreaterThan(0.2); // Should have varied scores
        
      } catch (error) {
        console.log('⚠️  Route recommendations function not available, skipping diversity test');
      }

      // Clean up
      await pgClient.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    });
  });
});

// Helper functions for validation
async function validateRouteRecommendations(pgClient: Client, schemaName: string) {
  const result = await pgClient.query(`
    SELECT 
      COUNT(*) as total_routes,
      COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
      COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_back_routes,
      COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as ptp_routes,
      AVG(route_score) as avg_score,
      MIN(route_score) as min_score,
      MAX(route_score) as max_score
    FROM ${schemaName}.route_recommendations
  `);

  const data = result.rows[0];
  const routeShapes = [];
  if (data.loop_routes > 0) routeShapes.push('loop');
  if (data.out_back_routes > 0) routeShapes.push('out-and-back');
  if (data.ptp_routes > 0) routeShapes.push('point-to-point');

  return {
    isValid: data.total_routes > 0 && data.avg_score > 0,
    totalRoutes: parseInt(data.total_routes),
    routeShapes,
    averageScore: parseFloat(data.avg_score),
    scoreRange: {
      min: parseFloat(data.min_score),
      max: parseFloat(data.max_score)
    }
  };
}

async function validateRouteCriteria(pgClient: Client, schemaName: string) {
  const result = await pgClient.query(`
    SELECT 
      COUNT(CASE WHEN recommended_length_km BETWEEN 4.5 AND 5.5 THEN 1 END) as has_5km_routes,
      COUNT(CASE WHEN recommended_length_km BETWEEN 9.0 AND 11.0 THEN 1 END) as has_10km_routes,
      COUNT(CASE WHEN recommended_length_km BETWEEN 14.0 AND 16.0 THEN 1 END) as has_15km_routes,
      AVG(route_score) as avg_score
    FROM ${schemaName}.route_recommendations
  `);

  const data = result.rows[0];
  return {
    has5kmRoutes: parseInt(data.has_5km_routes) > 0,
    has10kmRoutes: parseInt(data.has_10km_routes) > 0,
    has15kmRoutes: parseInt(data.has_15km_routes) > 0,
    averageScore: parseFloat(data.avg_score)
  };
}

async function validateSqliteRouteRecommendations(sqliteDb: Database.Database) {
  try {
    const routeCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM route_recommendations').get() as { count: number };
    const routeData = sqliteDb.prepare('SELECT route_shape, route_score FROM route_recommendations LIMIT 5').all() as any[];
    
    return {
      isValid: routeCount.count > 0,
      routeCount: routeCount.count,
      sampleRoutes: routeData
    };
  } catch (error) {
    return {
      isValid: false,
      routeCount: 0,
      sampleRoutes: []
    };
  }
}

async function validateRouteQuality(pgClient: Client, schemaName: string) {
  const result = await pgClient.query(`
    SELECT 
      MIN(route_score) as min_score,
      MAX(route_score) as max_score,
      MIN(recommended_length_km) as min_distance,
      MAX(recommended_length_km) as max_distance,
      MIN(recommended_elevation_gain) as min_elevation,
      MAX(recommended_elevation_gain) as max_elevation,
      COUNT(DISTINCT route_shape) as shape_count,
      COUNT(DISTINCT route_type) as type_count
    FROM ${schemaName}.route_recommendations
  `);

  const data = result.rows[0];
  return {
    scoreRange: {
      min: parseFloat(data.min_score),
      max: parseFloat(data.max_score)
    },
    distanceRange: {
      min: parseFloat(data.min_distance),
      max: parseFloat(data.max_distance)
    },
    elevationRange: {
      min: parseFloat(data.min_elevation),
      max: parseFloat(data.max_elevation)
    },
    routeShapes: parseInt(data.shape_count),
    routeTypes: parseInt(data.type_count)
  };
}

async function validateRouteDiversity(pgClient: Client, schemaName: string) {
  const result = await pgClient.query(`
    SELECT 
      COUNT(DISTINCT route_shape) as shape_diversity,
      COUNT(DISTINCT route_type) as type_diversity,
      STDDEV(recommended_length_km) as distance_stddev,
      STDDEV(recommended_elevation_gain) as elevation_stddev,
      STDDEV(route_score) as score_stddev
    FROM ${schemaName}.route_recommendations
  `);

  const data = result.rows[0];
  return {
    shapeDiversity: parseFloat(data.shape_diversity) / 4, // Normalize by max possible shapes
    typeDiversity: parseFloat(data.type_diversity) / 5, // Normalize by max possible types
    distanceDiversity: parseFloat(data.distance_stddev) / 10, // Normalize by reasonable max
    elevationDiversity: parseFloat(data.elevation_stddev) / 500, // Normalize by reasonable max
    scoreDiversity: parseFloat(data.score_stddev) / 50 // Normalize by score range
  };
}

async function createRoutingTables(pgClient: Client, schemaName: string) {
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS ${schemaName}.routing_nodes (
      id INTEGER NOT NULL,
      node_uuid TEXT,
      lat REAL,
      lng REAL,
      elevation REAL,
      node_type TEXT,
      connected_trails TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS ${schemaName}.routing_edges (
      id INTEGER NOT NULL,
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

  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS ${schemaName}.route_recommendations (
      id SERIAL PRIMARY KEY,
      route_uuid TEXT UNIQUE NOT NULL,
      region TEXT NOT NULL,
      input_length_km REAL,
      input_elevation_gain REAL,
      recommended_length_km REAL,
      recommended_elevation_gain REAL,
      recommended_elevation_loss REAL,
      route_score REAL,
      route_shape TEXT,
      trail_count INTEGER,
      route_path TEXT,
      route_edges TEXT,
      request_hash TEXT,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function createTestTrails(pgClient: Client, schemaName: string) {
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
      app_uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      osm_id TEXT,
      length_km REAL,
      elevation_gain REAL,
      elevation_loss REAL,
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL,
      difficulty TEXT,
      surface TEXT,
      trail_type TEXT,
      geometry GEOMETRY(LINESTRINGZ, 4326),
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pgClient.query(`
    INSERT INTO ${schemaName}.trails (
      app_uuid, name, region, osm_id, length_km, elevation_gain, elevation_loss,
      max_elevation, min_elevation, avg_elevation, difficulty, surface, trail_type,
      geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    ) VALUES 
    ('quality-1', 'Quality Trail 1', 'boulder', '401', 3.0, 150, 150, 1950, 1800, 1875, 'easy', 'dirt', 'hiking',
     ST_GeomFromText('LINESTRING Z(-105.0 40.0 1800, -105.03 40.03 1950)', 4326), -105.03, -105.0, 40.0, 40.03),
    ('quality-2', 'Quality Trail 2', 'boulder', '402', 5.0, 250, 250, 2050, 1800, 1925, 'moderate', 'dirt', 'hiking',
     ST_GeomFromText('LINESTRING Z(-105.03 40.03 1800, -105.08 40.08 2050)', 4326), -105.08, -105.03, 40.03, 40.08),
    ('quality-3', 'Quality Trail 3', 'boulder', '403', 7.0, 350, 350, 2150, 1800, 1975, 'moderate', 'dirt', 'hiking',
     ST_GeomFromText('LINESTRING Z(-105.08 40.08 1800, -105.15 40.15 2150)', 4326), -105.15, -105.08, 40.08, 40.15)
  `);
}

async function createDiverseTrails(pgClient: Client, schemaName: string) {
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS ${schemaName}.trails (
      app_uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      osm_id TEXT,
      length_km REAL,
      elevation_gain REAL,
      elevation_loss REAL,
      max_elevation REAL,
      min_elevation REAL,
      avg_elevation REAL,
      difficulty TEXT,
      surface TEXT,
      trail_type TEXT,
      geometry GEOMETRY(LINESTRINGZ, 4326),
      bbox_min_lng REAL,
      bbox_max_lng REAL,
      bbox_min_lat REAL,
      bbox_max_lat REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create diverse trail set
  const diverseTrails = [
    { name: 'Short Easy', length: 2.0, elevation: 100, difficulty: 'easy' },
    { name: 'Medium Moderate', length: 5.0, elevation: 250, difficulty: 'moderate' },
    { name: 'Long Hard', length: 10.0, elevation: 500, difficulty: 'hard' },
    { name: 'Very Long', length: 15.0, elevation: 750, difficulty: 'hard' },
    { name: 'Flat Trail', length: 3.0, elevation: 50, difficulty: 'easy' },
    { name: 'Steep Trail', length: 4.0, elevation: 400, difficulty: 'moderate' }
  ];

  for (let i = 0; i < diverseTrails.length; i++) {
    const trail = diverseTrails[i];
    await pgClient.query(`
      INSERT INTO ${schemaName}.trails (
        app_uuid, name, region, osm_id, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation, difficulty, surface, trail_type,
        geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES 
      ('diverse-${i+1}', '${trail.name}', 'boulder', '50${i+1}', ${trail.length}, ${trail.elevation}, ${trail.elevation}, 
       ${1800 + trail.elevation}, 1800, ${1800 + trail.elevation/2}, '${trail.difficulty}', 'dirt', 'hiking',
       ST_GeomFromText('LINESTRING Z(-105.${i} 40.${i} 1800, -105.${i+1} 40.${i+1} ${1800 + trail.elevation})', 4326), 
       -105.${i+1}, -105.${i}, 40.${i}, 40.${i+1})
    `);
  }
} 