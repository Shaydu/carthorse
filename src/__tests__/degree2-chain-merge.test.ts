import { Pool } from 'pg';
import { mergeDegree2Chains } from '../utils/services/network-creation/merge-degree2-chains';

// Mock pg Pool
const mockQuery = jest.fn();
const mockPgClient = {
  query: mockQuery
} as unknown as Pool;

describe('Degree-2 Chain Merge Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Chain Merging', () => {
    it('should merge Community Ditch Trail chain: dead end → degree-2 → degree-2 → intersection', async () => {
      // Mock the complex recursive CTE query
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '14' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 1,
        edgesRemoved: 2,
        finalEdges: 14
      });

      // Verify the SQL query was called with the expected structure
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const firstCall = mockQuery.mock.calls[0][0];
      expect(firstCall).toContain('WITH RECURSIVE');
      expect(firstCall).toContain('vertex_degrees AS');
      expect(firstCall).toContain('trail_chains AS');
      expect(firstCall).toContain('complete_chains AS');
      expect(firstCall).toContain('mergeable_chains AS');
      expect(firstCall).toContain('inserted_edges AS');
      expect(firstCall).toContain('deleted_edges AS');
    });

    it('should merge Marshall Valley Trail chain: dead end → degree-2 → intersection', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '15' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 1,
        edgesRemoved: 2,
        finalEdges: 15
      });
    });

    it('should merge multiple chains in one run', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '3' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '12' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 3,
        edgesRemoved: 6,
        finalEdges: 12
      });
    });
  });

  describe('No Chains to Merge', () => {
    it('should handle case where no degree-2 chains exist', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '0' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '20' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 0,
        edgesRemoved: 0,
        finalEdges: 20
      });
    });

    it('should handle case where all vertices are degree-3+ (no degree-2 chains)', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '0' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '25' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 0,
        edgesRemoved: 0,
        finalEdges: 25
      });
    });
  });

  describe('SQL Query Structure Validation', () => {
    it('should generate SQL with proper trail name filtering', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '15' }]
        });

      await mergeDegree2Chains(mockPgClient, 'test_schema');

      const sqlQuery = mockQuery.mock.calls[0][0];
      
      // Verify trail name filtering
      expect(sqlQuery).toContain('AND e.name IS NOT NULL');
      expect(sqlQuery).toContain('AND next_e.name = tc.trail_name');
      
      // Verify degree filtering
      expect(sqlQuery).toContain('(vd_source.degree = 1 OR vd_source.degree >= 3 OR vd_target.degree = 1 OR vd_target.degree >= 3)');
      expect(sqlQuery).toContain('(vd.degree = 2 OR vd.degree >= 3)');
    });

    it('should generate SQL with proper transaction structure', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '15' }]
        });

      await mergeDegree2Chains(mockPgClient, 'test_schema');

      const sqlQuery = mockQuery.mock.calls[0][0];
      
      // Verify transaction structure (insert and delete in same query)
      expect(sqlQuery).toContain('inserted_edges AS (');
      expect(sqlQuery).toContain('INSERT INTO');
      expect(sqlQuery).toContain('deleted_edges AS (');
      expect(sqlQuery).toContain('DELETE FROM');
      expect(sqlQuery).toContain('SELECT COUNT(*) as chains_merged FROM inserted_edges');
    });
  });

  describe('Error Handling', () => {
    it('should handle database query errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockQuery.mockRejectedValueOnce(dbError);

      await expect(mergeDegree2Chains(mockPgClient, 'test_schema'))
        .rejects
        .toThrow('Database connection failed');
    });

    it('should handle SQL syntax errors gracefully', async () => {
      const sqlError = new Error('syntax error at or near "WITH"');
      mockQuery.mockRejectedValueOnce(sqlError);

      await expect(mergeDegree2Chains(mockPgClient, 'test_schema'))
        .rejects
        .toThrow('syntax error at or near "WITH"');
    });

    it('should handle null query results gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: []
        });

      await expect(mergeDegree2Chains(mockPgClient, 'test_schema'))
        .rejects
        .toThrow("Cannot read properties of undefined (reading 'chains_merged')");
    });
  });

  describe('Edge Case Handling', () => {
    it('should handle empty database gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '0' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '0' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 0,
        edgesRemoved: 0,
        finalEdges: 0
      });
    });

    it('should handle single edge (no chains possible)', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '0' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '1' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 0,
        edgesRemoved: 0,
        finalEdges: 1
      });
    });
  });

  describe('Integration Test Scenarios', () => {
    it('should handle the actual Community Ditch Trail scenario', async () => {
      // This test simulates the real Community Ditch Trail case
      // where edges 3, 2, 4 should be merged into one edge
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '15' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result.chainsMerged).toBe(1);
      expect(result.edgesRemoved).toBe(2);
      expect(result.finalEdges).toBe(15);
    });

    it('should handle the actual Marshall Valley Trail scenario', async () => {
      // This test simulates the real Marshall Valley Trail case
      // where edges 13, 12 should be merged into one edge
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '15' }]
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result.chainsMerged).toBe(1);
      expect(result.edgesRemoved).toBe(2);
      expect(result.finalEdges).toBe(15);
    });
  });
});
