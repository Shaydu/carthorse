import { Pool } from 'pg';
import { RoutePattern } from '../ksp-route-generator';

export class RoutePatternSqlHelpers {
  constructor(private pgClient: Pool) {}

  /**
   * Load out-and-back route patterns
   */
  async loadOutAndBackPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading out-and-back route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} out-and-back route patterns`);
    
    console.log('🔍 Out-and-back patterns to process:');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      throw new Error('No out-and-back patterns found');
    }

    return patterns;
  }

  /**
   * Load loop route patterns
   */
  async loadLoopPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading loop route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'loop'
      ORDER BY target_distance_km
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} loop route patterns`);
    
    console.log('🔍 Loop patterns to process:');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      throw new Error('No loop patterns found');
    }

    return patterns;
  }

  /**
   * Generate loop routes using pgRouting's hawickcircuits
   * This finds all cycles in the graph that meet distance/elevation criteria
   */
  async generateLoopRoutes(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    tolerancePercent: number = 20
  ): Promise<any[]> {
    console.log(`🔄 Generating loop routes: ${targetDistance}km, ${targetElevation}m elevation`);
    
    // Calculate tolerance ranges
    const minDistance = targetDistance * (1 - tolerancePercent / 100);
    const maxDistance = targetDistance * (1 + tolerancePercent / 100);
    const minElevation = targetElevation * (1 - tolerancePercent / 100);
    const maxElevation = targetElevation * (1 + tolerancePercent / 100);
    
    console.log(`📏 Distance range: ${minDistance.toFixed(1)}-${maxDistance.toFixed(1)}km`);
    console.log(`⛰️ Elevation range: ${minElevation.toFixed(0)}-${maxElevation.toFixed(0)}m`);
    
    // Find all cycles in the graph using hawickcircuits
    const cyclesResult = await this.pgClient.query(`
      SELECT 
        path_id as cycle_id,
        edge as edge_id,
        cost,
        agg_cost,
        path_seq
      FROM pgr_hawickcircuits(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded'
      )
      ORDER BY path_id, path_seq
    `);
    
    console.log(`🔍 Found ${cyclesResult.rows.length} total edges in cycles`);
    
    // Group cycles and calculate metrics
    const cycles = this.groupCycles(cyclesResult.rows);
    console.log(`🔄 Found ${cycles.size} distinct cycles`);
    
    // Filter cycles by distance and elevation criteria
    const validLoops = await this.filterCyclesByCriteria(
      stagingSchema,
      cycles,
      minDistance,
      maxDistance,
      minElevation,
      maxElevation
    );
    
    console.log(`✅ Found ${validLoops.length} valid loop routes`);
    return validLoops;
  }

  /**
   * Group cycle edges into distinct cycles
   */
  private groupCycles(cycleEdges: any[]): Map<number, any[]> {
    const cycles = new Map<number, any[]>();
    
    for (const edge of cycleEdges) {
      if (!cycles.has(edge.cycle_id)) {
        cycles.set(edge.cycle_id, []);
      }
      cycles.get(edge.cycle_id)!.push(edge);
    }
    
    return cycles;
  }

  /**
   * Filter cycles by distance and elevation criteria
   */
  private async filterCyclesByCriteria(
    stagingSchema: string,
    cycles: Map<number, any[]>,
    minDistance: number,
    maxDistance: number,
    minElevation: number,
    maxElevation: number
  ): Promise<any[]> {
    const validLoops: any[] = [];
    
    for (const [cycleId, edges] of cycles) {
      // Calculate total distance and elevation for this cycle
      const edgeIds = edges.map(e => e.edge_id);
      
      const cycleMetrics = await this.calculateCycleMetrics(stagingSchema, edgeIds);
      
      // Check if cycle meets criteria
      if (cycleMetrics.totalDistance >= minDistance && 
          cycleMetrics.totalDistance <= maxDistance &&
          cycleMetrics.totalElevationGain >= minElevation &&
          cycleMetrics.totalElevationGain <= maxElevation) {
        
        validLoops.push({
          cycle_id: cycleId,
          edges: edges,
          total_distance: cycleMetrics.totalDistance,
          total_elevation_gain: cycleMetrics.totalElevationGain,
          trail_count: cycleMetrics.trailCount,
          route_shape: 'loop'
        });
      }
    }
    
    return validLoops;
  }

  /**
   * Calculate metrics for a cycle
   */
  private async calculateCycleMetrics(stagingSchema: string, edgeIds: number[]): Promise<{
    totalDistance: number;
    totalElevationGain: number;
    trailCount: number;
  }> {
    const metricsResult = await this.pgClient.query(`
      SELECT 
        SUM(w.length_km) as total_distance,
        SUM(w.elevation_gain) as total_elevation_gain,
        COUNT(DISTINCT em.original_trail_id) as trail_count
      FROM ${stagingSchema}.ways_noded w
      JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
      WHERE w.id = ANY($1::integer[])
    `, [edgeIds]);
    
    const metrics = metricsResult.rows[0];
    return {
      totalDistance: parseFloat(metrics.total_distance) || 0,
      totalElevationGain: parseFloat(metrics.total_elevation_gain) || 0,
      trailCount: parseInt(metrics.trail_count) || 0
    };
  }

  /**
   * Generate loop routes using alternative approach with pgr_dijkstra
   * This creates loops by finding paths from start back to start
   */
  async generateLoopRoutesAlternative(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    tolerancePercent: number = 20
  ): Promise<any[]> {
    console.log(`🔄 Generating loop routes (alternative method): ${targetDistance}km, ${targetElevation}m elevation`);
    
    // Get network entry points
    const entryPoints = await this.getNetworkEntryPoints(stagingSchema);
    const validLoops: any[] = [];
    
    for (const startNode of entryPoints.slice(0, 10)) { // Limit to first 10 entry points
      console.log(`🔍 Exploring loops from node ${startNode.id}`);
      
      // Find reachable nodes within target distance
      const reachableNodes = await this.findReachableNodes(
        stagingSchema, 
        startNode.id, 
        targetDistance * 0.6 // Look for nodes at ~60% of target distance
      );
      
      for (const endNode of reachableNodes.slice(0, 5)) { // Limit to first 5 reachable nodes
        // Generate KSP routes from start to end
        const kspRoutes = await this.executeKspRouting(stagingSchema, startNode.id, endNode.node_id);
        
        for (const route of kspRoutes.slice(0, 3)) { // Take top 3 KSP routes
          // Calculate return path from end back to start
          const returnRoutes = await this.executeKspRouting(stagingSchema, endNode.node_id, startNode.id);
          
          for (const returnRoute of returnRoutes.slice(0, 2)) { // Take top 2 return routes
            // Combine outbound and return paths to create a loop
            const loopRoute = this.combineRoutesIntoLoop(route, returnRoute, stagingSchema);
            
            if (loopRoute && this.validateLoopRoute(loopRoute, targetDistance, targetElevation, tolerancePercent)) {
              validLoops.push(loopRoute);
            }
          }
        }
      }
    }
    
    console.log(`✅ Generated ${validLoops.length} valid loop routes`);
    return validLoops;
  }

  /**
   * Combine outbound and return routes into a loop
   */
  private combineRoutesIntoLoop(outboundRoute: any, returnRoute: any, stagingSchema: string): any {
    // Implementation would combine the two routes and calculate total metrics
    // This is a simplified version - full implementation would need more detail
    return {
      route_type: 'loop',
      outbound_route: outboundRoute,
      return_route: returnRoute,
      total_distance: (outboundRoute.agg_cost || 0) + (returnRoute.agg_cost || 0),
      // Additional metrics calculation would go here
    };
  }

  /**
   * Validate if a loop route meets criteria
   */
  private validateLoopRoute(
    loopRoute: any, 
    targetDistance: number, 
    targetElevation: number, 
    tolerancePercent: number
  ): boolean {
    const minDistance = targetDistance * (1 - tolerancePercent / 100);
    const maxDistance = targetDistance * (1 + tolerancePercent / 100);
    const minElevation = targetElevation * (1 - tolerancePercent / 100);
    const maxElevation = targetElevation * (1 + tolerancePercent / 100);
    
    return loopRoute.total_distance >= minDistance && 
           loopRoute.total_distance <= maxDistance &&
           loopRoute.total_elevation_gain >= minElevation &&
           loopRoute.total_elevation_gain <= maxElevation;
  }

  /**
   * Get network entry points for routing
   */
  async getNetworkEntryPoints(stagingSchema: string): Promise<any[]> {
    const nodesResult = await this.pgClient.query(`
      SELECT nm.pg_id as id, nm.node_type, nm.connection_count, 
             ST_X(v.the_geom) as lon, 
             ST_Y(v.the_geom) as lat
      FROM ${stagingSchema}.node_mapping nm
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.node_type IN ('intersection', 'simple_connection')
      AND nm.connection_count <= 4
      ORDER BY nm.connection_count ASC, nm.pg_id
      LIMIT 50
    `);
    
    return nodesResult.rows;
  }

  /**
   * Find reachable nodes from a starting point
   */
  async findReachableNodes(
    stagingSchema: string, 
    startNode: number, 
    maxDistance: number
  ): Promise<any[]> {
    const reachableNodes = await this.pgClient.query(`
      SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
      FROM pgr_dijkstra(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        $1::bigint, 
        (SELECT array_agg(pg_id) FROM ${stagingSchema}.node_mapping WHERE node_type IN ('intersection', 'simple_connection')),
        false
      )
      WHERE agg_cost <= $2
      AND end_vid != $1
      ORDER BY agg_cost DESC
      LIMIT 10
    `, [startNode, maxDistance]);
    
    return reachableNodes.rows;
  }

  /**
   * Execute KSP routing between two nodes
   */
  async executeKspRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const kspResult = await this.pgClient.query(`
      SELECT * FROM pgr_ksp(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        $1::bigint, $2::bigint, 3, false, false
      )
    `, [startNode, endNode]);
    
    return kspResult.rows;
  }

  /**
   * Get route edges by IDs with UUID mapping for trail metadata
   */
  async getRouteEdges(stagingSchema: string, edgeIds: number[]): Promise<any[]> {
    const routeEdges = await this.pgClient.query(`
      SELECT 
        w.*,
        em.app_uuid,
        em.trail_name,
        w.length_km as trail_length_km,
        w.elevation_gain as trail_elevation_gain,
        'hiking' as trail_type,
        'dirt' as surface,
        'moderate' as difficulty,
        0 as max_elevation,
        0 as min_elevation,
        0 as avg_elevation
      FROM ${stagingSchema}.ways_noded w
      JOIN ${stagingSchema}.edge_mapping em ON w.id = em.pg_id
      JOIN ${stagingSchema}.trails t ON em.app_uuid = t.app_uuid
      WHERE w.id = ANY($1::integer[])
      ORDER BY w.id
    `, [edgeIds]);
    
    return routeEdges.rows;
  }

  /**
   * Store route recommendation
   */
  async storeRouteRecommendation(
    stagingSchema: string, 
    recommendation: any
  ): Promise<void> {
    await this.pgClient.query(`
      INSERT INTO ${stagingSchema}.route_recommendations (
        route_uuid, route_name, route_type, route_shape,
        input_distance_km, input_elevation_gain,
        recommended_distance_km, recommended_elevation_gain,
        route_path, route_edges, trail_count, route_score,
        similarity_score, region, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
    `, [
      recommendation.route_uuid, recommendation.route_name, recommendation.route_type, recommendation.route_shape,
      recommendation.input_distance_km, recommendation.input_elevation_gain,
      recommendation.recommended_distance_km, recommendation.recommended_elevation_gain,
      JSON.stringify(recommendation.route_path), JSON.stringify(recommendation.route_edges),
      recommendation.trail_count, recommendation.route_score, recommendation.similarity_score, recommendation.region
    ]);
  }
} 