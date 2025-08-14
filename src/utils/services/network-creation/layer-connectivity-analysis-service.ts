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
  // Spatial relationship metrics
  nearMisses: number;
  avgNearMissDistance: number;
  nearlyIntersecting: number;
  avgNearlyIntersectingDistance: number;
  endpointProximity: number;
  avgEndpointProximityDistance: number;
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
  details: {
    componentSizes: number[];
    isolatedNodeIds: number[];
    largestComponentEdges: number[];
    nodeDegreeDistribution: { [degree: number]: number };
  };
}

export class LayerConnectivityAnalysisService {
  constructor(
    private stagingSchema: string,
    private pgClient: PoolClient
  ) {}

  /**
   * Analyze Layer 1 (Trails) connectivity
   */
  async analyzeLayer1Connectivity(): Promise<Layer1ConnectivityMetrics> {
    console.log('🔍 Analyzing Layer 1 (Trails) connectivity...');

    // Get basic trail statistics
    const trailStats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        SUM(length_km) as total_length,
        AVG(length_km) as avg_length,
        MAX(length_km) as max_length
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
    `);

    const stats = trailStats.rows[0];
    const totalTrails = parseInt(stats.total_trails) || 0;
    const totalLength = parseFloat(stats.total_length) || 0;
    const avgLength = parseFloat(stats.avg_length) || 0;

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
        details: {
          componentSizes: [],
          isolatedTrailNames: [],
          largestComponentTrails: []
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
      WHERE ST_GeometryType(intersection_geom) IN ('POINT', 'MULTIPOINT', 'LINESTRING', 'MULTILINESTRING')
    `);

    const intersectionCount = parseInt(intersectionResult.rows[0]?.intersection_count) || 0;

    // For Layer 1, we'll use a simplified connectivity analysis based on spatial proximity
    // This is more complex than edge-based analysis, so we'll use a tolerance-based approach
    const connectivityResult = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt,
          length_km
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_NumPoints(geometry) >= 2
          AND ST_Length(geometry::geography) > 0
      ),
      endpoint_connections AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_DWithin(t1.start_pt, t2.start_pt, 0.001) -- ~100m tolerance
           OR ST_DWithin(t1.start_pt, t2.end_pt, 0.001)
           OR ST_DWithin(t1.end_pt, t2.start_pt, 0.001)
           OR ST_DWithin(t1.end_pt, t2.end_pt, 0.001)
      ),
      connected_components AS (
        WITH RECURSIVE component_search AS (
          SELECT 
            trail1_uuid as trail_uuid,
            ARRAY[trail1_uuid] as component_trails,
            1 as depth
          FROM endpoint_connections
          UNION ALL
          SELECT 
            ec.trail2_uuid,
            cs.component_trails || ec.trail2_uuid,
            cs.depth + 1
          FROM endpoint_connections ec
          JOIN component_search cs ON ec.trail1_uuid = ANY(cs.component_trails)
          WHERE ec.trail2_uuid != ALL(cs.component_trails)
            AND cs.depth < 100 -- Prevent infinite recursion
        )
        SELECT DISTINCT component_trails
        FROM component_search
        WHERE depth = (
          SELECT MAX(depth) 
          FROM component_search cs2 
          WHERE cs2.component_trails @> component_search.component_trails
        )
      )
      SELECT 
        COUNT(*) as component_count,
        ARRAY_AGG(ARRAY_LENGTH(component_trails, 1)) as component_sizes,
        ARRAY_AGG(component_trails) as all_components
      FROM connected_components
    `);

    const componentData = connectivityResult.rows[0];
    const connectedComponents = parseInt(componentData?.component_count) || 1;
    const componentSizes = componentData?.component_sizes || [totalTrails];
    const allComponents = componentData?.all_components || [[totalTrails]];

    // Find largest component
    const largestComponentSize = Math.max(...componentSizes);
    const largestComponentIndex = componentSizes.indexOf(largestComponentSize);
    const largestComponentTrails = allComponents[largestComponentIndex] || [];

    // Calculate connectivity percentage
    const connectivityPercentage = totalTrails > 0 ? (largestComponentSize / totalTrails) * 100 : 0;

    // Find isolated trails (trails not in any component)
    const isolatedTrails = totalTrails - largestComponentSize;

    // Get isolated trail names
    const isolatedTrailNames = await this.getIsolatedTrailNames(largestComponentTrails);

    // Calculate max connected trail length
    const maxConnectedTrailLength = await this.getMaxConnectedTrailLength(largestComponentTrails);

    return {
      totalTrails,
      connectedComponents,
      isolatedTrails,
      connectivityPercentage,
      maxConnectedTrailLength,
      totalTrailLength: totalLength,
      averageTrailLength: avgLength,
      intersectionCount,
      details: {
        componentSizes,
        isolatedTrailNames,
        largestComponentTrails
      }
    };
  }

  /**
   * Analyze Layer 2 (Edges) connectivity
   */
  async analyzeLayer2Connectivity(): Promise<Layer2ConnectivityMetrics> {
    console.log('🔍 Analyzing Layer 2 (Edges) connectivity...');

    // Check if Layer 2 tables exist
    const tableCheck = await this.pgClient.query(`
      SELECT 
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as edges_exist,
        EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as nodes_exist
    `, [this.stagingSchema]);

    if (!tableCheck.rows[0].edges_exist || !tableCheck.rows[0].nodes_exist) {
      return {
        totalNodes: 0,
        totalEdges: 0,
        connectedComponents: 0,
        isolatedNodes: 0,
        connectivityPercentage: 0,
        maxConnectedEdgeLength: 0,
        totalEdgeLength: 0,
        averageEdgeLength: 0,
        details: {
          componentSizes: [],
          isolatedNodeIds: [],
          largestComponentEdges: [],
          nodeDegreeDistribution: {}
        }
      };
    }

    // Get basic edge and node statistics
    const networkStats = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded_vertices_pgr) as total_nodes,
        (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded) as total_edges,
        (SELECT SUM(length_km) FROM ${this.stagingSchema}.ways_noded) as total_length,
        (SELECT AVG(length_km) FROM ${this.stagingSchema}.ways_noded) as avg_length,
        (SELECT MAX(length_km) FROM ${this.stagingSchema}.ways_noded) as max_length
    `);

    const stats = networkStats.rows[0];
    const totalNodes = parseInt(stats.total_nodes) || 0;
    const totalEdges = parseInt(stats.total_edges) || 0;
    const totalLength = parseFloat(stats.total_length) || 0;
    const avgLength = parseFloat(stats.avg_length) || 0;

    if (totalNodes === 0 || totalEdges === 0) {
      return {
        totalNodes,
        totalEdges,
        connectedComponents: 0,
        isolatedNodes: totalNodes,
        connectivityPercentage: 0,
        maxConnectedEdgeLength: 0,
        totalEdgeLength: totalLength,
        averageEdgeLength: avgLength,
        details: {
          componentSizes: [],
          isolatedNodeIds: [],
          largestComponentEdges: [],
          nodeDegreeDistribution: {}
        }
      };
    }

    // Analyze connectivity using recursive CTE
    const connectivityResult = await this.pgClient.query(`
      WITH RECURSIVE connected_components AS (
        SELECT 
          source as node_id,
          ARRAY[source] as component_nodes,
          1 as component_id
        FROM ${this.stagingSchema}.ways_noded
        WHERE source IS NOT NULL
        UNION ALL
        SELECT 
          e.target,
          cc.component_nodes || e.target,
          cc.component_id
        FROM ${this.stagingSchema}.ways_noded e
        JOIN connected_components cc ON e.source = cc.node_id
        WHERE e.target != ALL(cc.component_nodes)
      ),
      component_summary AS (
        SELECT 
          component_id,
          COUNT(DISTINCT node_id) as component_size,
          ARRAY_AGG(DISTINCT node_id) as component_nodes
        FROM connected_components
        GROUP BY component_id
      ),
      largest_component AS (
        SELECT 
          component_id,
          component_size,
          component_nodes
        FROM component_summary
        WHERE component_size = (SELECT MAX(component_size) FROM component_summary)
        LIMIT 1
      )
      SELECT 
        (SELECT COUNT(*) FROM component_summary) as component_count,
        (SELECT component_size FROM largest_component) as largest_component_size,
        (SELECT component_nodes FROM largest_component) as largest_component_nodes,
        ARRAY_AGG(component_size ORDER BY component_size DESC) as all_component_sizes
      FROM component_summary
    `);

    const connectivityData = connectivityResult.rows[0];
    const connectedComponents = parseInt(connectivityData?.component_count) || 1;
    const largestComponentSize = parseInt(connectivityData?.largest_component_size) || totalNodes;
    const largestComponentNodes = connectivityData?.largest_component_nodes || [];
    const allComponentSizes = connectivityData?.all_component_sizes || [totalNodes];

    // Calculate connectivity percentage
    const connectivityPercentage = totalNodes > 0 ? (largestComponentSize / totalNodes) * 100 : 0;

    // Find isolated nodes
    const isolatedNodes = totalNodes - largestComponentSize;

    // Get isolated node IDs
    const isolatedNodeIds = await this.getIsolatedNodeIds(largestComponentNodes);

    // Get node degree distribution
    const degreeDistribution = await this.getNodeDegreeDistribution();

    // Calculate max connected edge length
    const maxConnectedEdgeLength = await this.getMaxConnectedEdgeLength(largestComponentNodes);

    // Get largest component edge IDs
    const largestComponentEdges = await this.getLargestComponentEdges(largestComponentNodes);

    return {
      totalNodes,
      totalEdges,
      connectedComponents,
      isolatedNodes,
      connectivityPercentage,
      maxConnectedEdgeLength,
      totalEdgeLength: totalLength,
      averageEdgeLength: avgLength,
      details: {
        componentSizes: allComponentSizes,
        isolatedNodeIds,
        largestComponentEdges,
        nodeDegreeDistribution: degreeDistribution
      }
    };
  }

  private async getIsolatedTrailNames(connectedTrailUuids: string[]): Promise<string[]> {
    if (connectedTrailUuids.length === 0) {
      const result = await this.pgClient.query(`
        SELECT name 
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_NumPoints(geometry) >= 2
          AND ST_Length(geometry::geography) > 0
        ORDER BY name
        LIMIT 10
      `);
      return result.rows.map(row => row.name);
    }

    const result = await this.pgClient.query(`
      SELECT name 
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
        AND app_uuid != ALL($1)
      ORDER BY name
      LIMIT 10
    `, [connectedTrailUuids]);
    
    return result.rows.map(row => row.name);
  }

  private async getMaxConnectedTrailLength(connectedTrailUuids: string[]): Promise<number> {
    if (connectedTrailUuids.length === 0) return 0;

    const result = await this.pgClient.query(`
      SELECT SUM(length_km) as total_length
      FROM ${this.stagingSchema}.trails
      WHERE app_uuid = ANY($1)
    `, [connectedTrailUuids]);

    return parseFloat(result.rows[0]?.total_length) || 0;
  }

  private async getIsolatedNodeIds(connectedNodeIds: number[]): Promise<number[]> {
    if (connectedNodeIds.length === 0) {
      const result = await this.pgClient.query(`
        SELECT id FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        ORDER BY id
        LIMIT 10
      `);
      return result.rows.map(row => row.id);
    }

    const result = await this.pgClient.query(`
      SELECT id 
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      WHERE id != ALL($1)
      ORDER BY id
      LIMIT 10
    `, [connectedNodeIds]);
    
    return result.rows.map(row => row.id);
  }

  private async getNodeDegreeDistribution(): Promise<{ [degree: number]: number }> {
    const result = await this.pgClient.query(`
      SELECT 
        cnt as degree,
        COUNT(*) as count
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      GROUP BY cnt
      ORDER BY cnt
    `);

    const distribution: { [degree: number]: number } = {};
    result.rows.forEach(row => {
      distribution[row.degree] = parseInt(row.count);
    });

    return distribution;
  }

  private async getMaxConnectedEdgeLength(connectedNodeIds: number[]): Promise<number> {
    if (connectedNodeIds.length === 0) return 0;

    const result = await this.pgClient.query(`
      SELECT SUM(length_km) as total_length
      FROM ${this.stagingSchema}.ways_noded
      WHERE source = ANY($1) OR target = ANY($1)
    `, [connectedNodeIds]);

    return parseFloat(result.rows[0]?.total_length) || 0;
  }

  private async getLargestComponentEdges(connectedNodeIds: number[]): Promise<number[]> {
    if (connectedNodeIds.length === 0) return [];

    const result = await this.pgClient.query(`
      SELECT id
      FROM ${this.stagingSchema}.ways_noded
      WHERE source = ANY($1) OR target = ANY($1)
      ORDER BY id
      LIMIT 20
    `, [connectedNodeIds]);

    return result.rows.map(row => row.id);
  }
}
