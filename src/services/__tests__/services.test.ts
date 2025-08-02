import { Client } from 'pg';
import { PostgresDatabaseService } from '../DatabaseService';
import { PostgresStagingService } from '../StagingService';
import { PostgresRoutingService } from '../RoutingService';

// Mock Client for testing
const mockClient = {
  connect: jest.fn(),
  end: jest.fn(),
  query: jest.fn()
} as unknown as Client;

describe('Services', () => {
  let databaseService: PostgresDatabaseService;
  let stagingService: PostgresStagingService;
  let routingService: PostgresRoutingService;

  beforeEach(() => {
    jest.clearAllMocks();
    databaseService = new PostgresDatabaseService(mockClient);
    stagingService = new PostgresStagingService(mockClient, databaseService);
    routingService = new PostgresRoutingService(mockClient, databaseService);
  });

  describe('DatabaseService', () => {
    it('should connect to database', async () => {
      await databaseService.connect();
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('should disconnect from database', async () => {
      await databaseService.disconnect();
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should execute query', async () => {
      const mockResult = { rows: [{ version: 7 }] };
      (mockClient.query as jest.Mock).mockResolvedValue(mockResult);

      const result = await databaseService.executeQuery('SELECT version FROM schema_version');
      expect(mockClient.query).toHaveBeenCalledWith('SELECT version FROM schema_version', undefined);
      expect(result).toEqual(mockResult);
    });

    it('should check schema version', async () => {
      const mockResult = { rows: [{ version: 7 }] };
      (mockClient.query as jest.Mock).mockResolvedValue(mockResult);

      await expect(databaseService.checkSchemaVersion(7)).resolves.not.toThrow();
    });

    it('should throw error for mismatched schema version', async () => {
      const mockResult = { rows: [{ version: 6 }] };
      (mockClient.query as jest.Mock).mockResolvedValue(mockResult);

      await expect(databaseService.checkSchemaVersion(7)).rejects.toThrow('Schema version mismatch');
    });
  });

  describe('StagingService', () => {
    it('should create staging environment', async () => {
      const mockSchemaExists = { rows: [] };
      const mockCreateSchema = { rows: [] };
      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce(mockSchemaExists)
        .mockResolvedValueOnce(mockCreateSchema);

      await stagingService.createStagingEnvironment('test_schema');
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('should copy region data', async () => {
      const mockCopyResult = { rowCount: 10 };
      const mockNodesResult = { rowCount: 10 };
      const mockEdgesResult = { rowCount: 10 };
      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce(mockCopyResult)
        .mockResolvedValueOnce(mockNodesResult)
        .mockResolvedValueOnce(mockEdgesResult);

      const result = await stagingService.copyRegionData('boulder');
      expect(result.trailsCopied).toBe(10);
      expect(result.nodesCopied).toBe(10);
      expect(result.edgesCopied).toBe(10);
    });

    it('should validate staging data', async () => {
      const mockValidationResult = {
        rows: [{
          total_trails: 100,
          null_geometry: 0,
          invalid_geometry: 0,
          zero_or_null_length: 0,
          self_loops: 5,
          zero_length_geometry: 0,
          single_point_geometry: 0
        }]
      };
      (mockClient.query as jest.Mock).mockResolvedValue(mockValidationResult);

      const result = await stagingService.validateStagingData('test_schema');
      expect(result.isValid).toBe(true);
      expect(result.stats.totalTrails).toBe(100);
      expect(result.warnings).toContain('5 trails are self-loops (start = end)');
    });
  });

  describe('RoutingService', () => {
    it('should detect intersections', async () => {
      const mockIntersectionResult = { rows: [{ id: 1 }, { id: 2 }] };
      (mockClient.query as jest.Mock).mockResolvedValue(mockIntersectionResult);

      const result = await routingService.detectIntersections('test_schema', 2.0);
      expect(result.intersectionCount).toBe(2);
      expect(result.intersections).toHaveLength(2);
    });

    it('should generate routing nodes', async () => {
      const mockClearNodesResult = { rowCount: 0 };
      const mockNodeResult = { rowCount: 50 };
      const mockNodeTypesResult = {
        rows: [
          { node_type: 'endpoint', count: '30' },
          { node_type: 'intersection', count: '20' }
        ]
      };
      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce(mockClearNodesResult)
        .mockResolvedValueOnce(mockNodeResult)
        .mockResolvedValueOnce(mockNodeTypesResult);

      const result = await routingService.generateRoutingNodes('test_schema', 2.0);
      expect(result.nodeCount).toBe(50);
      expect(result.nodeTypes.endpoint).toBe(30);
      expect(result.nodeTypes.intersection).toBe(20);
    });

    it('should generate routing edges', async () => {
      const mockClearEdgesResult = { rowCount: 0 };
      const mockNodeCountResult = { rows: [{ count: '50' }] };
      const mockEdgeResult = { rowCount: 100 };
      const mockOrphanedNodesResult = { rowCount: 5 };
      const mockOrphanedEdgesResult = { rowCount: 2 };
      const mockFinalNodeCountResult = { rows: [{ count: '45' }] };
      const mockFinalEdgeCountResult = { rows: [{ count: '98' }] };

      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce(mockClearEdgesResult)
        .mockResolvedValueOnce(mockNodeCountResult)
        .mockResolvedValueOnce(mockEdgeResult)
        .mockResolvedValueOnce(mockOrphanedNodesResult)
        .mockResolvedValueOnce(mockOrphanedEdgesResult)
        .mockResolvedValueOnce(mockFinalNodeCountResult)
        .mockResolvedValueOnce(mockFinalEdgeCountResult);

      const result = await routingService.generateRoutingEdges('test_schema', 20.0);
      expect(result.edgeCount).toBe(100);
      expect(result.orphanedNodesRemoved).toBe(5);
      expect(result.orphanedEdgesRemoved).toBe(2);
    });

    it('should validate routing network', async () => {
      const mockIsolatedNodesResult = { rows: [{ count: '0' }] };
      const mockOrphanedEdgesResult = { rows: [{ count: '0' }] };
      const mockConnectivityResult = {
        rows: [{
          total_nodes: '45',
          connected_nodes: '40',
          leaf_nodes: '5',
          avg_degree: '2.5'
        }]
      };

      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce(mockIsolatedNodesResult)
        .mockResolvedValueOnce(mockOrphanedEdgesResult)
        .mockResolvedValueOnce(mockConnectivityResult);

      const result = await routingService.validateRoutingNetwork('test_schema');
      expect(result.isConnected).toBe(true);
      expect(result.isolatedNodes).toBe(0);
      expect(result.orphanedEdges).toBe(0);
      expect(result.connectivityStats.totalNodes).toBe(45);
      expect(result.connectivityStats.connectedNodes).toBe(40);
      expect(result.connectivityStats.leafNodes).toBe(5);
      expect(result.connectivityStats.avgDegree).toBe(2.5);
    });
  });
}); 