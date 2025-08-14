import { Pool, PoolClient } from 'pg';

export interface ConnectivityMetrics {
  totalTrails: number;
  totalEdges: number;
  totalVertices: number;
  connectedComponents: number;
  isolatedTrails: number;
  isolatedVertices: number;
  averageTrailsPerComponent: number;
  connectivityScore: number;
  details: {
    componentSizes: number[];
    isolatedTrailNames: string[];
    largestComponentSize: number;
    smallestComponentSize: number;
  };
}

/**
 * Service to analyze network connectivity and find connected components
 */
export class ConnectivityAnalysisService {
  private stagingSchema: string;
  private pgClient: Pool | PoolClient;

  constructor(stagingSchema: string, pgClient: Pool | PoolClient) {
    this.stagingSchema = stagingSchema;
    this.pgClient = pgClient;
  }

  /**
   * Analyze network connectivity and return comprehensive metrics
   */
  async analyzeConnectivity(): Promise<ConnectivityMetrics> {
    console.log('🔍 Analyzing network connectivity...');

    // Get basic counts
    const basicStats = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL) as total_trails,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as total_edges,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as total_vertices
    `);

    const totalTrails = parseInt(basicStats.rows[0].total_trails);
    const totalEdges = parseInt(basicStats.rows[0].total_edges);
    const totalVertices = parseInt(basicStats.rows[0].total_vertices);

    // Find connected components using a recursive CTE
    const componentsResult = await this.pgClient.query(`
      WITH RECURSIVE 
      -- Get all vertices
      all_vertices AS (
        SELECT id FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      ),
      -- Get all edges
      all_edges AS (
        SELECT source as vertex_id FROM ${this.stagingSchema}.ways_noded
        UNION ALL
        SELECT target as vertex_id FROM ${this.stagingSchema}.ways_noded
      ),
      -- Find connected components using recursive traversal
      component_traversal AS (
        -- Start with each vertex as a potential component root
        SELECT 
          v.id as root_vertex,
          v.id as current_vertex,
          ARRAY[v.id] as component_vertices,
          1 as depth
        FROM all_vertices v
        WHERE EXISTS (SELECT 1 FROM all_edges e WHERE e.vertex_id = v.id)
        
        UNION ALL
        
        -- Recursively find connected vertices
        SELECT 
          ct.root_vertex,
          e.vertex_id as current_vertex,
          ct.component_vertices || e.vertex_id as component_vertices,
          ct.depth + 1
        FROM component_traversal ct
        JOIN all_edges e ON (
          (e.vertex_id = ct.current_vertex AND EXISTS (
            SELECT 1 FROM ${this.stagingSchema}.ways_noded w 
            WHERE w.source = ct.current_vertex AND w.target = e.vertex_id
          ))
          OR
          (e.vertex_id = ct.current_vertex AND EXISTS (
            SELECT 1 FROM ${this.stagingSchema}.ways_noded w 
            WHERE w.target = ct.current_vertex AND w.source = e.vertex_id
          ))
        )
        WHERE ct.depth < 1000  -- Prevent infinite recursion
          AND NOT (e.vertex_id = ANY(ct.component_vertices))  -- Avoid cycles
      ),
      -- Get the largest component for each root vertex
      largest_components AS (
        SELECT 
          root_vertex,
          array_length(component_vertices, 1) as component_size,
          component_vertices
        FROM (
          SELECT 
            root_vertex,
            component_vertices,
            ROW_NUMBER() OVER (PARTITION BY root_vertex ORDER BY array_length(component_vertices, 1) DESC) as rn
          FROM component_traversal
        ) ranked
        WHERE rn = 1
      ),
      -- Get unique components (components that don't overlap)
      unique_components AS (
        SELECT DISTINCT
          component_size,
          component_vertices
        FROM largest_components lc1
        WHERE NOT EXISTS (
          SELECT 1 FROM largest_components lc2
          WHERE lc2.root_vertex != lc1.root_vertex
            AND lc2.component_size >= lc1.component_size
            AND lc1.component_vertices && lc2.component_vertices  -- Check for overlap
        )
      )
      SELECT 
        COUNT(*) as component_count,
        array_agg(component_size ORDER BY component_size DESC) as component_sizes
      FROM unique_components
    `);

    const connectedComponents = parseInt(componentsResult.rows[0].component_count);
    const componentSizes = componentsResult.rows[0].component_sizes || [];

    // Find isolated vertices (degree 0)
    const isolatedVerticesResult = await this.pgClient.query(`
      WITH vertex_degrees AS (
        SELECT 
          v.id,
          COUNT(w.id) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id
      )
      SELECT COUNT(*) as count
      FROM vertex_degrees
      WHERE degree = 0
    `);

    const isolatedVertices = parseInt(isolatedVerticesResult.rows[0].count);

    // Find isolated trails (trails that don't connect to any other trails)
    const isolatedTrailsResult = await this.pgClient.query(`
      WITH trail_connections AS (
        SELECT DISTINCT
          t.app_uuid,
          t.name,
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM ${this.stagingSchema}.ways_noded w
              JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v1 ON w.source = v1.id
              JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v2 ON w.target = v2.id
              WHERE ST_DWithin(v1.the_geom, ST_StartPoint(t.geometry), 1.0)
                OR ST_DWithin(v1.the_geom, ST_EndPoint(t.geometry), 1.0)
                OR ST_DWithin(v2.the_geom, ST_StartPoint(t.geometry), 1.0)
                OR ST_DWithin(v2.the_geom, ST_EndPoint(t.geometry), 1.0)
            ) THEN false
            ELSE true
          END as is_isolated
        FROM ${this.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
      )
      SELECT 
        COUNT(*) as isolated_count,
        array_agg(name) as isolated_names
      FROM trail_connections
      WHERE is_isolated = true
    `);

    const isolatedTrails = parseInt(isolatedTrailsResult.rows[0].isolated_count);
    const isolatedTrailNames = isolatedTrailsResult.rows[0].isolated_names || [];

    // Calculate metrics
    const largestComponentSize = componentSizes.length > 0 ? componentSizes[0] : 0;
    const smallestComponentSize = componentSizes.length > 0 ? componentSizes[componentSizes.length - 1] : 0;
    const averageTrailsPerComponent = connectedComponents > 0 ? totalTrails / connectedComponents : 0;
    
    // Connectivity score: percentage of trails in the largest component
    const connectivityScore = totalTrails > 0 ? largestComponentSize / totalTrails : 0;

    const metrics: ConnectivityMetrics = {
      totalTrails,
      totalEdges,
      totalVertices,
      connectedComponents,
      isolatedTrails,
      isolatedVertices,
      averageTrailsPerComponent,
      connectivityScore,
      details: {
        componentSizes,
        isolatedTrailNames: isolatedTrailNames.slice(0, 10), // Limit to first 10
        largestComponentSize,
        smallestComponentSize
      }
    };

    console.log(`📊 Connectivity analysis results:`);
    console.log(`   🛤️ Total trails: ${totalTrails}`);
    console.log(`   🔗 Total edges: ${totalEdges}`);
    console.log(`   📍 Total vertices: ${totalVertices}`);
    console.log(`   🔗 Connected components: ${connectedComponents}`);
    console.log(`   🏝️ Isolated trails: ${isolatedTrails}`);
    console.log(`   📍 Isolated vertices: ${isolatedVertices}`);
    console.log(`   📈 Average trails per component: ${averageTrailsPerComponent.toFixed(1)}`);
    console.log(`   🎯 Connectivity score: ${(connectivityScore * 100).toFixed(1)}%`);
    console.log(`   📊 Largest component: ${largestComponentSize} trails`);
    console.log(`   📊 Component sizes: [${componentSizes.join(', ')}]`);

    if (isolatedTrailNames.length > 0) {
      console.log(`   🏝️ Sample isolated trails: ${isolatedTrailNames.slice(0, 5).join(', ')}${isolatedTrailNames.length > 5 ? '...' : ''}`);
    }

    return metrics;
  }

  /**
   * Get a simple connectivity summary for the final report
   */
  async getConnectivitySummary(): Promise<{
    totalTrails: number;
    connectedComponents: number;
    isolatedTrails: number;
    averageTrailsPerComponent: number;
    connectivityScore: number;
    details: {
      componentSizes: number[];
      isolatedTrailNames: string[];
    };
  }> {
    const metrics = await this.analyzeConnectivity();
    
    return {
      totalTrails: metrics.totalTrails,
      connectedComponents: metrics.connectedComponents,
      isolatedTrails: metrics.isolatedTrails,
      averageTrailsPerComponent: metrics.averageTrailsPerComponent,
      connectivityScore: metrics.connectivityScore,
      details: {
        componentSizes: metrics.details.componentSizes,
        isolatedTrailNames: metrics.details.isolatedTrailNames
      }
    };
  }
}
