/**
 * PgRouting Orchestrator Tests
 * 
 * Tests for the PgRoutingOrchestrator class that uses pgRouting
 * to generate routing networks in staging tables for export
 */

import { Client } from 'pg';
import { PgRoutingOrchestrator, PgRoutingOrchestratorConfig } from '../orchestrator/PgRoutingOrchestrator';
import { getTestDbConfig } from '../database/connection';

// Mock the required modules
jest.mock('../utils/env', () => ({
  getDbConfig: jest.fn(() => ({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db_test',
    user: 'tester',
    password: 'test'
  })),
  validateTestEnvironment: jest.fn(() => true)
}));

jest.mock('../utils/sql/staging-schema', () => ({
  getStagingSchemaSql: jest.fn(() => `
    CREATE TABLE staging_test.trails (
      id SERIAL PRIMARY KEY,
      app_uuid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      geometry GEOMETRY(LINESTRINGZ, 4326)
    );
    
    CREATE TABLE staging_test.routing_nodes (
      id SERIAL PRIMARY KEY,
      node_uuid TEXT UNIQUE,
      lat REAL,
      lng REAL,
      elevation REAL,
      node_type TEXT,
      connected_trails TEXT,
      trail_ids TEXT[]
    );
    
    CREATE TABLE staging_test.routing_edges (
      id SERIAL PRIMARY KEY,
      source INTEGER,
      target INTEGER,
      trail_id TEXT,
      trail_name TEXT,
      length_km REAL,
      elevation_gain REAL,
      elevation_loss REAL,
      is_bidirectional BOOLEAN,
      geometry geometry(LineString, 4326)
    );
  `)
}));

jest.mock('../utils/cleanup-service', () => ({
  CleanupService: jest.fn().mockImplementation(() => ({
    cleanAllTestStagingSchemas: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../utils/elevation-service', () => ({
  ElevationService: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../utils/validation-service', () => ({
  ValidationService: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../orchestrator/orchestrator-hooks', () => ({
  OrchestratorHooks: jest.fn().mockImplementation(() => ({}))
}));

describe('PgRoutingOrchestrator', () => {
  let orchestrator: PgRoutingOrchestrator;
  let mockPgClient: jest.Mocked<Client>;
  let testConfig: PgRoutingOrchestratorConfig;

  beforeEach(() => {
    // Create mock PostgreSQL client
    mockPgClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as any;

    // Mock the Client constructor
    jest.spyOn(require('pg'), 'Client').mockImplementation(() => mockPgClient);

    // Test configuration
    testConfig = {
      region: 'boulder',
      outputPath: 'data/test-pgrouting.db',
      pgroutingTolerance: 0.0001,
      usePgroutingTopology: true,
      exportRoutingNetwork: true,
      simplifyTolerance: 0.001,
      intersectionTolerance: 2.0,
      replace: false,
      validate: true,
      verbose: false,
      skipBackup: false,
      buildMaster: false,
      targetSizeMB: null,
      maxSqliteDbSizeMB: 100,
      skipIncompleteTrails: false,
      useSqlite: false,
      useIntersectionNodes: true,
      useSplitTrails: true,
      aggressiveCleanup: true,
      cleanupOldStagingSchemas: true,
      cleanupTempFiles: true,
      maxStagingSchemasToKeep: 2,
      cleanupDatabaseLogs: false,
      skipValidation: false,
      skipBboxValidation: false,
      skipGeometryValidation: false,
      skipTrailValidation: false,
      skipRecommendations: false,
      targetSchemaVersion: 8
    };

    orchestrator = new PgRoutingOrchestrator(testConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should create orchestrator with default configuration', () => {
      const defaultOrchestrator = new PgRoutingOrchestrator();
      
      expect(defaultOrchestrator).toBeDefined();
      expect(defaultOrchestrator.stagingSchema).toMatch(/^staging_boulder_\d+$/);
    });

    test('should create orchestrator with custom configuration', () => {
      const customConfig: PgRoutingOrchestratorConfig = {
        ...testConfig,
        region: 'seattle',
        pgroutingTolerance: 0.0005
      };
      
      const customOrchestrator = new PgRoutingOrchestrator(customConfig);
      
      expect(customOrchestrator).toBeDefined();
      expect(customOrchestrator.stagingSchema).toMatch(/^staging_seattle_\d+$/);
    });
  });

  describe('checkRequiredSqlFunctions', () => {
    test('should check pgRouting extension availability', async () => {
      // Mock successful pgRouting check
      mockPgClient.query
        .mockResolvedValueOnce({ rows: [{ pgrouting_available: true }] }) // pgRouting extension check
        .mockResolvedValueOnce({ rows: [{ function_available: true }] }) // pgr_nodeNetwork check
        .mockResolvedValueOnce({ rows: [{ function_available: true }] }) // pgr_createTopology check
        .mockResolvedValueOnce({ rows: [{ function_available: true }] }); // pgr_analyzeGraph check

      await orchestrator['checkRequiredSqlFunctions']();
      
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = \'pgrouting\')')
      );
    });

    test('should throw error if pgRouting extension not available', async () => {
      mockPgClient.query.mockResolvedValueOnce({ rows: [{ pgrouting_available: false }] });

      await expect(orchestrator['checkRequiredSqlFunctions']()).rejects.toThrow(
        '❌ pgRouting extension is not installed'
      );
    });

    test('should throw error if required pgRouting functions not available', async () => {
      mockPgClient.query
        .mockResolvedValueOnce({ rows: [{ pgrouting_available: true }] })
        .mockResolvedValueOnce({ rows: [{ function_available: false }] });

      await expect(orchestrator['checkRequiredSqlFunctions']()).rejects.toThrow(
        '❌ Required pgRouting function \'pgr_nodeNetwork\' is not available'
      );
    });
  });

  describe('createStagingEnvironment', () => {
    test('should create staging environment with pgRouting tables', async () => {
      mockPgClient.query
        .mockResolvedValueOnce({ rows: [] }) // DROP SCHEMA
        .mockResolvedValueOnce({ rows: [] }) // CREATE SCHEMA
        .mockResolvedValueOnce({ rows: [] }) // Create staging tables
        .mockResolvedValueOnce({ rows: [] }); // Create pgRouting tables

      await orchestrator['createStagingEnvironment']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining(`DROP SCHEMA IF EXISTS ${orchestrator.stagingSchema} CASCADE`)
      );
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining(`CREATE SCHEMA ${orchestrator.stagingSchema}`)
      );
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE')
      );
    });
  });

  describe('copyRegionDataToStaging', () => {
    test('should copy region data to staging schema', async () => {
      mockPgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 100 });

      await orchestrator['copyRegionDataToStaging']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        ['boulder']
      );
    });

    test('should copy region data with bbox filter', async () => {
      const bbox: [number, number, number, number] = [-105.281, 40.066, -105.235, 40.105];
      mockPgClient.query.mockResolvedValueOnce({ rows: [], rowCount: 50 });

      await orchestrator['copyRegionDataToStaging'](bbox);

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('ST_MakeEnvelope'),
        ['boulder']
      );
    });
  });

  describe('generatePgRoutingNetwork', () => {
    test('should generate routing network using pgRouting', async () => {
      mockPgClient.query
        .mockResolvedValueOnce({ rows: [{ pgr_nodeNetwork: 'success' }] }) // Node network
        .mockResolvedValueOnce({ rows: [{ pgr_createTopology: 'success' }] }) // Topology
        .mockResolvedValueOnce({ rows: [{ pgr_analyzeGraph: 'success' }] }) // Analyze
        .mockResolvedValueOnce({ rows: [], rowCount: 100 }) // Generate nodes
        .mockResolvedValueOnce({ rows: [], rowCount: 200 }); // Generate edges

      await orchestrator['generatePgRoutingNetwork']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pgr_nodeNetwork')
      );
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pgr_createTopology')
      );
      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pgr_analyzeGraph')
      );
    });
  });

  describe('createNodeNetwork', () => {
    test('should create node network using pgRouting', async () => {
      const tolerance = 0.0001;
      mockPgClient.query.mockResolvedValueOnce({ rows: [{ pgr_nodeNetwork: 'success' }] });

      await orchestrator['createNodeNetwork'](tolerance);

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pgr_nodeNetwork')
      );
    });
  });

  describe('createTopology', () => {
    test('should create topology using pgRouting', async () => {
      mockPgClient.query.mockResolvedValueOnce({ rows: [{ pgr_createTopology: 'success' }] });

      await orchestrator['createTopology']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pgr_createTopology')
      );
    });
  });

  describe('analyzeGraph', () => {
    test('should analyze graph using pgRouting', async () => {
      mockPgClient.query.mockResolvedValueOnce({ rows: [{ pgr_analyzeGraph: 'success' }] });

      await orchestrator['analyzeGraph']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pgr_analyzeGraph')
      );
    });
  });

  describe('generateRoutingNodesAndEdges', () => {
    test('should generate routing nodes and edges from pgRouting results', async () => {
      mockPgClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 100 }) // Generate nodes
        .mockResolvedValueOnce({ rows: [], rowCount: 200 }); // Generate edges

      await orchestrator['generateRoutingNodesAndEdges']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO')
      );
    });
  });

  describe('validateExport', () => {
    test('should validate export results', async () => {
      mockPgClient.query
        .mockResolvedValueOnce({ rows: [{ count: 100 }] }) // Node count
        .mockResolvedValueOnce({ rows: [{ count: 200 }] }); // Edge count

      await orchestrator['validateExport']();

      expect(mockPgClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) FROM')
      );
    });
  });

  describe('run', () => {
    test('should run complete pgRouting pipeline', async () => {
      // Mock all the required methods
      jest.spyOn(orchestrator as any, 'checkRequiredSqlFunctions').mockResolvedValue();
      jest.spyOn(orchestrator as any, 'createStagingEnvironment').mockResolvedValue();
      jest.spyOn(orchestrator as any, 'copyRegionDataToStaging').mockResolvedValue();
      jest.spyOn(orchestrator as any, 'generatePgRoutingNetwork').mockResolvedValue();
      jest.spyOn(orchestrator as any, 'exportDatabase').mockResolvedValue();
      jest.spyOn(orchestrator as any, 'validateExport').mockResolvedValue();
      jest.spyOn(orchestrator as any, 'performComprehensiveCleanup').mockResolvedValue();

      await orchestrator.run();

      expect(orchestrator['checkRequiredSqlFunctions']).toHaveBeenCalled();
      expect(orchestrator['createStagingEnvironment']).toHaveBeenCalled();
      expect(orchestrator['copyRegionDataToStaging']).toHaveBeenCalled();
      expect(orchestrator['generatePgRoutingNetwork']).toHaveBeenCalled();
      expect(orchestrator['exportDatabase']).toHaveBeenCalled();
      expect(orchestrator['validateExport']).toHaveBeenCalled();
      expect(orchestrator['performComprehensiveCleanup']).toHaveBeenCalled();
    });

    test('should handle errors gracefully', async () => {
      const error = new Error('Test error');
      jest.spyOn(orchestrator as any, 'checkRequiredSqlFunctions').mockRejectedValue(error);

      await expect(orchestrator.run()).rejects.toThrow('Test error');
    });
  });

  describe('cleanupStaging', () => {
    test('should cleanup staging schema', async () => {
      const mockCleanupService = {
        cleanAllTestStagingSchemas: jest.fn().mockResolvedValue(undefined)
      };
      (orchestrator as any).cleanupService = mockCleanupService;

      await orchestrator.cleanupStaging();

      expect(mockCleanupService.cleanAllTestStagingSchemas).toHaveBeenCalled();
    });
  });
}); 