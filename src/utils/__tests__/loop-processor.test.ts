import { LoopProcessor } from '../loop-processor';
import { Client } from 'pg';

// Mock the pg Client
const mockQuery = jest.fn();
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

describe('LoopProcessor', () => {
  let mockClient: Client;
  let loopProcessor: LoopProcessor;
  const stagingSchema = 'test_staging';

  beforeEach(() => {
    mockClient = new Client();
    loopProcessor = new LoopProcessor(mockClient, stagingSchema);
    mockQuery.mockClear();
  });

  describe('detectAndProcessLoops', () => {
    it('should handle case when no loops are found', async () => {
      // Mock query responses
      mockQuery.mockResolvedValueOnce({ rows: [{ loop_count: '0' }] }); // No loops found

      await loopProcessor.detectAndProcessLoops(2.0, 20.0);

      // Verify the loop count query was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as loop_count')
      );
    });

    it('should process loops when they are found', async () => {
      // Mock query responses for loop processing
      mockQuery
        .mockResolvedValueOnce({ rows: [{ loop_count: '2' }] }) // 2 loops found
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TEMP TABLE loop_edges
        .mockResolvedValueOnce({ rows: [{ count: '8' }] }) // 8 loop edge segments
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_nodes_raw
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TEMP TABLE loop_nodes_raw
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_nodes
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TEMP TABLE loop_nodes
        .mockResolvedValueOnce({ rows: [{ count: '4' }] }) // 4 unique loop nodes
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_edge_network
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TEMP TABLE loop_edge_network
        .mockResolvedValueOnce({ rows: [{ count: '6' }] }) // 6 loop network edges
        .mockResolvedValueOnce({ rowCount: 2 }) // Added 2 loop nodes
        .mockResolvedValueOnce({ rowCount: 3 }) // Added 3 loop edges
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_edges
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_nodes_raw
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_nodes
        .mockResolvedValueOnce({ rowCount: 0 }) // DROP TABLE loop_edge_network
        .mockResolvedValueOnce({ rows: [{ loop_node_count: '2' }] }) // Final loop nodes
        .mockResolvedValueOnce({ rows: [{ loop_edge_count: '3' }] }); // Final loop edges

      await loopProcessor.detectAndProcessLoops(2.0, 20.0);

      // Verify the main processing queries were called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TEMP TABLE test_staging.loop_edges')
      );
    });
  });

  describe('getLoopStatistics', () => {
    it('should return loop statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ loop_count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ loop_node_count: '10' }] })
        .mockResolvedValueOnce({ rows: [{ loop_edge_count: '15' }] });

      const stats = await loopProcessor.getLoopStatistics();

      expect(stats).toEqual({
        totalLoops: 5,
        loopNodes: 10,
        loopEdges: 15,
      });
    });
  });
}); 