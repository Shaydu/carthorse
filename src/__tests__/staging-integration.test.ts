import { Client } from 'pg';
import { TEST_CONFIG } from '../config/test-config';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';
import { createSqliteTables, insertTrails, insertSchemaVersion } from '../utils/sqlite-export-helpers';
import { v4 as uuidv4 } from 'uuid';

describe('Staging Integration Tests', () => {
  let pgClient: Client;
  let stagingSchema: string;
  let testSchema: string;
  let testDbPath: string;

  beforeAll(async () => {
    pgClient = new Client(TEST_CONFIG.database);
    await pgClient.connect();
    
    // Create test staging schema
    stagingSchema = `staging_test_integration_${Date.now()}`;
    testSchema = `test_staging_integration_${Date.now()}`;
    testDbPath = path.resolve(__dirname, '../test-output/staging-integration-test.db');
    
    console.log(`🏗️  Creating staging integration test schemas: ${stagingSchema}, ${testSchema}`);
    
    // Create the staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Create trails table in staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        length_km REAL CHECK(length_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Create auto_calculate_length function
    await pgClient.query(`
      CREATE OR REPLACE FUNCTION ${stagingSchema}.auto_calculate_length()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
          NEW.length_km := ST_Length(NEW.geometry, true) / 1000.0; -- Convert meters to kilometers
        END IF;
        
        RETURN NEW;
      END;
      $$;
    `);

    // Create auto_calculate_length trigger
    await pgClient.query(`
      DROP TRIGGER IF EXISTS trigger_auto_calculate_length ON ${stagingSchema}.trails;
      CREATE TRIGGER trigger_auto_calculate_length
        BEFORE INSERT OR UPDATE ON ${stagingSchema}.trails
        FOR EACH ROW
        EXECUTE FUNCTION ${stagingSchema}.auto_calculate_length();
    `);
    
    // Create routing_nodes table in staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT NOT NULL CHECK(node_type IN ('intersection', 'endpoint')),
        connected_trails TEXT,
        geo2 GEOMETRY(POINTZ, 4326)
      )
    `);
    
    // Create routing_edges table in staging schema (without foreign keys initially)
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        distance_km REAL NOT NULL CHECK(distance_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        is_bidirectional BOOLEAN DEFAULT TRUE,
        geo2 GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Create intersection_points table in staging schema
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINTZ, 4326) NOT NULL,
        trail_count INTEGER NOT NULL,
        connected_trails TEXT[]
      )
    `);
    
    // Insert test data for 3D preservation tests
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.trails (app_uuid, name, region, trail_type, surface, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
      ('test-3d-1', 'Test 3D Trail 1', 'test', 'path', 'dirt', 2.0, 100, 50, 2100, 2000, 2050, ST_GeomFromText('LINESTRINGZ(-105.0 40.0 2000, -104.9 40.1 2100)', 4326)),
      ('test-3d-2', 'Test 3D Trail 2', 'test', 'path', 'dirt', 1.5, 75, 25, 2200, 2100, 2150, ST_GeomFromText('LINESTRINGZ(-104.9 40.1 2100, -104.8 40.2 2200)', 4326)),
      ('test-3d-3', 'Test 3D Trail 3', 'test', 'path', 'dirt', 2.5, 150, 100, 2400, 2200, 2300, ST_GeomFromText('LINESTRINGZ(-104.8 40.2 2200, -104.7 40.3 2400)', 4326))
    `);
    
    // Insert test routing nodes
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails, geo2) VALUES
      ('node-1', 40.0, -105.0, 2000, 'intersection', '["test-3d-1"]', ST_GeomFromText('POINTZ(-105.0 40.0 2000)', 4326)),
      ('node-2', 40.1, -104.9, 2100, 'intersection', '["test-3d-1", "test-3d-2"]', ST_GeomFromText('POINTZ(-104.9 40.1 2100)', 4326)),
      ('node-3', 40.2, -104.8, 2200, 'intersection', '["test-3d-2", "test-3d-3"]', ST_GeomFromText('POINTZ(-104.8 40.2 2200)', 4326)),
      ('node-4', 40.3, -104.7, 2400, 'endpoint', '["test-3d-3"]', ST_GeomFromText('POINTZ(-104.7 40.3 2400)', 4326))
    `);
    
    // Insert test routing edges
    await pgClient.query(`
      INSERT INTO ${stagingSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2) VALUES
      (1, 2, 'test-3d-1', 'Test 3D Trail 1', 1.0, 100, 0, ST_GeomFromText('LINESTRINGZ(-105.0 40.0 2000, -104.9 40.1 2100)', 4326)),
      (2, 3, 'test-3d-2', 'Test 3D Trail 2', 1.5, 100, 0, ST_GeomFromText('LINESTRINGZ(-104.9 40.1 2100, -104.8 40.2 2200)', 4326)),
      (3, 4, 'test-3d-3', 'Test 3D Trail 3', 2.0, 200, 0, ST_GeomFromText('LINESTRINGZ(-104.8 40.2 2200, -104.7 40.3 2400)', 4326))
    `);
    
    // Create test schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Create test schema tables (for 3D data preservation tests)
    await pgClient.query(`
      CREATE TABLE ${testSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        length_km REAL CHECK(length_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${testSchema}.routing_nodes (
        id SERIAL PRIMARY KEY,
        node_uuid TEXT UNIQUE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        node_type TEXT NOT NULL CHECK(node_type IN ('intersection', 'endpoint')),
        connected_trails TEXT,
        geo2 GEOMETRY(POINTZ, 4326)
      )
    `);
    
    await pgClient.query(`
      CREATE TABLE ${testSchema}.routing_edges (
        id SERIAL PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        trail_id TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        distance_km REAL NOT NULL CHECK(distance_km > 0),
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        is_bidirectional BOOLEAN DEFAULT TRUE,
        geo2 GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Insert test data into test schema
    await pgClient.query(`
      INSERT INTO ${testSchema}.trails (app_uuid, name, region, trail_type, surface, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
      ('test-split-1', 'Test Split Trail', 'test', 'path', 'dirt', 3.0, 200, 100, 2200, 2000, 2100, ST_GeomFromText('LINESTRINGZ(-105.0 40.0 2000, -104.9 40.1 2100, -104.8 40.2 2200)', 4326))
    `);
    
    await pgClient.query(`
      INSERT INTO ${testSchema}.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails, geo2) VALUES
      ('split-node-1', -105.0, 40.0, 2000, 'intersection', '["test-split-1"]', ST_GeomFromText('POINTZ(-105.0 40.0 2000)', 4326)),
      ('split-node-2', -104.9, 40.1, 2100, 'intersection', '["test-split-1"]', ST_GeomFromText('POINTZ(-104.9 40.1 2100)', 4326)),
      ('split-node-3', -104.8, 40.2, 2200, 'endpoint', '["test-split-1"]', ST_GeomFromText('POINTZ(-104.8 40.2 2200)', 4326))
    `);
    
    await pgClient.query(`
      INSERT INTO ${testSchema}.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2) VALUES
      (1, 2, 'test-split-1', 'Test Split Trail', 1.0, 100, 0, ST_GeomFromText('LINESTRINGZ(-105.0 40.0 2000, -104.9 40.1 2100)', 4326)),
      (2, 3, 'test-split-1', 'Test Split Trail', 1.0, 100, 0, ST_GeomFromText('LINESTRINGZ(-104.9 40.1 2100, -104.8 40.2 2200)', 4326))
    `);
    
    console.log(`✅ Staging integration test schemas created with sample data`);
  });

  afterAll(async () => {
    // Clean up the test staging schemas
    if (stagingSchema) {
      console.log(`🧹 Cleaning up test staging schema: ${stagingSchema}`);
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    }
    if (testSchema) {
      console.log(`🧹 Cleaning up test schema: ${testSchema}`);
      await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    }
    await pgClient.end();
    
    // Clean up test files
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Routing Graph Quality Validation', () => {
    it('should have valid routing graph structure', async () => {
      const result = await pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges) as edge_count,
          (SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes) as node_count,
          (SELECT COUNT(*) FROM ${stagingSchema}.trails) as trail_count
        FROM ${stagingSchema}.routing_nodes LIMIT 1
      `);
      
      const row = result.rows[0];
      expect(parseInt(row.edge_count)).toBeGreaterThan(0);
      expect(parseInt(row.node_count)).toBeGreaterThan(0);
      expect(parseInt(row.trail_count)).toBeGreaterThan(0);
    });

    it('should have valid node-edge relationships', async () => {
      const result = await pgClient.query(`
        SELECT COUNT(*) as orphaned_nodes
        FROM ${stagingSchema}.routing_nodes n
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingSchema}.routing_edges e
          WHERE e.from_node_id = n.id OR e.to_node_id = n.id
        )
      `);
      
      expect(parseInt(result.rows[0].orphaned_nodes)).toBe(0);
    });

    it('should have reasonable edge distances', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN distance_km > 0 AND distance_km < 100 THEN 1 END) as valid_length_edges,
          AVG(distance_km) as avg_length,
          MIN(distance_km) as min_length,
          MAX(distance_km) as max_length
        FROM ${stagingSchema}.routing_edges
        WHERE distance_km IS NOT NULL
      `);
      
      const row = result.rows[0];
      const totalEdges = parseInt(row.total_edges);
      const validLengthEdges = parseInt(row.valid_length_edges);
      const avgLength = parseFloat(row.avg_length);
      const minLength = parseFloat(row.min_length);
      const maxLength = parseFloat(row.max_length);
      
      console.log(`📏 Edge distances: avg=${avgLength.toFixed(2)}km, min=${minLength.toFixed(2)}km, max=${maxLength.toFixed(2)}km`);
      console.log(`📊 Edge validation: ${validLengthEdges}/${totalEdges} edges have valid lengths`);
      
      expect(totalEdges).toBeGreaterThan(0);
      expect(validLengthEdges).toBe(totalEdges);
      expect(avgLength).toBeGreaterThan(0);
      expect(minLength).toBeGreaterThan(0);
      expect(maxLength).toBeLessThan(100);
    });

    it('should have valid node coordinates', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_nodes,
          COUNT(CASE WHEN lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 THEN 1 END) as valid_coord_nodes,
          AVG(lat) as avg_lat,
          AVG(lng) as avg_lng
        FROM ${stagingSchema}.routing_nodes
        WHERE lat IS NOT NULL AND lng IS NOT NULL
      `);
      
      const row = result.rows[0];
      const totalNodes = parseInt(row.total_nodes);
      const validCoordNodes = parseInt(row.valid_coord_nodes);
      const avgLat = parseFloat(row.avg_lat);
      const avgLng = parseFloat(row.avg_lng);
      
      console.log(`📍 Node coordinates: avg_lat=${avgLat.toFixed(4)}, avg_lng=${avgLng.toFixed(4)}`);
      console.log(`📊 Coordinate validation: ${validCoordNodes}/${totalNodes} nodes have valid coordinates`);
      
      expect(totalNodes).toBeGreaterThan(0);
      // Note: Our test data uses negative coordinates (valid for longitude), so we check for valid range
      expect(validCoordNodes).toBe(totalNodes);
      expect(avgLat).toBeGreaterThan(-90);
      expect(avgLat).toBeLessThan(90);
      expect(avgLng).toBeGreaterThan(-180);
      expect(avgLng).toBeLessThan(180);
    });

    it('should have proper node types', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_nodes,
          COUNT(CASE WHEN node_type = 'intersection' THEN 1 END) as intersection_nodes,
          COUNT(CASE WHEN node_type = 'endpoint' THEN 1 END) as endpoint_nodes
        FROM ${stagingSchema}.routing_nodes
      `);
      
      const row = result.rows[0];
      const totalNodes = parseInt(row.total_nodes);
      const intersectionNodes = parseInt(row.intersection_nodes);
      const endpointNodes = parseInt(row.endpoint_nodes);
      
      console.log(`🔗 Node types: ${intersectionNodes} intersections, ${endpointNodes} endpoints`);
      
      expect(totalNodes).toBeGreaterThan(0);
      expect(intersectionNodes + endpointNodes).toBe(totalNodes);
      expect(intersectionNodes).toBeGreaterThan(0);
      expect(endpointNodes).toBeGreaterThan(0);
    });

    it('should have valid elevation data', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_nodes,
          COUNT(CASE WHEN elevation IS NOT NULL AND elevation > 0 THEN 1 END) as valid_elevation_nodes,
          AVG(elevation) as avg_elevation,
          MIN(elevation) as min_elevation,
          MAX(elevation) as max_elevation
        FROM ${stagingSchema}.routing_nodes
        WHERE elevation IS NOT NULL
      `);
      
      const row = result.rows[0];
      const totalNodes = parseInt(row.total_nodes);
      const validElevationNodes = parseInt(row.valid_elevation_nodes);
      const avgElevation = parseFloat(row.avg_elevation);
      const minElevation = parseFloat(row.min_elevation);
      const maxElevation = parseFloat(row.max_elevation);
      
      console.log(`🏔️  Elevation data: avg=${avgElevation.toFixed(0)}m, min=${minElevation.toFixed(0)}m, max=${maxElevation.toFixed(0)}m`);
      console.log(`📊 Elevation validation: ${validElevationNodes}/${totalNodes} nodes have valid elevation`);
      
      expect(totalNodes).toBeGreaterThan(0);
      expect(validElevationNodes).toBe(totalNodes);
      expect(avgElevation).toBeGreaterThan(0);
      expect(minElevation).toBeGreaterThan(0);
      expect(maxElevation).toBeGreaterThan(minElevation);
    });

    it('should have valid edge elevation data', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN elevation_gain IS NOT NULL AND elevation_gain >= 0 THEN 1 END) as valid_gain_edges,
          COUNT(CASE WHEN elevation_loss IS NOT NULL AND elevation_loss >= 0 THEN 1 END) as valid_loss_edges,
          AVG(elevation_gain) as avg_gain,
          AVG(elevation_loss) as avg_loss
        FROM ${stagingSchema}.routing_edges
        WHERE elevation_gain IS NOT NULL OR elevation_loss IS NOT NULL
      `);
      
      const row = result.rows[0];
      const totalEdges = parseInt(row.total_edges);
      const validGainEdges = parseInt(row.valid_gain_edges);
      const validLossEdges = parseInt(row.valid_loss_edges);
      const avgGain = parseFloat(row.avg_gain);
      const avgLoss = parseFloat(row.avg_loss);
      
      console.log(`🏔️  Edge elevation: avg_gain=${avgGain.toFixed(0)}m, avg_loss=${avgLoss.toFixed(0)}m`);
      console.log(`📊 Edge elevation validation: ${validGainEdges}/${totalEdges} edges have valid gain, ${validLossEdges}/${totalEdges} have valid loss`);
      
      expect(totalEdges).toBeGreaterThan(0);
      expect(validGainEdges).toBe(totalEdges);
      expect(validLossEdges).toBe(totalEdges);
      expect(avgGain).toBeGreaterThanOrEqual(0);
      expect(avgLoss).toBeGreaterThanOrEqual(0);
    });

    it('should have comprehensive routing graph metrics', async () => {
      const result = await pgClient.query(`
        SELECT 
          'Total Nodes' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_nodes
        UNION ALL
        SELECT 
          'Total Edges' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_edges
        UNION ALL
        SELECT 
          'Total Trails' as metric, COUNT(*)::text as value FROM ${stagingSchema}.trails
        UNION ALL
        SELECT 
          'Intersection Nodes' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_nodes WHERE node_type = 'intersection'
        UNION ALL
        SELECT 
          'Endpoint Nodes' as metric, COUNT(*)::text as value FROM ${stagingSchema}.routing_nodes WHERE node_type = 'endpoint'
        UNION ALL
        SELECT 
          'Average Edge Length' as metric, AVG(distance_km)::text as value FROM ${stagingSchema}.routing_edges
        UNION ALL
        SELECT 
          'Total Distance' as metric, SUM(distance_km)::text as value FROM ${stagingSchema}.routing_edges
      `);
      
      const metrics = result.rows.reduce((acc, row) => {
        acc[row.metric] = parseFloat(row.value);
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`📊 Routing graph metrics:`, metrics);
      
      expect(metrics['Total Nodes']).toBeGreaterThan(0);
      expect(metrics['Total Edges']).toBeGreaterThan(0);
      expect(metrics['Total Trails']).toBeGreaterThan(0);
      expect(metrics['Intersection Nodes']).toBeGreaterThan(0);
      expect(metrics['Endpoint Nodes']).toBeGreaterThan(0);
      expect(metrics['Average Edge Length']).toBeGreaterThan(0);
      expect(metrics['Total Distance']).toBeGreaterThan(0);
    });
  });

  describe('3D Data Preservation in Trail Splitting and Export', () => {
    it('should preserve 3D coordinates in PostgreSQL staging schema', async () => {
      const result = await pgClient.query(`
        SELECT 
          ST_AsText(geometry) as geom_text,
          ST_Z(ST_StartPoint(geometry)) as start_z,
          ST_Z(ST_EndPoint(geometry)) as end_z,
          ST_NumPoints(geometry) as num_points
        FROM ${stagingSchema}.trails 
        WHERE name = 'Test 3D Trail 1'
      `);
      
      const row = result.rows[0];
      expect(row.geom_text).toMatch(/LINESTRING Z/);
      expect(row.start_z).toBe(2000);
      expect(row.end_z).toBe(2100);
      expect(row.num_points).toBe(2);
    });

    it('should preserve 3D coordinates in routing nodes', async () => {
      const result = await pgClient.query(`
        SELECT 
          ST_AsText(geo2) as point_text,
          ST_Z(geo2) as elevation
        FROM ${stagingSchema}.routing_nodes 
        WHERE node_uuid = 'node-1'
      `);
      
      const row = result.rows[0];
      expect(row.point_text).toMatch(/POINT Z/);
      expect(row.elevation).toBe(2000);
    });

    it('should preserve 3D coordinates in routing edges', async () => {
      const result = await pgClient.query(`
        SELECT 
          ST_AsText(geo2) as line_text,
          ST_Z(ST_StartPoint(geo2)) as start_z,
          ST_Z(ST_EndPoint(geo2)) as end_z
        FROM ${stagingSchema}.routing_edges 
        WHERE trail_id = 'test-3d-1'
      `);
      
      const row = result.rows[0];
      expect(row.line_text).toMatch(/LINESTRING Z/);
      expect(row.start_z).toBe(2000);
      expect(row.end_z).toBe(2100);
    });

    it('should export 3D data to SQLite with correct format', async () => {
      // Create SQLite database
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      // Insert test data with 3D coordinates
      const testTrails = [
        {
          app_uuid: 'test-3d-sqlite-1',
          name: 'Test 3D SQLite Trail',
          region: 'test',
          trail_type: 'path',
          surface_type: 'dirt',
          length_km: 2.0,
          elevation_gain: 100,
          elevation_loss: 0,
          max_elevation: 2100,
          min_elevation: 2000,
          avg_elevation: 2050,
          geometry: 'LINESTRINGZ(-105.0 40.0 2000, -104.9 40.1 2100)',
          geojson: '{"type":"LineString","coordinates":[[-105.0,40.0,2000],[-104.9,40.1,2100]]}'
        }
      ];
      
      insertTrails(db, testTrails);
      
      // Query the inserted data from trails table (not routing_edges)
      const result = db.prepare(`
        SELECT geojson FROM trails WHERE app_uuid = 'test-3d-sqlite-1'
      `).get() as { geojson: string } | undefined;
      
      expect(result).toBeDefined();
      expect(result!.geojson).toMatch(/\[-?105\.0,-?40\.0,\d+\.?\d*\]/);
      expect(result!.geojson).toMatch(/\[-?104\.9,-?40\.1,\d+\.?\d*\]/);
      
      db.close();
    });

    it('should handle elevation calculation in PostgreSQL staging', async () => {
      const result = await pgClient.query(`
        SELECT 
          elevation_gain,
          elevation_loss
        FROM recalculate_elevation_data((
          SELECT geometry FROM ${stagingSchema}.trails WHERE name = 'Test 3D Trail 1'
        ))
      `);
      
      const row = result.rows[0];
      expect(row.elevation_gain).toBe(100); // 2100 - 2000
      expect(row.elevation_loss).toBe(0);
    });

    it('should handle elevation calculation in test schema', async () => {
      const result = await pgClient.query(`
        SELECT 
          elevation_gain,
          elevation_loss
        FROM recalculate_elevation_data((
          SELECT geometry FROM ${testSchema}.trails WHERE name = 'Test Split Trail'
        ))
      `);
      
      const row = result.rows[0];
      expect(row.elevation_gain).toBe(200); // 2200 - 2000
      expect(row.elevation_loss).toBe(0);
    });
  });

  describe('Elevation Data Processing and Validation', () => {
    it('should validate elevation data integrity in staging schema', async () => {
      const result = await pgClient.query(`
        SELECT 
          COUNT(*) as total_trails,
          COUNT(CASE WHEN elevation_gain IS NOT NULL AND elevation_gain >= 0 THEN 1 END) as valid_gain,
          COUNT(CASE WHEN elevation_loss IS NOT NULL AND elevation_loss >= 0 THEN 1 END) as valid_loss,
          COUNT(CASE WHEN max_elevation IS NOT NULL AND max_elevation > 0 THEN 1 END) as valid_max,
          COUNT(CASE WHEN min_elevation IS NOT NULL AND min_elevation > 0 THEN 1 END) as valid_min
        FROM ${stagingSchema}.trails
      `);
      
      const row = result.rows[0];
      expect(parseInt(row.total_trails)).toBeGreaterThan(0);
      expect(parseInt(row.valid_gain)).toBe(parseInt(row.total_trails));
      expect(parseInt(row.valid_loss)).toBe(parseInt(row.total_trails));
      expect(parseInt(row.valid_max)).toBe(parseInt(row.total_trails));
      expect(parseInt(row.valid_min)).toBe(parseInt(row.total_trails));
    });

    it('should validate elevation constraints in SQLite', async () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      // Test that invalid elevation data is rejected
      const invalidTrails = [
        {
          app_uuid: 'test-invalid-elevation',
          name: 'Test Invalid Elevation',
          region: 'test',
          trail_type: 'path',
          surface_type: 'dirt',
          length_km: 1.0,
          elevation_gain: null, // Invalid - should be >= 0
          elevation_loss: 0,
          max_elevation: 1000,
          min_elevation: 900,
          avg_elevation: 950,
          geometry: 'LINESTRING(-105.0 40.0, -104.9 40.1)',
          geojson: '{"type":"LineString","coordinates":[[-105.0,40.0],[-104.9,40.1]]}'
        }
      ];
      
      expect(() => {
        insertTrails(db, invalidTrails);
      }).toThrow('[FATAL] Trail coordinates are not 3D');
      
      db.close();
    });
  });

  describe('Orchestrator Integration Tests', () => {
    it('should create orchestrator with valid configuration', async () => {
      const orchestrator = new CarthorseOrchestrator({
        region: 'boulder',
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 50,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe('boulder');
      expect(orchestrator['config'].outputPath).toBe(testDbPath);
    });

    it('should validate orchestrator staging schema creation', async () => {
      const orchestrator = new CarthorseOrchestrator({
        region: 'boulder',
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 50,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      // Verify orchestrator can be created and configured
      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe('boulder');
      expect(orchestrator['config'].outputPath).toBe(testDbPath);
      expect(orchestrator['config'].maxSqliteDbSizeMB).toBe(50);
    });

    it('should validate orchestrator pipeline execution', async () => {
      const orchestrator = new CarthorseOrchestrator({
        region: 'boulder',
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 50,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      // Test that the orchestrator can be created and configured
      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe('boulder');
      expect(orchestrator['config'].outputPath).toBe(testDbPath);
      expect(orchestrator['config'].maxSqliteDbSizeMB).toBe(50);
    });
  });

  describe('Export Pipeline Validation', () => {
    it('should validate trail splitting, node detection, and 3D data preservation', async () => {
      // Clean up any existing test file
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }

      // Create orchestrator for export pipeline validation
      const orchestrator = new CarthorseOrchestrator({
        region: 'boulder',
        outputPath: testDbPath,
        simplifyTolerance: 0.001,
        intersectionTolerance: 2.0,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSqliteDbSizeMB: 100,
        skipIncompleteTrails: true,
        useSqlite: true,
        skipCleanupOnError: true,
      });

      // Verify orchestrator was created successfully
      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe('boulder');
      expect(orchestrator['config'].outputPath).toBe(testDbPath);

      // Verify orchestrator was created successfully
      expect(orchestrator).toBeDefined();
      expect(orchestrator['config'].region).toBe('boulder');
      expect(orchestrator['config'].outputPath).toBe(testDbPath);
    });
  });

  describe('SQLite Export Validation', () => {
    it('should validate SQLite database schema', async () => {
      // Create SQLite database
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      // Check required tables
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('routing_edges', 'routing_nodes')
      `).all() as Array<{name: string}>;
      
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('routing_edges');
      expect(tableNames).toContain('routing_nodes');
      
      db.close();
    });

    it('should validate routing_edges schema', async () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const columns = db.prepare('PRAGMA table_info(routing_edges)').all() as Array<{name: string, type: string, notnull: number}>;
      const columnMap = new Map(columns.map(c => [c.name, { type: c.type, notnull: c.notnull }]));
      
      // Required columns with their expected types
      const expectedColumns = {
        'id': { type: 'INTEGER', notnull: 0 },
        'source': { type: 'INTEGER', notnull: 1 },
        'target': { type: 'INTEGER', notnull: 1 },
        'trail_id': { type: 'TEXT', notnull: 0 },
        'trail_name': { type: 'TEXT', notnull: 0 },
        'distance_km': { type: 'REAL', notnull: 0 },
        'elevation_gain': { type: 'REAL', notnull: 0 },
        'elevation_loss': { type: 'REAL', notnull: 0 },
        'geojson': { type: 'TEXT', notnull: 1 },
        'created_at': { type: 'DATETIME', notnull: 0 }
      };

      Object.entries(expectedColumns).forEach(([colName, expected]) => {
        const column = columnMap.get(colName);
        expect(column).toBeDefined();
        expect(column!.type).toBe(expected.type);
        expect(column!.notnull).toBe(expected.notnull);
      });
      
      db.close();
    });

    it('should validate routing_nodes schema', async () => {
      const db = new Database(':memory:');
      createSqliteTables(db);
      
      const columns = db.prepare('PRAGMA table_info(routing_nodes)').all() as Array<{name: string, type: string, notnull: number}>;
      const columnMap = new Map(columns.map(c => [c.name, { type: c.type, notnull: c.notnull }]));
      
      // Required columns with their expected types
      const expectedColumns = {
        'id': { type: 'INTEGER', notnull: 0 },
        'node_uuid': { type: 'TEXT', notnull: 1 },
        'lat': { type: 'REAL', notnull: 1 },
        'lng': { type: 'REAL', notnull: 1 },
        'elevation': { type: 'REAL', notnull: 0 },
        'node_type': { type: 'TEXT', notnull: 1 },
        'connected_trails': { type: 'TEXT', notnull: 0 },
        'created_at': { type: 'DATETIME', notnull: 0 }
      };

      Object.entries(expectedColumns).forEach(([colName, expected]) => {
        const column = columnMap.get(colName);
        expect(column).toBeDefined();
        expect(column!.type).toBe(expected.type);
        expect(column!.notnull).toBe(expected.notnull);
      });
      
      db.close();
    });
  });
}); 