import { Client } from 'pg';

export interface RoutePattern {
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: string;
  route_type: string;
}

export interface RouteRecommendation {
  route_uuid: string;
  route_name: string;
  route_type: string;
  route_shape: string;
  input_distance_km: number;
  input_elevation_gain: number;
  recommended_distance_km: number;
  recommended_elevation_gain: number;
  route_path: any[];
  route_edges: any[];
  trail_count: number;
  route_score: number;
  similarity_score: number;
  region: string;
}

export class KspRouteGenerator {
  private pgClient: Client;
  private stagingSchema: string;

  constructor(pgClient: Client, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Generate KSP-based route recommendations for a region
   */
  async generateRouteRecommendations(region: string = 'boulder'): Promise<RouteRecommendation[]> {
    console.log('🛤️ Starting KSP route recommendation generation...');

    // Step 1: Load out-and-back route patterns
    const patterns = await this.loadRoutePatterns();
    console.log(`✅ Loaded ${patterns.length} out-and-back route patterns`);

    // Step 2: Analyze network connectivity
    const connectivity = await this.analyzeNetworkConnectivity();
    console.log(`📊 Network analysis: ${connectivity.connected_edges} connected edges, ${connectivity.isolated_edges} isolated edges`);

    if (connectivity.connected_edges < 2) {
      console.log('⚠️  Insufficient connected edges for routing');
      return [];
    }

    const allRecommendations: RouteRecommendation[] = [];

    // Step 3: Generate routes for each pattern
    for (const pattern of patterns) {
      console.log(`🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern, region);
      allRecommendations.push(...patternRoutes);
      
      console.log(`✅ Generated ${patternRoutes.length} routes for ${pattern.pattern_name}`);
    }

    // Step 4: Store recommendations in staging schema
    await this.storeRouteRecommendations(allRecommendations);

    console.log(`✅ KSP route generation completed: ${allRecommendations.length} total routes`);
    return allRecommendations;
  }

  /**
   * Load route patterns from public schema
   */
  private async loadRoutePatterns(): Promise<RoutePattern[]> {
    const result = await this.pgClient.query(`
      SELECT pattern_name, target_distance_km, target_elevation_gain, route_shape, route_type
      FROM public.route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km
    `);
    
    return result.rows;
  }

  /**
   * Analyze network connectivity using pgRouting
   */
  private async analyzeNetworkConnectivity(): Promise<any> {
    // First, ensure the graph is analyzed
    await this.pgClient.query(`
      SELECT pgr_analyzeGraph('${this.stagingSchema}.ways_noded', 0.00001, 'the_geom', 'id', 'source', 'target')
    `);

    // Get connectivity statistics
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as connected_edges,
        COUNT(CASE WHEN source IS NULL OR target IS NULL THEN 1 END) as isolated_edges
      FROM ${this.stagingSchema}.ways_noded
    `);
    
    return result.rows[0];
  }

  /**
   * Generate routes for a specific pattern
   */
  private async generateRoutesForPattern(pattern: RoutePattern, region: string): Promise<RouteRecommendation[]> {
    const targetRoutes = 5; // Generate 5 routes per pattern
    const recommendations: RouteRecommendation[] = [];

    // Get nodes for route generation (only from connected components)
    const nodes = await this.getConnectedRouteStartNodes();
    
    for (let i = 0; i < Math.min(nodes.length, 20); i++) {
      const startNode = nodes[i];
      
      // Find reachable nodes within target distance
      const reachableNodes = await this.findReachableNodes(startNode.id, pattern.target_distance_km * 2);
      
      for (const endNode of reachableNodes.slice(0, 10)) {
        if (startNode.id === endNode.id) continue;

        // Generate KSP routes
        const routes = await this.generateKspRoutes(startNode.id, endNode.id, pattern);
        
        for (const route of routes) {
          if (recommendations.length >= targetRoutes) break;
          
          const recommendation = this.createRouteRecommendation(route, pattern, region);
          recommendations.push(recommendation);
        }
        
        if (recommendations.length >= targetRoutes) break;
      }
      
      if (recommendations.length >= targetRoutes) break;
    }

    return recommendations;
  }

  /**
   * Get nodes suitable for route generation (only connected ones)
   */
  private async getConnectedRouteStartNodes(): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT DISTINCT v.id, v.the_geom, v.cnt as connection_count
      FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
      JOIN ${this.stagingSchema}.ways_noded w ON (
        ST_Equals(ST_StartPoint(w.the_geom), v.the_geom) OR
        ST_Equals(ST_EndPoint(w.the_geom), v.the_geom)
      )
      WHERE w.source IS NOT NULL 
        AND w.target IS NOT NULL
        AND v.cnt <= 4
      ORDER BY v.cnt ASC, v.id
      LIMIT 50
    `);
    
    return result.rows;
  }

  /**
   * Find nodes reachable within target distance
   */
  private async findReachableNodes(startNodeId: number, maxDistance: number): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT target, cost
      FROM pgr_dijkstra(
        'SELECT id, source, target, length_km * 1000 as cost FROM ${this.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
        $1, NULL, false
      )
      WHERE cost <= $2
      ORDER BY cost
      LIMIT 10
    `, [startNodeId, maxDistance * 1000]);
    
    return result.rows;
  }

  /**
   * Generate KSP routes between two nodes
   */
  private async generateKspRoutes(startNodeId: number, endNodeId: number, pattern: RoutePattern): Promise<any[]> {
    const k = 3; // Generate 3 shortest paths
    
    try {
      const result = await this.pgClient.query(`
        SELECT path_seq, node, edge, cost, agg_cost
        FROM pgr_ksp(
          'SELECT id, source, target, length_km * 1000 as cost FROM ${this.stagingSchema}.ways_noded',
          $1, $2, $3, false
        )
        ORDER BY path_id, path_seq
      `, [startNodeId, endNodeId, k]);
      
      // Group by path_id and calculate metrics
      const paths = await this.groupKspResults(result.rows);
      
      return paths.filter(path => {
        const oneWayDistance = path.totalCost / 1000; // Convert back to km
        const oneWayElevation = path.totalElevation;
        
        // Check if route meets pattern criteria
        const distanceTolerance = pattern.target_distance_km * 0.1; // 10% tolerance
        const elevationTolerance = pattern.target_elevation_gain * 0.1;
        
        const distanceOk = Math.abs(oneWayDistance - pattern.target_distance_km / 2) <= distanceTolerance;
        const elevationOk = Math.abs(oneWayElevation - pattern.target_elevation_gain / 2) <= elevationTolerance;
        
        return distanceOk && elevationOk;
      });
      
    } catch (error) {
      console.warn(`⚠️ KSP route generation failed for ${startNodeId} → ${endNodeId}:`, error);
      return [];
    }
  }

  /**
   * Group KSP results by path_id
   */
  private async groupKspResults(rows: any[]): Promise<any[]> {
    const paths: { [key: number]: any } = {};
    
    for (const row of rows) {
      if (!paths[row.path_id]) {
        paths[row.path_id] = {
          path_id: row.path_id,
          nodes: [],
          edges: [],
          totalCost: 0,
          totalElevation: 0
        };
      }
      
      paths[row.path_id].nodes.push(row.node);
      if (row.edge !== -1) {
        paths[row.path_id].edges.push(row.edge);
      }
      paths[row.path_id].totalCost += row.cost;
    }
    
    // Calculate elevation for each path
    for (const pathId in paths) {
      const path = paths[pathId];
      path.totalElevation = await this.calculatePathElevation(path.edges);
    }
    
    return Object.values(paths);
  }

  /**
   * Calculate total elevation for a path
   */
  private async calculatePathElevation(edgeIds: number[]): Promise<number> {
    if (edgeIds.length === 0) return 0;
    
    const result = await this.pgClient.query(`
      SELECT SUM(elevation_gain) as total_elevation
      FROM ${this.stagingSchema}.ways_noded
      WHERE id = ANY($1)
    `, [edgeIds]);
    
    return result.rows[0]?.total_elevation || 0;
  }

  /**
   * Create a route recommendation from KSP route data
   */
  private createRouteRecommendation(route: any, pattern: RoutePattern, region: string): RouteRecommendation {
    const routeUuid = crypto.randomUUID();
    const oneWayDistance = route.totalCost / 1000;
    const oneWayElevation = route.totalElevation;
    
    return {
      route_uuid: routeUuid,
      route_name: `${pattern.pattern_name} - KSP Route`,
      route_type: pattern.route_type,
      route_shape: pattern.route_shape,
      input_distance_km: pattern.target_distance_km,
      input_elevation_gain: pattern.target_elevation_gain,
      recommended_distance_km: oneWayDistance * 2, // Out-and-back
      recommended_elevation_gain: oneWayElevation * 2,
      route_path: route.nodes,
      route_edges: route.edges.map((edgeId: number) => ({ id: edgeId })),
      trail_count: route.edges.length,
      route_score: this.calculateRouteScore(route, pattern),
      similarity_score: 0.5, // Default similarity score
      region: region
    };
  }

  /**
   * Calculate route score based on how well it matches the pattern
   */
  private calculateRouteScore(route: any, pattern: RoutePattern): number {
    const oneWayDistance = route.totalCost / 1000;
    const oneWayElevation = route.totalElevation;
    
    const targetHalfDistance = pattern.target_distance_km / 2;
    const targetHalfElevation = pattern.target_elevation_gain / 2;
    
    const distanceScore = 1 - Math.abs(oneWayDistance - targetHalfDistance) / targetHalfDistance;
    const elevationScore = 1 - Math.abs(oneWayElevation - targetHalfElevation) / targetHalfElevation;
    
    return (distanceScore + elevationScore) / 2;
  }

  /**
   * Store route recommendations in staging schema
   */
  private async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 Storing ${recommendations.length} route recommendations...`);
    
    for (const rec of recommendations) {
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.route_recommendations (
          route_uuid, route_name, route_type, route_shape,
          input_distance_km, input_elevation_gain,
          recommended_distance_km, recommended_elevation_gain,
          route_path, route_edges, trail_count, route_score,
          similarity_score, region, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      `, [
        rec.route_uuid, rec.route_name, rec.route_type, rec.route_shape,
        rec.input_distance_km, rec.input_elevation_gain,
        rec.recommended_distance_km, rec.recommended_elevation_gain,
        JSON.stringify(rec.route_path), JSON.stringify(rec.route_edges),
        rec.trail_count, rec.route_score, rec.similarity_score, rec.region
      ]);
    }
    
    console.log(`✅ Successfully stored ${recommendations.length} route recommendations`);
  }
} 