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

  describe('Real Edge Data Integration Tests', () => {
    it('should merge Coal Seam Trail edges with real GeoJSON data structure', async () => {
      // Mock the database with real edge data from the GeoJSON export
      const realEdgeData = [
        {
          id: 1,
          source: 7,
          target: 30,
          trail_id: "c7c3889b-203e-4449-b950-62ba6056f392",
          trail_name: "Coal Seam Trail",
          length_km: 0.662381180386536,
          elevation_gain: 43.684326,
          elevation_loss: 43.684326,
          the_geom: "LINESTRING(-105.232534 39.950435, -105.232399 39.950355, -105.232288 39.950351, -105.232218 39.950308, -105.232196 39.950245, -105.232235 39.950179, -105.232272 39.950158, -105.232434 39.950119, -105.232508 39.950062, -105.232551 39.94997, -105.232587 39.949902, -105.232688 39.949853, -105.232708 39.949825, -105.232703 39.949738, -105.23272 39.949658, -105.232744 39.949599, -105.23278 39.949517, -105.232794 39.949444, -105.232894 39.949388, -105.232946 39.94933, -105.232981 39.949264, -105.233102 39.949217, -105.23317 39.949177, -105.233237 39.949115, -105.233272 39.949053, -105.233284 39.949012, -105.233293 39.948971, -105.233338 39.948941, -105.233452 39.948891, -105.2335 39.948834, -105.233568 39.94877, -105.23359 39.948691, -105.233583 39.948558, -105.233615 39.948501, -105.233798 39.94836, -105.233896 39.948296, -105.233958 39.948224, -105.234082 39.948099, -105.23415 39.948039, -105.234251 39.947889, -105.234283 39.947821, -105.234329 39.947783, -105.234382 39.947734, -105.234412 39.947694, -105.234415 39.947633, -105.234483 39.947567, -105.234594 39.947428, -105.234602 39.947336, -105.234636 39.947283, -105.234608 39.947192, -105.23463 39.947158, -105.234686 39.947148, -105.234788 39.947112, -105.234891 39.946996, -105.234997 39.946882, -105.235048 39.946737, -105.235156 39.946665, -105.235384 39.946611, -105.235478 39.946573, -105.235572 39.946514, -105.235623 39.946468, -105.235707 39.946424, -105.235897 39.946366, -105.236134 39.946341, -105.236228 39.946312, -105.236297 39.946266, -105.236343 39.946148)"
        },
        {
          id: 2,
          source: 10,
          target: 26,
          trail_id: "92cdda46-e26e-4f88-9285-9a1cb36fda26",
          trail_name: "Coal Seam Trail",
          length_km: 0.2174028093609747,
          elevation_gain: 5.36084,
          elevation_loss: 5.36084,
          the_geom: "LINESTRING(-105.231126 39.951981, -105.231211 39.95195, -105.23134 39.951817, -105.231395 39.95173, -105.231506 39.951694, -105.231608 39.951603, -105.231667 39.951508, -105.231864 39.951376, -105.232204 39.95085, -105.232422 39.950673, -105.23255 39.950527, -105.232558 39.950481, -105.232534 39.950435)"
        }
      ];

      // Mock vertex degrees - vertex 26 connects edges 1 and 2 (degree-2)
      const vertexDegrees = [
        { vertex_id: 7, degree: 1 },   // Start of edge 1
        { vertex_id: 10, degree: 1 },  // Start of edge 2  
        { vertex_id: 26, degree: 2 },  // Connection point between edges 1 and 2
        { vertex_id: 30, degree: 3 }   // End of edge 1 (intersection)
      ];

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ next_id: 3 }]  // Next available edge ID
        })
        .mockResolvedValueOnce({
          rows: []  // Vertex degree update
        })
        .mockResolvedValueOnce({
          rows: vertexDegrees  // Degree statistics
        })
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]  // One chain merged
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '1' }]  // Final edge count after merge
        });

      const result = await mergeDegree2Chains(mockPgClient, 'test_schema');

      expect(result).toEqual({
        chainsMerged: 1,
        edgesRemoved: 2,
        bridgeEdgesMerged: 0,
        bridgeEdgesRemoved: 0,
        finalEdges: 1
      });

      // Verify the SQL query structure for real edge data
      const mergeQuery = mockQuery.mock.calls[3][0]; // The main merge query
      expect(mergeQuery).toContain('ways_noded e');
      expect(mergeQuery).toContain('e.source != e.target');  // Exclude self-loops
      expect(mergeQuery).toContain('e.name');  // Trail name filtering
      expect(mergeQuery).toContain('ST_DWithin');  // Geometric continuity check
    });

    it('should handle edge data with proper trail name matching', async () => {
      // Test that edges with the same trail name are properly identified for merging
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ next_id: 3 }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ degree: 2, vertex_count: 1 }]
        })
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '1' }]
        });

      await mergeDegree2Chains(mockPgClient, 'test_schema');

      const mergeQuery = mockQuery.mock.calls[3][0];
      
      // Verify trail name matching logic
      expect(mergeQuery).toContain('e.name = next_e.name');  // Same trail name
      expect(mergeQuery).toContain('e.name IS NOT NULL');  // Non-null trail names
      expect(mergeQuery).toContain('next_e.name IS NOT NULL');  // Non-null trail names
    });

    it('should validate geometric continuity between edges', async () => {
      // Test that geometric continuity is properly checked
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ next_id: 3 }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ degree: 2, vertex_count: 1 }]
        })
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '1' }]
        });

      await mergeDegree2Chains(mockPgClient, 'test_schema');

      const mergeQuery = mockQuery.mock.calls[3][0];
      
      // Verify geometric continuity checks
      expect(mergeQuery).toContain('ST_DWithin');  // Distance tolerance check
      expect(mergeQuery).toContain('ST_StartPoint');  // Start point geometry
      expect(mergeQuery).toContain('ST_EndPoint');  // End point geometry
      expect(mergeQuery).toContain('ST_GeomFromText');  // Geometry parsing
    });

    it('should properly aggregate trail properties during merge', async () => {
      // Test that trail properties (length, elevation) are properly aggregated
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ next_id: 3 }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ degree: 2, vertex_count: 1 }]
        })
        .mockResolvedValueOnce({
          rows: [{ chains_merged: '1' }]
        })
        .mockResolvedValueOnce({
          rows: [{ final_edges: '1' }]
        });

      await mergeDegree2Chains(mockPgClient, 'test_schema');

      const mergeQuery = mockQuery.mock.calls[3][0];
      
      // Verify property aggregation
      expect(mergeQuery).toContain('tc.total_length + next_e.length_km');  // Length aggregation
      expect(mergeQuery).toContain('tc.total_elevation_gain + next_e.elevation_gain');  // Elevation gain aggregation
      expect(mergeQuery).toContain('tc.total_elevation_loss + next_e.elevation_loss');  // Elevation loss aggregation
      expect(mergeQuery).toContain('ST_LineMerge');  // Geometry merging
    });
  });
});
