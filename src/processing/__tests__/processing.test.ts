import { PostgresTrailProcessor } from '../TrailProcessor';
import { PostgresRoutingGraphProcessor } from '../RoutingGraphProcessor';
import { PostgresExportProcessor } from '../ExportProcessor';
import { PostgresDatabaseService } from '../../services/DatabaseService';

// Mock services for testing
const mockDatabaseService = {
  executeQuery: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn()
} as unknown as PostgresDatabaseService;

const mockValidationService = {
  validateAllTrailData: jest.fn(),
  validateBboxData: jest.fn(),
  validateGeometryData: jest.fn(),
  validateRoutingGraph: jest.fn()
} as any;

const mockRoutingService = {
  detectIntersections: jest.fn(),
  generateRoutingNodes: jest.fn(),
  generateRoutingEdges: jest.fn(),
  validateRoutingNetwork: jest.fn(),
  cleanupOrphanedNodes: jest.fn()
} as any;

describe('Processing Layer', () => {
  let trailProcessor: PostgresTrailProcessor;
  let routingGraphProcessor: PostgresRoutingGraphProcessor;
  let exportProcessor: PostgresExportProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    trailProcessor = new PostgresTrailProcessor(mockDatabaseService);
    routingGraphProcessor = new PostgresRoutingGraphProcessor(mockRoutingService, mockDatabaseService);
    exportProcessor = new PostgresExportProcessor(mockDatabaseService);
  });

  describe('TrailProcessor', () => {
    it('should process trails successfully', async () => {
      const mockValidationResult = {
        rows: [{
          total_trails: '100',
          null_geometry: '0',
          invalid_geometry: '0',
          zero_or_null_length: '0',
          self_loops: '5',
          zero_length_geometry: '0',
          single_point_geometry: '0'
        }]
      };

      const mockStatsResult = {
        rows: [{
          total_trails: '100',
          valid_trails: '95',
          invalid_trails: '5',
          null_geometry: '0',
          invalid_geometry: '0',
          zero_or_null_length: '0',
          self_loops: '5',
          zero_length_geometry: '0',
          single_point_geometry: '0',
          avg_length: '2.5',
          avg_elevation_gain: '150.0',
          avg_elevation_loss: '120.0'
        }]
      };

      (mockDatabaseService.executeQuery as jest.Mock)
        .mockResolvedValueOnce(mockValidationResult)
        .mockResolvedValueOnce(mockStatsResult);

      const result = await trailProcessor.processTrails('test_schema', 'boulder');
      
      expect(result.success).toBe(true);
      expect(result.trailsProcessed).toBe(100);
      expect(result.validTrails).toBe(95);
      expect(result.invalidTrails).toBe(5);
      expect(result.warnings).toContain('5 trails are self-loops (start = end)');
    });

    it('should validate trails for routing', async () => {
      const mockValidationResult = {
        rows: [{
          total_trails: '100',
          null_geometry: '0',
          invalid_geometry: '0',
          zero_or_null_length: '0',
          self_loops: '5',
          zero_length_geometry: '0',
          single_point_geometry: '0'
        }]
      };

      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue(mockValidationResult);

      const result = await trailProcessor.validateTrailsForRouting('test_schema');
      
      expect(result.isValid).toBe(true);
      expect(result.stats.totalTrails).toBe(100);
      expect(result.stats.validTrails).toBe(100);
      expect(result.stats.invalidTrails).toBe(0);
      expect(result.warnings).toContain('5 trails are self-loops (start = end)');
    });

    it('should calculate trail stats', async () => {
      const mockStatsResult = {
        rows: [{
          total_trails: '100',
          valid_trails: '95',
          invalid_trails: '5',
          null_geometry: '0',
          invalid_geometry: '0',
          zero_or_null_length: '0',
          self_loops: '5',
          zero_length_geometry: '0',
          single_point_geometry: '0',
          avg_length: '2.5',
          avg_elevation_gain: '150.0',
          avg_elevation_loss: '120.0'
        }]
      };

      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue(mockStatsResult);

      const result = await trailProcessor.calculateTrailStats('test_schema');
      
      expect(result.totalTrails).toBe(100);
      expect(result.validTrails).toBe(95);
      expect(result.invalidTrails).toBe(5);
      expect(result.avgLength).toBe(2.5);
      expect(result.avgElevationGain).toBe(150.0);
      expect(result.avgElevationLoss).toBe(120.0);
    });
  });

  describe('RoutingGraphProcessor', () => {
    it('should build routing graph successfully', async () => {
      const mockIntersectionResult = {
        intersectionCount: 10,
        intersections: []
      };

      const mockNodeResult = {
        nodeCount: 50,
        nodeTypes: { endpoint: 30, intersection: 20 }
      };

      const mockEdgeResult = {
        edgeCount: 100,
        orphanedNodesRemoved: 5,
        orphanedEdgesRemoved: 2
      };

      const mockValidationResult = {
        isConnected: true,
        isolatedNodes: 0,
        orphanedEdges: 0,
        connectivityStats: {
          totalNodes: 45,
          connectedNodes: 40,
          leafNodes: 5,
          avgDegree: 2.5
        }
      };

      (mockRoutingService.detectIntersections as jest.Mock).mockResolvedValue(mockIntersectionResult);
      (mockRoutingService.generateRoutingNodes as jest.Mock).mockResolvedValue(mockNodeResult);
      (mockRoutingService.generateRoutingEdges as jest.Mock).mockResolvedValue(mockEdgeResult);
      (mockRoutingService.validateRoutingNetwork as jest.Mock).mockResolvedValue(mockValidationResult);

      const config = {
        nodeTolerance: 2.0,
        spatialTolerance: 20.0,
        minTrailLengthMeters: 0.0,
        enableIntersectionDetection: true,
        enableNodeGeneration: true,
        enableEdgeGeneration: true,
        enableNetworkValidation: true
      };

      const result = await routingGraphProcessor.buildRoutingGraph('test_schema', config);
      
      expect(result.success).toBe(true);
      expect(result.nodeCount).toBe(50);
      expect(result.edgeCount).toBe(100);
      expect(result.intersectionCount).toBe(10);
      expect(result.isConnected).toBe(true);
      expect(result.orphanedNodesRemoved).toBe(5);
      expect(result.orphanedEdgesRemoved).toBe(2);
    });

    it('should optimize routing graph', async () => {
      (mockRoutingService.cleanupOrphanedNodes as jest.Mock).mockResolvedValue(5);
      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue({ rowCount: 2 });

      const config = {
        removeIsolatedNodes: true,
        removeOrphanedEdges: true,
        mergeCloseNodes: false,
        nodeMergeTolerance: 1.0
      };

      const result = await routingGraphProcessor.optimizeRoutingGraph('test_schema', config);
      
      expect(result.success).toBe(true);
      expect(result.nodesRemoved).toBe(5);
      expect(result.edgesRemoved).toBe(2);
      expect(result.nodesMerged).toBe(0);
    });

    it('should validate routing graph', async () => {
      const mockValidationResult = {
        isConnected: true,
        isolatedNodes: 0,
        orphanedEdges: 0,
        connectivityStats: {
          totalNodes: 45,
          connectedNodes: 40,
          leafNodes: 5,
          avgDegree: 2.5
        }
      };

      const mockCountResults = {
        rows: [{ count: '45' }]
      };

      (mockRoutingService.validateRoutingNetwork as jest.Mock).mockResolvedValue(mockValidationResult);
      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue(mockCountResults);

      const result = await routingGraphProcessor.validateRoutingGraph('test_schema');
      
      expect(result.success).toBe(true);
      expect(result.nodeCount).toBe(45);
      expect(result.edgeCount).toBe(45);
      expect(result.intersectionCount).toBe(45);
      expect(result.isConnected).toBe(true);
    });
  });

  describe('ExportProcessor', () => {
    it('should process SQLite export successfully', async () => {
      const mockStatsResult = {
        rows: [{
          trail_count: '100',
          node_count: '50',
          edge_count: '200',
          recommendation_count: '25'
        }]
      };

      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue(mockStatsResult);

      const config = {
        region: 'boulder',
        simplifyTolerance: 0.001,
        maxSqliteDbSizeMB: 400,
        skipIncompleteTrails: true
      };

      const result = await exportProcessor.processSqliteExport('test_schema', config);
      
      expect(result.success).toBe(true);
      expect(result.trailCount).toBe(100);
      expect(result.nodeCount).toBe(50);
      expect(result.edgeCount).toBe(200);
      expect(result.recommendationCount).toBe(25);
      expect(result.schemaVersion).toBe(14);
    });

    it('should process GeoJSON export successfully', async () => {
      const mockStatsResult = {
        rows: [{
          trail_count: '100',
          node_count: '50',
          edge_count: '200',
          recommendation_count: '25'
        }]
      };

      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue(mockStatsResult);

      const config = {
        region: 'boulder',
        simplifyTolerance: 0.001,
        maxSqliteDbSizeMB: 400,
        skipIncompleteTrails: true
      };

      const result = await exportProcessor.processGeoJSONExport('test_schema', config);
      
      expect(result.success).toBe(true);
      expect(result.trailCount).toBe(100);
      expect(result.nodeCount).toBe(50);
      expect(result.edgeCount).toBe(200);
      expect(result.recommendationCount).toBe(25);
      expect(result.schemaVersion).toBe(14);
    });

    it('should get export stats', async () => {
      const mockStatsResult = {
        rows: [{
          trail_count: '100',
          node_count: '50',
          edge_count: '200',
          recommendation_count: '25'
        }]
      };

      (mockDatabaseService.executeQuery as jest.Mock).mockResolvedValue(mockStatsResult);

      const result = await exportProcessor.getExportStats('test_schema');
      
      expect(result.trailCount).toBe(100);
      expect(result.nodeCount).toBe(50);
      expect(result.edgeCount).toBe(200);
      expect(result.recommendationCount).toBe(25);
      expect(result.schemaVersion).toBe(14);
    });
  });
}); 