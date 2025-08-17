import { Pool } from 'pg';
import { RoutePattern } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export class RoutePatternSqlHelpers {
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(private pgClient: Pool) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

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
      ORDER BY target_distance_km DESC
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} loop route patterns`);
    
    console.log('🔍 Loop patterns to process (largest first):');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      throw new Error('No loop patterns found');
    }

    return patterns;
  }

  /**
   * Load point-to-point route patterns
   */
  async loadPointToPointPatterns(): Promise<RoutePattern[]> {
    console.log('📋 Loading point-to-point route patterns...');
    
    const patternsResult = await this.pgClient.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'point-to-point'
      ORDER BY target_distance_km DESC
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} point-to-point route patterns`);
    
    console.log('🔍 Point-to-point patterns to process (largest first):');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      console.log('⚠️ No point-to-point patterns found - this is normal for some regions');
      return [];
    }

    return patterns;
  }

  /**
   * Generate loop routes using pgRouting's hawickcircuits with improved tolerance handling
   * This finds all cycles in the graph that meet distance/elevation criteria
   */
  async generateLoopRoutes(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    tolerancePercent: number = 20
  ): Promise<any[]> {
    console.log(`🔄 Generating loop routes: ${targetDistance}km, ${targetElevation}m elevation (with ${tolerancePercent}% tolerance)`);
    
    // Calculate tolerance ranges
    const minDistance = targetDistance * (1 - tolerancePercent / 100);
    const maxDistance = targetDistance * (1 + tolerancePercent / 100);
    const minElevation = targetElevation * (1 - tolerancePercent / 100);
    const maxElevation = targetElevation * (1 + tolerancePercent / 100);
    
    console.log(`📏 Distance range: ${minDistance.toFixed(1)}-${maxDistance.toFixed(1)}km`);
    console.log(`⛰️ Elevation range: ${minElevation.toFixed(0)}-${maxElevation.toFixed(0)}m`);
    
    // For larger loops (10+km), use a different approach with tolerance
    if (targetDistance >= 10) {
      console.log(`🔍 Using large loop detection with ${tolerancePercent}% tolerance for ${targetDistance}km target`);
      return await this.generateLargeLoops(stagingSchema, targetDistance, targetElevation, tolerancePercent);
    }
    
    // For medium loops (3-10km), try both hawickcircuits and connected component approach
    if (targetDistance >= 3) {
      console.log(`🔍 Using combined approach for medium loops (${targetDistance}km target)`);
      const hawickCircuits = await this.generateHawickCircuits(stagingSchema, targetDistance, targetElevation, tolerancePercent);
      const connectedLoops = await this.generateConnectedComponentLoops(stagingSchema, targetDistance, targetElevation, tolerancePercent);
      
      // Combine and deduplicate results
      const allLoops = [...hawickCircuits, ...connectedLoops];
      const uniqueLoops = this.deduplicateLoops(allLoops);
      
      return uniqueLoops;
    }
    
    // For smaller loops, use hawickcircuits with improved filtering
    console.log(`🔍 Using hawickcircuits for smaller loops`);
    
    const cyclesResult = await this.pgClient.query(`
      WITH all_cycles AS (
        SELECT 
          path_id as cycle_id,
          edge as edge_id,
          cost,
          agg_cost,
          path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.routing_edges_trails WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL'
        )
        ORDER BY path_id, path_seq
      ),
      cycle_stats AS (
        SELECT 
          cycle_id,
          COUNT(*) as edge_count,
          SUM(cost) as total_distance,
          MAX(agg_cost) as max_agg_cost
        FROM all_cycles
        GROUP BY cycle_id
      ),
      filtered_cycles AS (
        SELECT ac.*
        FROM all_cycles ac
        JOIN cycle_stats cs ON ac.cycle_id = cs.cycle_id
        WHERE cs.total_distance >= $1 * 0.3  -- At least 30% of target distance
          AND cs.total_distance <= $1 * 2.0  -- At most 200% of target distance
          AND cs.edge_count >= 3             -- At least 3 edges to form a meaningful loop
      )
      SELECT * FROM filtered_cycles
      ORDER BY cycle_id, path_seq
    `, [targetDistance]);
    
    console.log(`🔍 Found ${cyclesResult.rows.length} total edges in cycles with tolerance`);
    
    // Debug: Show some cycle details
    if (cyclesResult.rows.length > 0) {
      const uniqueCycles = new Set(cyclesResult.rows.map(r => r.cycle_id));
      console.log(`🔍 DEBUG: Found ${uniqueCycles.size} unique cycles with tolerance`);
    }
    
    return cyclesResult.rows;
  }

  /**
   * Generate large out-and-back routes (10+km) by finding paths that can form long routes
   */
  private async generateLargeLoops(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    tolerancePercent: number
  ): Promise<any[]> {
    console.log(`🔍 LARGE OUT-AND-BACK DETECTION CALLED: ${targetDistance}km target`);
    console.log(`🔍 Generating large out-and-back routes (${targetDistance}km target)`);
    
    // Get high-degree nodes as potential route anchors
    const anchorNodes = await this.pgClient.query(`
      SELECT rn.id as node_id, 
             (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges_trails WHERE source = rn.id OR target = rn.id) as connection_count,
             rn.lng as lon, rn.lat as lat
      FROM ${stagingSchema}.routing_nodes_intersections rn
      WHERE (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges_trails WHERE source = rn.id OR target = rn.id) >= 3
      ORDER BY connection_count DESC
      LIMIT 20
    `);
    
    console.log(`🔍 Found ${anchorNodes.rows.length} anchor nodes for large out-and-back routes`);
    
    const largeRoutes: any[] = [];
    
    for (const anchor of anchorNodes.rows.slice(0, 10)) {
      console.log(`🔍 Exploring large out-and-back routes from anchor node ${anchor.node_id} (${anchor.connection_count} connections)`);
      
      // Find potential out-and-back paths from this anchor
      const routePaths = await this.findLargeLoopPaths(
        stagingSchema,
        anchor.node_id,
        targetDistance,
        targetElevation
      );
      
      largeRoutes.push(...routePaths);
    }
    
    console.log(`✅ Generated ${largeRoutes.length} large out-and-back route candidates`);
    return largeRoutes;
  }

    /**
   * Find potential large out-and-back paths from an anchor node with 100m tolerance
   */
  private async findLargeLoopPaths(
    stagingSchema: string,
    anchorNode: number,
    targetDistance: number,
    targetElevation: number
  ): Promise<any[]> {
    console.log(`🔍 Finding large out-and-back paths from anchor node ${anchorNode} for ${targetDistance}km target (with 100m tolerance)`);
    
    // Find nodes reachable within target distance, including nearby nodes within 100m
    const reachableNodes = await this.pgClient.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.routing_edges_trails WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          (SELECT array_agg(id) FROM ${stagingSchema}.routing_nodes_intersections WHERE (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges_trails WHERE source = routing_nodes_intersections.id OR target = routing_nodes_intersections.id) >= 2),
          false
        )
        WHERE agg_cost BETWEEN $2 * 0.3 AND $2 * 0.7
        AND end_vid != $1
      ),
      nearby_nodes AS (
        SELECT DISTINCT rn2.id as node_id, 
               ST_Distance(ST_SetSRID(ST_MakePoint(rn1.lng, rn1.lat), 4326), ST_SetSRID(ST_MakePoint(rn2.lng, rn2.lat), 4326)) as distance_meters
        FROM ${stagingSchema}.routing_nodes_intersections rn1
        JOIN ${stagingSchema}.routing_nodes_intersections rn2 ON rn2.id != rn1.id
                  WHERE rn1.id = $1
                  AND (SELECT COUNT(*) FROM ${stagingSchema}.routing_edges_trails WHERE source = rn2.id OR target = rn2.id) >= 2
          AND ST_Distance(ST_SetSRID(ST_MakePoint(rn1.lng, rn1.lat), 4326), ST_SetSRID(ST_MakePoint(rn2.lng, rn2.lat), 4326)) <= 100
                  AND rn2.id != $1
      )
      SELECT node_id, distance_km, 'direct' as connection_type
      FROM direct_reachable
      UNION ALL
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT 15
    `, [anchorNode, targetDistance]);
    
    console.log(`🔍 Found ${reachableNodes.rows.length} reachable nodes (including nearby nodes within 100m)`);
    
    const routePaths: any[] = [];
    
    for (const destNode of reachableNodes.rows.slice(0, 8)) {
      console.log(`🔍 Exploring out-and-back route from ${anchorNode} → ${destNode.node_id} (${destNode.distance_km.toFixed(1)}km outbound, ${destNode.connection_type} connection)`);
      
      // Try to find a return path that creates an out-and-back route
      const returnPaths = await this.pgClient.query(`
        SELECT * FROM pgr_ksp(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${stagingSchema}.ways_noded WHERE length_km IS NOT NULL',
          $1::bigint, $2::bigint, 3, false, false
        )
      `, [destNode.node_id, anchorNode]);
      
      console.log(`🔍 Found ${returnPaths.rows.length} return paths`);
      
      for (const returnPath of returnPaths.rows.slice(0, 2)) {
        // Calculate total out-and-back distance
        const totalDistance = destNode.distance_km + returnPath.agg_cost;
        
        console.log(`🔍 Out-and-back candidate: ${destNode.distance_km.toFixed(1)}km out + ${returnPath.agg_cost.toFixed(1)}km back = ${totalDistance.toFixed(1)}km total`);
        
        if (totalDistance >= targetDistance * 0.8 && totalDistance <= targetDistance * 1.2) {
          console.log(`✅ Valid large out-and-back route found: ${totalDistance.toFixed(1)}km`);
          routePaths.push({
            anchor_node: anchorNode,
            dest_node: destNode.node_id,
            outbound_distance: destNode.distance_km,
            return_distance: returnPath.agg_cost,
            total_distance: totalDistance,
            path_id: returnPath.path_id,
            connection_type: destNode.connection_type,
            route_type: 'out-and-back' // Mark as out-and-back, not loop
          });
        }
      }
    }
    
    console.log(`✅ Found ${routePaths.length} valid large out-and-back route candidates`);
    return routePaths;
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
    
    console.log(`🔍 DEBUG: Filtering ${cycles.size} cycles with criteria: ${minDistance}-${maxDistance}km, ${minElevation}-${maxElevation}m`);
    
    for (const [cycleId, edges] of cycles) {
      // Calculate total distance and elevation for this cycle
      const edgeIds = edges.map(e => parseInt(e.edge_id)).filter(id => id > 0); // Convert strings to integers, filter out -1
      
      console.log(`🔍 DEBUG: Cycle ${cycleId} edge IDs: ${edgeIds.join(', ')}`);
      console.log(`🔍 DEBUG: Cycle ${cycleId} has ${edgeIds.length} valid edge IDs`);
      
      if (edgeIds.length === 0) {
        console.log(`⚠️ DEBUG: Cycle ${cycleId} has no valid edge IDs, skipping`);
        continue;
      }
      
      const cycleMetrics = await this.calculateCycleMetrics(stagingSchema, edgeIds);
      
      console.log(`🔍 DEBUG: Cycle ${cycleId} metrics: ${cycleMetrics.totalDistance.toFixed(2)}km, ${cycleMetrics.totalElevationGain.toFixed(0)}m`);
      
      // Check if cycle meets criteria
      if (cycleMetrics.totalDistance >= minDistance && 
          cycleMetrics.totalDistance <= maxDistance &&
          cycleMetrics.totalElevationGain >= minElevation &&
          cycleMetrics.totalElevationGain <= maxElevation) {
        
        console.log(`✅ DEBUG: Cycle ${cycleId} meets criteria!`);
        validLoops.push({
          cycle_id: cycleId,
          edges: edges,
          total_distance: cycleMetrics.totalDistance,
          total_elevation_gain: cycleMetrics.totalElevationGain,
          trail_count: cycleMetrics.trailCount,
          route_shape: 'loop'
        });
      } else {
        console.log(`❌ DEBUG: Cycle ${cycleId} filtered out (distance: ${cycleMetrics.totalDistance.toFixed(2)}km, elevation: ${cycleMetrics.totalElevationGain.toFixed(0)}m)`);
      }
    }
    
    console.log(`🔍 DEBUG: Returning ${validLoops.length} valid loops`);
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
    console.log(`🔍 DEBUG: calculateCycleMetrics called with edgeIds: ${edgeIds.join(', ')} (type: ${typeof edgeIds[0]})`);
    
    const metricsResult = await this.pgClient.query(`
      SELECT 
        SUM(re.length_km) as total_distance,
        SUM(re.elevation_gain) as total_elevation_gain,
        COUNT(DISTINCT re.app_uuid) as trail_count
      FROM ${stagingSchema}.ways_noded re
      WHERE re.id = ANY($1::integer[])
    `, [edgeIds]);
    
    const metrics = metricsResult.rows[0];
    console.log(`🔍 DEBUG: calculateCycleMetrics result: ${JSON.stringify(metrics)}`);
    
    return {
      totalDistance: parseFloat(metrics.total_distance) || 0,
      totalElevationGain: parseFloat(metrics.total_elevation_gain) || 0,
      trailCount: parseInt(metrics.trail_count) || 0
    };
  }

  /**
   * Validate that a route only uses actual trail edges
   * This prevents artificial connections between distant nodes
   */
  async validateRouteEdges(
    stagingSchema: string, 
    edgeIds: number[]
  ): Promise<{ isValid: boolean; reason?: string }> {
    if (edgeIds.length === 0) {
      return { isValid: false, reason: 'No edges provided' };
    }

    // Check that all edges exist and are valid trail edges
    const validationResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(*) FILTER (WHERE source IS NOT NULL AND target IS NOT NULL) as connected_edges,
        COUNT(*) FILTER (WHERE app_uuid IS NOT NULL AND trail_name IS NOT NULL) as trail_edges,
        COUNT(*) FILTER (WHERE length_km <= 2.0) as reasonable_length_edges,
        COUNT(*) FILTER (WHERE length_km > 2.0) as long_edges,
        MAX(length_km) as max_edge_length,
        MIN(length_km) as min_edge_length
      FROM ${stagingSchema}.ways_noded
      WHERE id = ANY($1::integer[])
    `, [edgeIds]);

    const stats = validationResult.rows[0];
    
    // Validation checks
    if (stats.total_edges !== edgeIds.length) {
      return { isValid: false, reason: `Missing edges: expected ${edgeIds.length}, found ${stats.total_edges}` };
    }
    
    if (stats.connected_edges !== edgeIds.length) {
      return { isValid: false, reason: `Disconnected edges: ${edgeIds.length - stats.connected_edges} edges have null source/target` };
    }
    
    if (stats.trail_edges !== edgeIds.length) {
      return { isValid: false, reason: `Non-trail edges: ${edgeIds.length - stats.trail_edges} edges missing app_uuid or name` };
    }
    
    if (stats.long_edges > 0) {
      return { isValid: false, reason: `Long edges detected: ${stats.long_edges} edges > 2km (max: ${stats.max_edge_length.toFixed(2)}km)` };
    }
    
    if (stats.max_edge_length > 2.0) {
      return { isValid: false, reason: `Edge too long: ${stats.max_edge_length.toFixed(2)}km exceeds 2km limit` };
    }

    return { isValid: true };
  }

  /**
   * Execute KSP routing between two nodes with enhanced diversity
   */
  async executeKspRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number,
    kValue: number = 10
  ): Promise<any[]> {
    // Use configurable K value for more diverse routes
    // Add constraints to prevent use of extremely long edges and ensure routes follow actual trails
    const kspResult = await this.pgClient.query(`
      SELECT * FROM pgr_ksp(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded 
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id',
        $1::bigint, $2::bigint, $3, false, false
      )
    `, [startNode, endNode, kValue]);
    
    return kspResult.rows;
  }

  /**
   * Execute A* routing for more efficient pathfinding
   */
  async executeAstarRouting(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const astarResult = await this.pgClient.query(`
      SELECT * FROM pgr_astar(
        'SELECT id, source, target, length_km as cost, 
                ST_X(ST_StartPoint(geometry)) as x1, ST_Y(ST_StartPoint(geometry)) as y1,
                ST_X(ST_EndPoint(geometry)) as x2, ST_Y(ST_EndPoint(geometry)) as y2
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND trail_name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id',
        $1::bigint, $2::bigint, false
      )
    `, [startNode, endNode]);
    
    return astarResult.rows;
  }

  /**
   * Execute bidirectional Dijkstra for better performance on large networks
   */
  async executeBidirectionalDijkstra(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const bdResult = await this.pgClient.query(`
      SELECT * FROM pgr_bddijkstra(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND trail_name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id',
        $1::bigint, $2::bigint, false
      )
    `, [startNode, endNode]);
    
    return bdResult.rows;
  }

  /**
   * Execute Chinese Postman for optimal trail coverage
   * This finds the shortest route that covers all edges at least once
   */
  async executeChinesePostman(stagingSchema: string): Promise<any[]> {
    const cpResult = await this.pgClient.query(`
      SELECT * FROM pgr_chinesepostman(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND trail_name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id'
      )
    `);
    
    return cpResult.rows;
  }

  /**
   * Execute Hawick Circuits for finding all cycles in the network
   * This is excellent for loop route generation
   */
  async executeHawickCircuits(stagingSchema: string): Promise<any[]> {
    const hcResult = await this.pgClient.query(`
      SELECT * FROM pgr_hawickcircuits(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
           AND app_uuid IS NOT NULL  -- Ensure edge is part of actual trail
           AND trail_name IS NOT NULL  -- Ensure edge has a trail name
         ORDER BY id'
      )
    `);
    
    return hcResult.rows;
  }

  /**
   * Execute withPointsKSP for routes that can start/end at any point along trails
   * This allows for more flexible route generation
   */
  async executeWithPointsKsp(
    stagingSchema: string, 
    startNode: number, 
    endNode: number
  ): Promise<any[]> {
    const wpkspResult = await this.pgClient.query(`
      SELECT * FROM pgr_withpointsksp(
        'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
        'SELECT pid, edge_id, fraction FROM ${stagingSchema}.points_of_interest',
        ARRAY[$1::bigint], ARRAY[$2::bigint], 6, 'd', false, false
      )
    `, [startNode, endNode]);
    
    return wpkspResult.rows;
  }

  /**
   * Get route edges by IDs with split trail metadata
   */
  async getRouteEdges(stagingSchema: string, edgeIds: number[]): Promise<any[]> {
    const routeEdges = await this.pgClient.query(`
      SELECT 
        w.*,
        w.app_uuid as app_uuid,
        w.name as trail_name,
        w.length_km as trail_length_km,
        w.elevation_gain as trail_elevation_gain,
        w.elevation_loss as elevation_loss,
        'hiking' as trail_type,
        'dirt' as surface,
        'moderate' as difficulty,
        0 as max_elevation,
        0 as min_elevation,
        0 as avg_elevation
      FROM ${stagingSchema}.ways_noded w
      WHERE w.id = ANY($1::integer[])
      ORDER BY w.id
    `, [edgeIds]);
    
    return routeEdges.rows;
  }

  /**
   * Store a route recommendation in the staging schema
   */
  async storeRouteRecommendation(
    stagingSchema: string, 
    recommendation: any
  ): Promise<void> {
    // DEBUG: Log staging schema and check if table exists
    console.log(`🔍 DEBUG: Attempting to store route recommendation in staging schema: ${stagingSchema}`);
    
    // Check if the route_recommendations table exists
    try {
      const tableExistsResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'route_recommendations'
        ) as exists
      `, [stagingSchema]);
      
      const tableExists = tableExistsResult.rows[0].exists;
      console.log(`🔍 DEBUG: route_recommendations table exists in ${stagingSchema}: ${tableExists}`);
      
      if (!tableExists) {
        console.error(`❌ ERROR: route_recommendations table does not exist in schema ${stagingSchema}`);
        
        // List all tables in the staging schema
        const tablesResult = await this.pgClient.query(`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = $1 
          ORDER BY table_name
        `, [stagingSchema]);
        
        console.log(`🔍 DEBUG: Available tables in ${stagingSchema}:`, tablesResult.rows.map(r => r.table_name));
        
        // Check if the schema itself exists
        const schemaExistsResult = await this.pgClient.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.schemata 
            WHERE schema_name = $1
          ) as exists
        `, [stagingSchema]);
        
        const schemaExists = schemaExistsResult.rows[0].exists;
        console.log(`🔍 DEBUG: Schema ${stagingSchema} exists: ${schemaExists}`);
        
        throw new Error(`route_recommendations table does not exist in staging schema ${stagingSchema}`);
      }
    } catch (error) {
      console.error(`❌ ERROR: Failed to check table existence: ${error}`);
      throw error;
    }
    
    // Compute route geometry from route_edges
    let routeGeometry = null;
    if (recommendation.route_edges && Array.isArray(recommendation.route_edges) && recommendation.route_edges.length > 0) {
      try {
        // Extract edge IDs from route_edges
        const edgeIds = recommendation.route_edges
          .map((edge: any) => edge.id)
          .filter((id: any) => id !== null && id !== undefined);
        
        if (edgeIds.length > 0) {
          // Build route geometry by concatenating edge geometries
          const geometryResult = await this.pgClient.query(`
            WITH collected_geom AS (
              SELECT ST_Collect(the_geom) as geom
              FROM ${stagingSchema}.ways_noded
              WHERE id = ANY($1::integer[])
              AND the_geom IS NOT NULL
            ),
            merged_geom AS (
              SELECT ST_LineMerge(geom) as route_geometry
              FROM collected_geom
            )
            SELECT 
              CASE 
                WHEN ST_GeometryType(route_geometry) = 'ST_MultiLineString' THEN
                  -- If we get a MultiLineString, take the longest line
                  (SELECT the_geom FROM (
                    SELECT (ST_Dump(route_geometry)).geom as the_geom,
                           ST_Length((ST_Dump(route_geometry)).geom::geography) as length
                    ORDER BY length DESC
                    LIMIT 1
                  ) longest_line)
                ELSE route_geometry
              END as route_geometry
            FROM merged_geom
          `, [edgeIds]);
          
          if (geometryResult.rows[0]?.route_geometry) {
            routeGeometry = geometryResult.rows[0].route_geometry;
          }
        }
      } catch (error) {
        console.warn(`⚠️ Failed to compute route geometry for route ${recommendation.route_uuid}: ${error}`);
      }
    }

    await this.pgClient.query(`
      INSERT INTO ${stagingSchema}.route_recommendations (
        route_uuid, region, input_length_km, input_elevation_gain,
        recommended_length_km, recommended_elevation_gain, route_type, route_shape,
        trail_count, route_score, similarity_score, route_path, route_edges, route_name, route_geometry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      recommendation.route_uuid, recommendation.region, recommendation.input_length_km, recommendation.input_elevation_gain,
      recommendation.recommended_length_km, recommendation.recommended_elevation_gain, recommendation.route_type, recommendation.route_shape,
      recommendation.trail_count, recommendation.route_score, recommendation.similarity_score, recommendation.route_path, JSON.stringify(recommendation.route_edges), recommendation.route_name,
      routeGeometry
    ]);
  }

  /**
   * Get network entry points for route generation
   * @param stagingSchema The staging schema name
   * @param useTrailheadsOnly If true, only return trailhead nodes. If false, use default logic.
   * @param maxEntryPoints Maximum number of entry points to return
   * @param trailheadLocations Optional array of trailhead coordinate locations
   */
  async getNetworkEntryPoints(
    stagingSchema: string, 
    useTrailheadsOnly: boolean = false,
    maxEntryPoints: number = 50,
    trailheadLocations?: Array<{lat: number, lng: number, tolerance_meters?: number}>
  ): Promise<any[]> {
    console.log(`🔍 Finding network entry points${useTrailheadsOnly ? ' (trailheads only)' : ''}...`);
    
    if (useTrailheadsOnly) {
      // Load trailhead configuration from YAML
      const config = this.configLoader.loadConfig();
      const trailheadConfig = config.trailheads;
      
      console.log(`🔍 Trailhead config: enabled=${trailheadConfig.enabled}, strategy=${trailheadConfig.selectionStrategy}, locations=${trailheadConfig.locations?.length || 0}`);
      
      if (!trailheadConfig.enabled) {
        console.log('⚠️ Trailheads disabled in config - falling back to default entry points');
        return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
      }
      
      // Use coordinate-based trailhead finding from YAML config
      if (trailheadConfig.selectionStrategy === 'coordinates' && trailheadConfig.locations && trailheadConfig.locations.length > 0) {
        console.log(`✅ Using ${trailheadConfig.locations.length} trailhead locations from YAML config`);
        return this.findNearestEdgeEndpointsToTrailheads(stagingSchema, trailheadConfig.locations, trailheadConfig.maxTrailheads);
      }
      
      // Use manual trailhead nodes (if any exist in database)
      if (trailheadConfig.selectionStrategy === 'manual') {
        console.log('🔍 Looking for manual trailhead nodes in database...');
        const manualTrailheadNodes = await this.pgClient.query(`
          SELECT 
            rn.id,
            rn.node_type,
            (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded WHERE source = rn.id OR target = rn.id) as connection_count,
            rn.lat as lat,
            rn.lng as lon,
            'manual_trailhead' as entry_type
          FROM ${stagingSchema}.routing_nodes rn
          WHERE rn.node_type = 'trailhead'
          ORDER BY connection_count ASC, rn.id
          LIMIT $1
        `, [trailheadConfig.maxTrailheads]);
        
        console.log(`✅ Found ${manualTrailheadNodes.rows.length} manual trailhead nodes`);
        
        if (manualTrailheadNodes.rows.length === 0) {
          console.warn('⚠️ No manual trailheads found - falling back to default entry points');
          return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
        }
        
        return manualTrailheadNodes.rows;
      }
      
      // Fallback to default entry points
      console.log('⚠️ No trailhead strategy matched - falling back to default entry points');
      return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
    }
    
    // Default behavior: use all available nodes
    console.log('✅ Using default network entry points (all available nodes)');
    return this.getDefaultNetworkEntryPoints(stagingSchema, maxEntryPoints);
  }

  /**
   * Get default network entry points (edge endpoints near network boundaries)
   */
  private async getDefaultNetworkEntryPoints(stagingSchema: string, maxEntryPoints: number = 50): Promise<any[]> {
    const entryPoints = await this.pgClient.query(`
      WITH network_bounds AS (
        -- Get the bounding box of the entire network
        SELECT 
          ST_Envelope(ST_Collect(the_geom)) as bounds
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      edge_endpoints AS (
        -- Find degree-1 nodes that are near the network boundaries
        SELECT 
          v.id,
          'endpoint' as node_type,
          v.cnt as connection_count,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lon,
          'edge_endpoint' as entry_type,
          -- Calculate distance to network boundary (closer = more edge-like)
          ST_Distance(v.the_geom, nb.bounds) as boundary_distance
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        CROSS JOIN network_bounds nb
        WHERE v.cnt = 1  -- Only use degree-1 vertices
      )
      SELECT 
        id,
        node_type,
        connection_count,
        lat,
        lon,
        entry_type
      FROM edge_endpoints
      ORDER BY boundary_distance ASC, id  -- Prefer nodes closer to network boundaries
      LIMIT $1
    `, [maxEntryPoints]);
    
    console.log(`✅ Selected ${entryPoints.rows.length} edge endpoint nodes for route generation`);
    return entryPoints.rows;
  }

  /**
   * Find nearest edge endpoints to trailhead coordinates
   */
  private async findNearestEdgeEndpointsToTrailheads(
    stagingSchema: string,
    trailheadLocations: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>,
    maxTrailheads: number = 50
  ): Promise<any[]> {
    const trailheadNodes: any[] = [];
    
    for (const location of trailheadLocations.slice(0, maxTrailheads)) {
      const tolerance = location.tolerance_meters || 50;
      
      // Find the nearest node to this coordinate location
      const nearestNode = await this.pgClient.query(`
        SELECT 
          v.id,
          'endpoint' as node_type,
          v.cnt as connection_count,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lon,
          ST_Distance(
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            v.the_geom
          ) * 111000 as distance_meters
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        WHERE ST_DWithin(
          ST_SetSRID(ST_MakePoint($1, $2), 4326),
          v.the_geom,
          $3 / 111000.0
        )
        ORDER BY distance_meters ASC
        LIMIT 1
      `, [location.lng, location.lat, tolerance]);
      
      if (nearestNode.rows.length > 0) {
        const node = nearestNode.rows[0];
        console.log(`✅ Found trailhead node: ID ${node.id} at ${node.lat}, ${node.lon} (distance: ${node.distance_meters.toFixed(1)}m)`);
        trailheadNodes.push(node);
      } else {
        console.log(`❌ No routing nodes found within ${tolerance}m of ${location.lat}, ${location.lng}`);
      }
    }
    
    console.log(`🔍 Found ${trailheadNodes.length} trailhead nodes total`);
    return trailheadNodes.slice(0, maxTrailheads);
  }

  /**
   * Find nodes reachable from a starting node within a maximum distance
   */
  async findReachableNodes(
    stagingSchema: string, 
    startNode: number, 
    maxDistance: number
  ): Promise<any[]> {
    const reachableNodes = await this.pgClient.query(`
      SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
      FROM pgr_dijkstra(
        'SELECT id, source, target, length_km as cost 
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND length_km <= 2.0  -- Prevent use of extremely long edges (>2km)
         ORDER BY id',
        $1::bigint, 
        (SELECT array_agg(id) FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt > 0),
        false
      )
      WHERE agg_cost <= $2
      AND end_vid != $1
      ORDER BY agg_cost DESC
      LIMIT 10
    `, [startNode, maxDistance]);
    
    return reachableNodes.rows;
  }
} 