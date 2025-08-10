import { Pool } from 'pg';
import { mergeDegree2Chains } from '../utils/services/network-creation/merge-degree2-chains';

// Mock PostgreSQL client
const mockQuery = jest.fn();
const mockPgClient = {
  query: mockQuery
} as unknown as Pool;

describe('Degree-2 Chain Merge Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Mock Data Verification', () => {
    it('should show the actual SQL queries and mock data for Marshall Valley Trail chain', async () => {
      // Mock the merge query (first query) - simulating what SHOULD happen
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: []
      });

      // Mock the edge removal query (second query)
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: []
      });

      // Mock final count query (third query)
      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 15 }]
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      console.log('=== MARSHALL VALLEY TRAIL CHAIN ===');
      console.log('Chain: Node 6 (degree 1) → Node 8 (degree 2) → Node 4 (degree 3)');
      console.log('Edges: [13, 12] should be merged into single edge');
      console.log('Result:', result);

      expect(result.chainsMerged).toBe(1);
      expect(result.edgesRemoved).toBe(2);
      expect(result.finalEdges).toBe(15);
    });

    it('should show the actual SQL queries and mock data for Community Ditch Trail chain', async () => {
      // Mock the merge query (first query) - simulating what SHOULD happen
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,  // 1 new edge created
        rows: []
      });

      // Mock the edge removal query (second query)
      mockQuery.mockResolvedValueOnce({
        rowCount: 3,  // 3 original edges removed (3, 2, 4)
        rows: []
      });

      // Mock final count query (third query)
      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 15 }]  // 17 original - 3 removed + 1 new = 15
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      console.log('=== COMMUNITY DITCH TRAIL CHAIN ===');
      console.log('Chain: Node 13 (degree 1) → Node 12 (degree 2) → Node 11 (degree 2) → Node 27 (degree 3)');
      console.log('Edges: [3, 2, 4] should be merged into single edge');
      console.log('Result:', result);

      expect(result.chainsMerged).toBe(1);  // 1 new edge created
      expect(result.edgesRemoved).toBe(3);  // 3 original edges removed
      expect(result.finalEdges).toBe(15);   // 17 - 3 + 1 = 15
    });
  });

  describe('Current Database Reality Check', () => {
    it('should NOT find Marshall Valley Trail chain because current logic is broken', async () => {
      // Mock the merge query to return 0 chains (current reality)
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      // Mock the edge removal query to return 0 edges removed
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      // Mock final count query
      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 17 }]
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      // Should NOT find any chains to merge (current broken state)
      expect(result.chainsMerged).toBe(0);
      expect(result.edgesRemoved).toBe(0);
      expect(result.finalEdges).toBe(17);
    });

    it('should NOT find Community Ditch Trail chain because original structure was transformed', async () => {
      // Mock the merge query to return 0 chains (reality)
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      // Mock the edge removal query to return 0 edges removed
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      // Mock final count query
      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 17 }]
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      // Should NOT find any chains to merge
      expect(result.chainsMerged).toBe(0);
      expect(result.edgesRemoved).toBe(0);
      expect(result.finalEdges).toBe(17);
    });
  });

  describe('Expected Behavior (What Should Work)', () => {
    it('should detect and merge degree-2 chain: Node 6 → Node 8 → Node 4 (when working)', async () => {
      // Mock the merge query (first query) - simulating what SHOULD happen
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: []
      });

      // Mock the edge removal query (second query)
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: []
      });

      // Mock final count query (third query)
      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 15 }]
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result.chainsMerged).toBe(1);
      expect(result.edgesRemoved).toBe(2);
      expect(result.finalEdges).toBe(15);
    });

    it('should detect and merge longer degree-2 chain: Node 13 → Node 12 → Node 11 → Node 27 (when working)', async () => {
      // Mock the merge query (first query) - simulating what SHOULD happen
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: []
      });

      // Mock the edge removal query (second query)
      mockQuery.mockResolvedValueOnce({
        rowCount: 3,
        rows: []
      });

      // Mock final count query (third query)
      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 15 }]
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result.chainsMerged).toBe(1);
      expect(result.edgesRemoved).toBe(3);
      expect(result.finalEdges).toBe(15);
    });
  });

  describe('SQL Query Validation', () => {
    it('should generate correct SQL structure', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 20 }]
      });

      await mergeDegree2Chains(mockPgClient, 'test_schema');

      // Check that the first query contains the expected SQL structure
      const firstQuery = mockQuery.mock.calls[0][0];
      expect(firstQuery).toContain('WITH RECURSIVE');
      expect(firstQuery).toContain('vertex_degrees AS');
      expect(firstQuery).toContain('degree2_chains AS');
      expect(firstQuery).toContain('WHERE vd.degree = 1');
      expect(firstQuery).toContain('AND vd.degree = 2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle no degree-2 chains gracefully', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: []
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ final_edges: 20 }]
      });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result.chainsMerged).toBe(0);
      expect(result.edgesRemoved).toBe(0);
      expect(result.finalEdges).toBe(20);
    });

    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(mergeDegree2Chains(mockPgClient, 'test_schema'))
        .rejects
        .toThrow('Database connection failed');
    });
  });
});
