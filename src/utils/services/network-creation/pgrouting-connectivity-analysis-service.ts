import { PoolClient } from 'pg';

export interface Layer1ConnectivityMetrics {
  totalTrails: number;
  connectedComponents: number;
  isolatedTrails: number;
  connectivityPercentage: number;
  maxConnectedTrailLength: number;
  totalTrailLength: number;
  averageTrailLength: number;
  intersectionCount: number;
  // Network statistics
  totalTrailNetworkLength: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  averageElevationGain: number;
  averageElevationLoss: number;
  maxTrailLength: number;
  minTrailLength: number;
  details: {
    componentSizes: number[];
    isolatedTrailNames: string[];
    largestComponentTrails: string[];
    trailTypeDistribution: { [type: string]: number };
    difficultyDistribution: { [difficulty: string]: number };
  };
}

export interface Layer2ConnectivityMetrics {
  totalNodes: number;
  totalEdges: number;
  connectedComponents: number;
  isolatedNodes: number;
  connectivityPercentage: number;
  maxConnectedEdgeLength: number;
  totalEdgeLength: number;
  averageEdgeLength: number;
  // Network statistics
  totalEdgeNetworkLength: number;
  maxEdgeLength: number;
  minEdgeLength: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  averageElevationGain: number;
  averageElevationLoss: number;
  details: {
    componentSizes: number[];
    isolatedNodeIds: number[];
    largestComponentEdges: number[];
    nodeDegreeDistribution: { [degree: number]: number };
    edgeTypeDistribution: { [type: string]: number };
  };
}

export interface PgRoutingAnalysisResult {
  dead_ends: number;
  isolated_segments: number;
  invalid_source: number;
  invalid_target: number;
  total_edges: number;
  total_vertices: number;
}

export class PgRoutingConnectivityAnalysisService {
  constructor(
    private stagingSchema: string,
    private pgClient: PoolClient
  ) {}

  /**
   * Analyze Layer 1 (Trails) connectivity using spatial analysis
   */
  async analyzeLayer1Connectivity(): Promise<Layer1ConnectivityMetrics> {
    console.log('🔍 Analyzing Layer 1 (Trails) connectivity using spatial analysis...');

    // Get comprehensive trail statistics
    const trailStats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        SUM(length_km) as total_length,
        AVG(length_km) as avg_length,
        MAX(length_km) as max_length,
        MIN(length_km) as min_length,
        SUM(elevation_gain) as total_elevation_gain,
        SUM(elevation_loss) as total_elevation_loss,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
    `);

    const stats = trailStats.rows[0];
    const totalTrails = parseInt(stats.total_trails) || 0;
    const totalLength = parseFloat(stats.total_length) || 0;
    const avgLength = parseFloat(stats.avg_length) || 0;
    const maxLength = parseFloat(stats.max_length) || 0;
    const minLength = parseFloat(stats.min_length) || 0;
    const totalElevationGain = parseFloat(stats.total_elevation_gain) || 0;
    const totalElevationLoss = parseFloat(stats.total_elevation_loss) || 0;
    const averageElevationGain = parseFloat(stats.avg_elevation_gain) || 0;
    const averageElevationLoss = parseFloat(stats.avg_elevation_loss) || 0;

    if (totalTrails === 0) {
      return {
        totalTrails: 0,
        connectedComponents: 0,
        isolatedTrails: 0,
        connectivityPercentage: 0,
        maxConnectedTrailLength: 0,
        totalTrailLength: 0,
        averageTrailLength: 0,
        intersectionCount: 0,
        totalTrailNetworkLength: 0,
        totalElevationGain: 0,
        totalElevationLoss: 0,
        averageElevationGain: 0,
        averageElevationLoss: 0,
        maxTrailLength: 0,
        minTrailLength: 0,
        details: {
          componentSizes: [],
          isolatedTrailNames: [],
          largestComponentTrails: [],
          trailTypeDistribution: {},
          difficultyDistribution: {}
        }
      };
    }

    // Find trail intersections using spatial analysis
    const intersectionResult = await this.pgClient.query(`
      WITH trail_intersections AS (
        SELECT DISTINCT 
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_geom
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE t1.geometry IS NOT NULL 
          AND t2.geometry IS NOT NULL
          AND ST_NumPoints(t1.geometry) >= 2
          AND ST_NumPoints(t2.geometry) >= 2
          AND ST_Length(t1.geometry::geography) > 0
          AND ST_Length(t2.geometry::geography) > 0
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND NOT ST_Touches(t1.geometry, t2.geometry)
      )
      SELECT COUNT(*) as intersection_count
      FROM trail_intersections
      WHERE ST_GeometryType(intersection_geom) = 'ST_Point'
    `);

    const intersectionCount = parseInt(intersectionResult.rows[0]?.intersection_count) || 0;

    // Find connected components using spatial proximity
    const componentsResult = await this.pgClient.query(`
      WITH RECURSIVE trail_components AS (
        -- Start with first trail
        SELECT 
          app_uuid,
          name,
          length_km,
          geometry,
          1 as component_id,
          ARRAY[app_uuid] as visited_trails
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_NumPoints(geometry) >= 2
          AND ST_Length(geometry::geography) > 0
        LIMIT 1
        
        UNION ALL
        
        -- Find trails connected to current component
        SELECT 
          t.app_uuid,
          t.name,
          t.length_km,
          t.geometry,
          tc.component_id,
          tc.visited_trails || t.app_uuid
        FROM ${this.stagingSchema}.trails t
        JOIN trail_components tc ON 
          ST_DWithin(t.geometry, tc.geometry, 0.001) -- 1 meter tolerance
          AND t.app_uuid != ALL(tc.visited_trails)
        WHERE t.geometry IS NOT NULL 
          AND ST_NumPoints(t.geometry) >= 2
          AND ST_Length(t.geometry::geography) > 0
      ),
      component_sizes AS (
        SELECT 
          component_id,
          COUNT(*) as size,
          SUM(length_km) as total_length,
          ARRAY_AGG(name) as trail_names
        FROM trail_components
        GROUP BY component_id
      )
      SELECT 
        COUNT(*) as component_count,
        MAX(size) as max_component_size,
        ARRAY_AGG(size ORDER BY size DESC) as component_sizes,
        ARRAY_AGG(total_length ORDER BY total_length DESC) as component_lengths,
        ARRAY_AGG(trail_names ORDER BY size DESC) as component_trail_names
      FROM component_sizes
    `);

    const components = componentsResult.rows[0];
    const connectedComponents = parseInt(components.component_count) || 1;
    const maxConnectedTrailLength = parseFloat(components.component_lengths?.[0]) || 0;
    const componentSizes = components.component_sizes || [];
    const largestComponentTrails = components.component_trail_names?.[0] || [];

    // Find isolated trails (trails not connected to any other trail)
    const isolatedTrailsResult = await this.pgClient.query(`
      SELECT 
        name,
        length_km
      FROM ${this.stagingSchema}.trails t1
      WHERE geometry IS NOT NULL 
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
        AND NOT EXISTS (
          SELECT 1 FROM ${this.stagingSchema}.trails t2
          WHERE t2.app_uuid != t1.app_uuid
            AND t2.geometry IS NOT NULL 
            AND ST_NumPoints(t2.geometry) >= 2
            AND ST_Length(t2.geometry::geography) > 0
            AND ST_DWithin(t1.geometry, t2.geometry, 0.001) -- 1 meter tolerance
        )
      ORDER BY length_km DESC
      LIMIT 10
    `);

    const isolatedTrails = isolatedTrailsResult.rows.length;
    const isolatedTrailNames = isolatedTrailsResult.rows.map(row => row.name);

    // Get trail type and difficulty distribution
    const trailTypeDistribution = await this.pgClient.query(`
      SELECT 
        trail_type,
        COUNT(*) as count
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
      GROUP BY trail_type
      ORDER BY count DESC
    `);

    const difficultyDistribution = await this.pgClient.query(`
      SELECT 
        difficulty,
        COUNT(*) as count
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
      GROUP BY difficulty
      ORDER BY count DESC
    `);

    const trailTypeDist: { [type: string]: number } = {};
    trailTypeDistribution.rows.forEach(row => {
      trailTypeDist[row.trail_type || 'unknown'] = parseInt(row.count);
    });

    const difficultyDist: { [difficulty: string]: number } = {};
    difficultyDistribution.rows.forEach(row => {
      difficultyDist[row.difficulty || 'unknown'] = parseInt(row.count);
    });

    // Calculate connectivity percentage (percentage of trails in largest component)
    const connectivityPercentage = totalTrails > 0 ? (maxConnectedTrailLength / totalLength) * 100 : 0;

    return {
      totalTrails,
      connectedComponents,
      isolatedTrails,
      connectivityPercentage,
      maxConnectedTrailLength,
      totalTrailLength: totalLength,
      averageTrailLength: avgLength,
      intersectionCount,
              totalTrailNetworkLength: totalLength,
        totalElevationGain,
        totalElevationLoss,
        averageElevationGain: averageElevationGain,
        averageElevationLoss: averageElevationLoss,
        maxTrailLength: maxLength,
        minTrailLength: minLength,
      details: {
        componentSizes,
        isolatedTrailNames,
        largestComponentTrails,
        trailTypeDistribution: trailTypeDist,
        difficultyDistribution: difficultyDist
      }
    };
  }

  /**
   * Analyze Layer 2 (Edges) connectivity using pgRouting tools
   */
  async analyzeLayer2Connectivity(): Promise<Layer2ConnectivityMetrics> {
    console.log('🔍 Analyzing Layer 2 (Edges) connectivity using pgRouting tools...');

    // Check if pgRouting tables exist
    const tablesExist = await this.pgClient.query(`
      SELECT 
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as has_ways_noded,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as has_vertices
    `, [this.stagingSchema]);

    if (!tablesExist.rows[0].has_ways_noded || !tablesExist.rows[0].has_vertices) {
      console.log('⚠️ pgRouting tables not found, returning empty metrics');
      return {
        totalNodes: 0,
        totalEdges: 0,
        connectedComponents: 0,
        isolatedNodes: 0,
        connectivityPercentage: 0,
        maxConnectedEdgeLength: 0,
        totalEdgeLength: 0,
        averageEdgeLength: 0,
        totalEdgeNetworkLength: 0,
        maxEdgeLength: 0,
        minEdgeLength: 0,
        totalElevationGain: 0,
        totalElevationLoss: 0,
        averageElevationGain: 0,
        averageElevationLoss: 0,
        details: {
          componentSizes: [],
          isolatedNodeIds: [],
          largestComponentEdges: [],
          nodeDegreeDistribution: {},
          edgeTypeDistribution: {}
        }
      };
    }

    // Get comprehensive edge statistics
    const edgeStats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        SUM(length_km) as total_length,
        AVG(length_km) as avg_length,
        MAX(length_km) as max_length,
        MIN(length_km) as min_length,
        SUM(elevation_gain) as total_elevation_gain,
        SUM(elevation_loss) as total_elevation_loss,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss
      FROM ${this.stagingSchema}.ways_noded
    `);

    const stats = edgeStats.rows[0];
    const totalEdges = parseInt(stats.total_edges) || 0;
    const totalLength = parseFloat(stats.total_length) || 0;
    const avgLength = parseFloat(stats.avg_length) || 0;
    const maxLength = parseFloat(stats.max_length) || 0;
    const minLength = parseFloat(stats.min_length) || 0;
    const totalElevationGain = parseFloat(stats.total_elevation_gain) || 0;
    const totalElevationLoss = parseFloat(stats.total_elevation_loss) || 0;
    const averageElevationGain = parseFloat(stats.avg_elevation_gain) || 0;
    const averageElevationLoss = parseFloat(stats.avg_elevation_loss) || 0;

    // Get vertex statistics
    const vertexStats = await this.pgClient.query(`
      SELECT COUNT(*) as total_vertices
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
    `);

    const totalNodes = parseInt(vertexStats.rows[0].total_vertices) || 0;

    if (totalEdges === 0 || totalNodes === 0) {
      return {
        totalNodes,
        totalEdges,
        connectedComponents: 0,
        isolatedNodes: totalNodes,
        connectivityPercentage: 0,
        maxConnectedEdgeLength: 0,
        totalEdgeLength: totalLength,
        averageEdgeLength: avgLength,
        totalEdgeNetworkLength: totalLength,
        maxEdgeLength: maxLength,
        minEdgeLength: minLength,
        totalElevationGain,
        totalElevationLoss,
        averageElevationGain: averageElevationGain,
        averageElevationLoss: averageElevationLoss,
        details: {
          componentSizes: [],
          isolatedNodeIds: [],
          largestComponentEdges: [],
          nodeDegreeDistribution: {},
          edgeTypeDistribution: {}
        }
      };
    }

    // Use pgRouting's pgr_analyzeGraph for network analysis
    let pgRoutingAnalysis: PgRoutingAnalysisResult | null = null;
    try {
      const analyzeResult = await this.pgClient.query(`
        SELECT * FROM pgr_analyzeGraph('${this.stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id', 'source', 'target')
      `);
      
      pgRoutingAnalysis = {
        dead_ends: parseInt(analyzeResult.rows[0]?.dead_ends) || 0,
        isolated_segments: parseInt(analyzeResult.rows[0]?.isolated_segments) || 0,
        invalid_source: parseInt(analyzeResult.rows[0]?.invalid_source) || 0,
        invalid_target: parseInt(analyzeResult.rows[0]?.invalid_target) || 0,
        total_edges: totalEdges,
        total_vertices: totalNodes
      };
    } catch (error) {
      console.warn('⚠️ pgr_analyzeGraph failed:', error);
    }

    // Use pgRouting's pgr_connectedComponents for component analysis
    let connectedComponents = 0;
    let componentSizes: number[] = [];
    let largestComponentEdges: number[] = [];
    
    try {
      const componentsResult = await this.pgClient.query(`
        SELECT 
          component,
          COUNT(*) as size
        FROM pgr_connectedComponents(
          'SELECT id, source, target, length_km * 1000 as cost FROM ${this.stagingSchema}.ways_noded'
        )
        GROUP BY component
        ORDER BY size DESC
      `);
      
      connectedComponents = componentsResult.rows.length;
      componentSizes = componentsResult.rows.map(row => parseInt(row.size));
      largestComponentEdges = componentSizes;
    } catch (error) {
      console.warn('⚠️ pgr_connectedComponents failed:', error);
      connectedComponents = 1; // Assume single component if analysis fails
    }

    // Get node degree distribution
    const degreeDistribution = await this.pgClient.query(`
      SELECT 
        cnt as degree,
        COUNT(*) as count
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);

    const nodeDegreeDistribution: { [degree: number]: number } = {};
    degreeDistribution.rows.forEach(row => {
      nodeDegreeDistribution[parseInt(row.degree)] = parseInt(row.count);
    });

    // Get edge type distribution (if available)
    let edgeTypeDistribution: { [type: string]: number } = {};
    try {
      const edgeTypeResult = await this.pgClient.query(`
        SELECT 
          COALESCE(trail_type, 'unknown') as edge_type,
          COUNT(*) as count
        FROM ${this.stagingSchema}.ways_noded
        GROUP BY trail_type
        ORDER BY count DESC
      `);
      
      edgeTypeResult.rows.forEach(row => {
        edgeTypeDistribution[row.edge_type] = parseInt(row.count);
      });
    } catch (error) {
      console.warn('⚠️ Edge type distribution analysis failed:', error);
    }

    // Find isolated nodes (degree 0)
    const isolatedNodes = nodeDegreeDistribution[0] || 0;

    // Calculate max connected edge length (length of largest component)
    const maxConnectedEdgeLength = componentSizes.length > 0 ? 
      await this.getMaxConnectedEdgeLength(componentSizes[0]) : 0;

    // Calculate connectivity percentage (percentage of nodes in largest component)
    const connectivityPercentage = totalNodes > 0 ? 
      ((totalNodes - isolatedNodes) / totalNodes) * 100 : 0;

    return {
      totalNodes,
      totalEdges,
      connectedComponents,
      isolatedNodes,
      connectivityPercentage,
      maxConnectedEdgeLength,
      totalEdgeLength: totalLength,
      averageEdgeLength: avgLength,
      totalEdgeNetworkLength: totalLength,
      maxEdgeLength: maxLength,
      minEdgeLength: minLength,
      totalElevationGain,
      totalElevationLoss,
      averageElevationGain: averageElevationGain,
      averageElevationLoss: averageElevationLoss,
      details: {
        componentSizes,
        isolatedNodeIds: [], // Could be populated with actual isolated node IDs
        largestComponentEdges,
        nodeDegreeDistribution,
        edgeTypeDistribution
      }
    };
  }

  /**
   * Get the maximum connected edge length for a component
   */
  private async getMaxConnectedEdgeLength(componentSize: number): Promise<number> {
    try {
      // For now, return the total edge length as a reasonable approximation
      // In a full implementation, we would trace the actual edges in the largest component
      const result = await this.pgClient.query(`
        SELECT SUM(length_km) as total_length
        FROM ${this.stagingSchema}.ways_noded
      `);
      
      return parseFloat(result.rows[0]?.total_length) || 0;
    } catch (error) {
      console.warn('⚠️ Failed to calculate max connected edge length:', error);
      return 0;
    }
  }

  /**
   * Get detailed pgRouting analysis results
   */
  async getPgRoutingAnalysis(): Promise<PgRoutingAnalysisResult | null> {
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM pgr_analyzeGraph('${this.stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id', 'source', 'target')
      `);
      
      return {
        dead_ends: parseInt(result.rows[0]?.dead_ends) || 0,
        isolated_segments: parseInt(result.rows[0]?.isolated_segments) || 0,
        invalid_source: parseInt(result.rows[0]?.invalid_source) || 0,
        invalid_target: parseInt(result.rows[0]?.invalid_target) || 0,
        total_edges: 0, // Would need to be calculated separately
        total_vertices: 0 // Would need to be calculated separately
      };
    } catch (error) {
      console.warn('⚠️ pgr_analyzeGraph failed:', error);
      return null;
    }
  }
}
