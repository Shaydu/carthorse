import { Pool, PoolClient } from 'pg';

export interface Degree2MergerConfig {
  stagingSchema: string;
  mergeTolerance?: number; // Distance tolerance in meters for merging
  minSegmentLength?: number; // Minimum length for segments to be merged
  preserveTrailNames?: boolean; // Whether to preserve original trail names
}

export class Degree2MergerService {
  constructor(
    private pgClient: Pool,
    private config: Degree2MergerConfig
  ) {}

  /**
   * Main entry point for merging degree-2 intersections
   */
  async mergeDegree2Intersections(): Promise<{
    mergedSegments: number;
    deletedVertices: number;
    originalEdges: number;
    finalEdges: number;
  }> {
    console.log('🔄 [DEGREE2-MERGER] Starting degree-2 intersection merging...');
    
    try {
      // Get initial counts
      const initialCounts = await this.getNetworkCounts();
      console.log(`📊 [DEGREE2-MERGER] Initial network: ${initialCounts.edges} edges, ${initialCounts.vertices} vertices`);

      // Find degree-2 vertices that can be merged
      const degree2Vertices = await this.findMergeableDegree2Vertices();
      console.log(`🔍 [DEGREE2-MERGER] Found ${degree2Vertices.length} mergeable degree-2 vertices`);
      
      if (degree2Vertices.length > 0) {
        console.log(`🔍 [DEGREE2-MERGER] First few vertices:`, degree2Vertices.slice(0, 3).map(v => ({
          vertex_id: v.vertex_id,
          edge_ids: v.edge_ids,
          trail_names: v.trail_names
        })));
      }

      if (degree2Vertices.length === 0) {
        console.log('✅ [DEGREE2-MERGER] No degree-2 vertices to merge');
        return {
          mergedSegments: 0,
          deletedVertices: 0,
          originalEdges: initialCounts.edges,
          finalEdges: initialCounts.edges
        };
      }

      // Process each degree-2 vertex
      let mergedSegments = 0;
      let deletedVertices = 0;

      for (const vertex of degree2Vertices) {
        const result = await this.mergeVertex(vertex);
        if (result.success) {
          mergedSegments++;
          deletedVertices++;
          console.log(`✅ [DEGREE2-MERGER] Merged vertex ${vertex.id} into continuous path`);
        }
      }

      // Get final counts
      const finalCounts = await this.getNetworkCounts();
      console.log(`📊 [DEGREE2-MERGER] Final network: ${finalCounts.edges} edges, ${finalCounts.vertices} vertices`);

      console.log(`🎉 [DEGREE2-MERGER] Merging completed:`);
      console.log(`   🔗 Merged segments: ${mergedSegments}`);
      console.log(`   🗑️ Deleted vertices: ${deletedVertices}`);
      console.log(`   📉 Edge reduction: ${initialCounts.edges - finalCounts.edges}`);

      return {
        mergedSegments,
        deletedVertices,
        originalEdges: initialCounts.edges,
        finalEdges: finalCounts.edges
      };

    } catch (error) {
      console.error('❌ [DEGREE2-MERGER] Error merging degree-2 intersections:', error);
      throw error;
    }
  }

  /**
   * Find degree-2 vertices that can be merged
   */
  private async findMergeableDegree2Vertices(): Promise<any[]> {
    const query = `
      WITH degree2_vertices AS (
        SELECT 
          v.id,
          v.the_geom,
          COUNT(e.id) as edge_count
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.config.stagingSchema}.ways_noded e ON (
          e.source = v.id OR e.target = v.id
        )
        GROUP BY v.id, v.the_geom
        HAVING COUNT(e.id) = 2
      ),
      vertex_edges AS (
        SELECT 
          d2v.id as vertex_id,
          e.id as edge_id,
          e.source,
          e.target,
          e.original_trail_uuid,
          e.original_trail_name,
          e.length_km,
          e.cost,
          e.reverse_cost,
          e.the_geom
        FROM degree2_vertices d2v
        JOIN ${this.config.stagingSchema}.ways_noded e ON (
          e.source = d2v.id OR e.target = d2v.id
        )
      )
      SELECT 
        ve.vertex_id,
        d2v.the_geom as vertex_geom,
        ARRAY_AGG(ve.edge_id ORDER BY ve.edge_id) as edge_ids,
        ARRAY_AGG(ve.original_trail_uuid ORDER BY ve.edge_id) as trail_ids,
        ARRAY_AGG(ve.original_trail_name ORDER BY ve.edge_id) as trail_names,
        ARRAY_AGG(ve.length_km ORDER BY ve.edge_id) as lengths,
        ARRAY_AGG(ve.cost ORDER BY ve.edge_id) as costs,
        ARRAY_AGG(ve.reverse_cost ORDER BY ve.edge_id) as reverse_costs,
        ARRAY_AGG(ve.the_geom ORDER BY ve.edge_id) as edge_geoms
      FROM vertex_edges ve
      JOIN degree2_vertices d2v ON ve.vertex_id = d2v.id
      GROUP BY ve.vertex_id, d2v.the_geom
      HAVING COUNT(*) = 2
    `;

    const result = await this.pgClient.query(query);
    return result.rows;
  }

  /**
   * Merge a single degree-2 vertex into a continuous path
   */
  private async mergeVertex(vertex: any): Promise<{ success: boolean; error?: string }> {
    try {
      const client = await this.pgClient.connect();
      
      try {
        await client.query('BEGIN');

        // Get the two edges connected to this vertex
        const edges = await client.query(`
          WITH vertex_edges AS (
            SELECT 
              id, source, target, original_trail_uuid, original_trail_name,
              length_km, cost, reverse_cost, the_geom,
              ROW_NUMBER() OVER (ORDER BY id) as rn
            FROM ${this.config.stagingSchema}.ways_noded
            WHERE source = $1 OR target = $1
          )
          SELECT 
            e1.id as edge1_id,
            e1.source as edge1_source,
            e1.target as edge1_target,
            e1.original_trail_uuid as edge1_trail_id,
            e1.original_trail_name as edge1_trail_name,
            e1.length_km as edge1_length,
            e1.cost as edge1_cost,
            e1.reverse_cost as edge1_reverse_cost,
            e1.the_geom as edge1_geom,
            e2.id as edge2_id,
            e2.source as edge2_source,
            e2.target as edge2_target,
            e2.original_trail_uuid as edge2_trail_id,
            e2.original_trail_name as edge2_trail_name,
            e2.length_km as edge2_length,
            e2.cost as edge2_cost,
            e2.reverse_cost as edge2_reverse_cost,
            e2.the_geom as edge2_geom
          FROM vertex_edges e1
          JOIN vertex_edges e2 ON e1.rn = 1 AND e2.rn = 2
        `, [vertex.vertex_id]);

        if (edges.rows.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'No edges found for vertex' };
        }

        const edge1 = edges.rows[0];
        const edge2 = edges.rows[0];

        // Determine the new source and target for the merged edge
        const newSource = edge1.edge1_source === vertex.vertex_id ? edge1.edge1_target : edge1.edge1_source;
        const newTarget = edge2.edge2_source === vertex.vertex_id ? edge2.edge2_target : edge2.edge2_source;

        // Merge the geometries
        const mergedGeometry = await client.query(`
          SELECT ST_LineMerge(ST_Union($1::geometry, $2::geometry)) as merged_geom
        `, [edge1.edge1_geom, edge1.edge2_geom]);

        if (!mergedGeometry.rows[0].merged_geom) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Failed to merge geometries' };
        }

        // Calculate merged properties
        const mergedLength = edge1.edge1_length + edge1.edge2_length;
        const mergedCost = edge1.edge1_cost + edge1.edge2_cost;
        const mergedReverseCost = edge1.edge1_reverse_cost + edge1.edge2_reverse_cost;

        // Determine trail name (use the longer segment's name, or combine if similar)
        let mergedTrailName = edge1.edge1_trail_name;
        if (edge1.edge1_length < edge1.edge2_length) {
          mergedTrailName = edge1.edge2_trail_name;
        } else if (this.config.preserveTrailNames && edge1.edge1_trail_name !== edge1.edge2_trail_name) {
          mergedTrailName = `${edge1.edge1_trail_name} + ${edge1.edge2_trail_name}`;
        }

        // Create the merged edge
        const newEdgeId = await client.query(`
          INSERT INTO ${this.config.stagingSchema}.ways_noded (
            source, target, original_trail_uuid, original_trail_name, 
            length_km, cost, reverse_cost, the_geom
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
          newSource,
          newTarget,
          edge1.edge1_trail_id, // Use first trail ID
          mergedTrailName,
          mergedLength,
          mergedCost,
          mergedReverseCost,
          mergedGeometry.rows[0].merged_geom
        ]);

        // Delete the original edges
        await client.query(`
          DELETE FROM ${this.config.stagingSchema}.ways_noded 
          WHERE id IN ($1, $2)
        `, [edge1.edge1_id, edge1.edge2_id]);

        // Delete the vertex
        await client.query(`
          DELETE FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr 
          WHERE id = $1
        `, [vertex.vertex_id]);

        await client.query('COMMIT');
        return { success: true };

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error(`❌ [DEGREE2-MERGER] Error merging vertex ${vertex.vertex_id}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get current network counts
   */
  private async getNetworkCounts(): Promise<{ edges: number; vertices: number }> {
    const edgesResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    const verticesResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);

    return {
      edges: parseInt(edgesResult.rows[0].count),
      vertices: parseInt(verticesResult.rows[0].count)
    };
  }

  /**
   * Analyze the network before and after merging
   */
  async analyzeNetwork(): Promise<{
    degreeDistribution: { [degree: number]: number };
    totalEdges: number;
    totalVertices: number;
  }> {
    const degreeDistribution = await this.pgClient.query(`
      WITH vertex_degrees AS (
        SELECT 
          v.id,
          COUNT(e.id) as degree
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.config.stagingSchema}.ways_noded e ON (
          e.source = v.id OR e.target = v.id
        )
        GROUP BY v.id
      )
      SELECT 
        degree,
        COUNT(*) as count
      FROM vertex_degrees
      GROUP BY degree
      ORDER BY degree
    `);

    const counts = await this.getNetworkCounts();

    const distribution: { [degree: number]: number } = {};
    degreeDistribution.rows.forEach(row => {
      distribution[row.degree] = parseInt(row.count);
    });

    return {
      degreeDistribution: distribution,
      totalEdges: counts.edges,
      totalVertices: counts.vertices
    };
  }
}
