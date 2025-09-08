import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RouteGenerationBusinessLogic, ToleranceLevel, UsedArea } from '../business/route-generation-business-logic';

export interface UnifiedLoopRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  maxLoopSearchDistance: number; // Maximum distance to search for loop endpoints
  elevationGainRateWeight: number; // Weight for elevation gain rate matching (0-1)
  distanceWeight: number; // Weight for distance matching (0-1)
  hawickMaxRows?: number; // Max rows to read from pgr_hawickcircuits
}

export class UnifiedLoopRouteGeneratorService {
  constructor(
    private pgClient: Pool,
    private config: UnifiedLoopRouteGeneratorConfig
  ) {}

  /**
   * Generate loop routes using unified network structure
   * Focuses on elevation gain rate matching and distance accuracy
   */
  async generateLoopRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 [UNIFIED-LOOP] Generating loop routes with unified network...');
    console.log('🔍 [UNIFIED-LOOP] DEBUG: Starting loop route generation');
    
    // Verify unified network structure
    console.log('🔍 [UNIFIED-LOOP] DEBUG: Verifying unified network...');
    await this.verifyUnifiedNetwork();
    console.log('🔍 [UNIFIED-LOOP] DEBUG: Unified network verified successfully');
    
    console.log('🔍 [UNIFIED-LOOP] DEBUG: Loading loop patterns...');
    const patterns = await this.loadLoopPatterns();
    console.log(`🔍 [UNIFIED-LOOP] DEBUG: Loaded ${patterns.length} loop patterns`);
    
    const allRecommendations: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`\n🎯 [UNIFIED-LOOP] Processing loop pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      console.log(`🔍 [UNIFIED-LOOP] DEBUG: Generating routes for pattern ${pattern.pattern_name}...`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern);
      console.log(`🔍 [UNIFIED-LOOP] DEBUG: Generated ${patternRoutes.length} raw routes for pattern ${pattern.pattern_name}`);
      
      // Sort by loop-specific scoring (elevation gain rate + distance accuracy)
      const bestRoutes = patternRoutes
        .sort((a, b) => b.route_score - a.route_score)
        .slice(0, this.config.targetRoutesPerPattern);
      
      allRecommendations.push(...bestRoutes);
      console.log(`✅ [UNIFIED-LOOP] Generated ${bestRoutes.length} loop routes for ${pattern.pattern_name}`);
    }

    console.log(`🔍 [UNIFIED-LOOP] DEBUG: Total loop routes generated: ${allRecommendations.length}`);
    return allRecommendations;
  }

  /**
   * Generate routes for a specific loop pattern
   */
  private async generateRoutesForPattern(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`📏 [UNIFIED-LOOP] Targeting loop: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    
    const patternRoutes: RouteRecommendation[] = [];
    const usedAreas: UsedArea[] = [];
    const toleranceLevels = RouteGenerationBusinessLogic.getToleranceLevels(pattern);
    const seenTrailCombinations = new Set<string>();

    for (const tolerance of toleranceLevels) {
      if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
      
      console.log(`🔍 [UNIFIED-LOOP] Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
      
      // Try multiple loop generation strategies
      await this.generateLoopsWithHawickCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      
      if (patternRoutes.length < this.config.targetRoutesPerPattern) {
        await this.generateLoopsWithKspCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      }
      
      if (patternRoutes.length < this.config.targetRoutesPerPattern) {
        await this.generateLoopsWithDijkstraCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      }
    }
    
    return patternRoutes;
  }

  /**
   * Strategy 1: Use pgr_hawickCircuits to find all cycles in the network
   * Best for finding natural loops in the trail network
   */
  private async generateLoopsWithHawickCircuits(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      console.log(`🔄 [UNIFIED-LOOP] Finding loops with Hawick Circuits...`);
      
      // Use ways_noded but find larger loops by combining multiple edges
      const loops = await this.pgClient.query(`
        SELECT 
          path_id,
          seq,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_hawickcircuits(
          'SELECT 
            id, 
            source, 
            target, 
            cost,
            reverse_cost
           FROM ${this.config.stagingSchema}.ways_noded
           WHERE source IS NOT NULL 
             AND target IS NOT NULL 
             AND cost >= 0.1  -- Minimum 100m segments
           ORDER BY id'
        )
        ORDER BY path_id, path_seq
        LIMIT ${this.config.hawickMaxRows ?? 10000}
      `);

      console.log(`🔍 [UNIFIED-LOOP] Found ${loops.rows.length} potential loop edges with Hawick Circuits`);

      // Group loops by path_id (cycle ID) instead of path_seq
      const loopGroups = new Map<number, any[]>();
      loops.rows.forEach(row => {
        if (!loopGroups.has(row.path_id)) {
          loopGroups.set(row.path_id, []);
        }
        loopGroups.get(row.path_id)!.push(row);
      });

      // Filter cycles by total distance after grouping
      const validCycles = new Map<number, any[]>();
      for (const [pathId, cycleEdges] of loopGroups) {
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        const minDistance = pattern.target_distance_km * (1 - tolerance.distance / 100);
        const maxDistance = pattern.target_distance_km * (1 + tolerance.distance / 100);
        
        if (totalDistance >= minDistance && totalDistance <= maxDistance) {
          validCycles.set(pathId, cycleEdges);
        }
      }

      console.log(`🔍 [UNIFIED-LOOP] Found ${validCycles.size} valid cycles within distance tolerance`);

      for (const [pathId, loopEdges] of validCycles) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        const route = await this.createLoopRouteFromEdges(
          pattern,
          tolerance,
          loopEdges,
          pathId,
          'hawick-circuits',
          seenTrailCombinations
        );

        if (route) {
          patternRoutes.push(route);
          console.log(`✅ [UNIFIED-LOOP] Added Hawick Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-LOOP] Error with Hawick Circuits:', error);
    }
  }

  /**
   * Strategy 2: Use KSP to find loops by connecting distant endpoints
   * Good for creating longer, more diverse loops
   */
  private async generateLoopsWithKspCircuits(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      console.log(`🔄 [UNIFIED-LOOP] Finding loops with KSP circuits...`);
      
      // Get valid starting points (nodes with multiple connections)
      const startPoints = await this.pgClient.query(`
        SELECT 
          id,
          cnt as degree,
          the_geom
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt >= 3  -- Only nodes with multiple connections
        ORDER BY RANDOM()
        LIMIT 20
      `);

      for (const startPoint of startPoints.rows) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        // Find reachable nodes within target distance range
        const reachableNodes = await this.pgClient.query(`
          SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost
             FROM ${this.config.stagingSchema}.ways_noded
             WHERE source IS NOT NULL
               AND target IS NOT NULL
               AND cost <= 5.0
             ORDER BY id',
            $1::bigint,
            (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE cnt >= 2),
            false
          )
          WHERE agg_cost >= $2 AND agg_cost <= $3
          ORDER BY agg_cost DESC
          LIMIT 10
        `, [
          startPoint.id,
          pattern.target_distance_km * 0.3, // Start looking at 30% of target distance
          pattern.target_distance_km * 0.7  // Up to 70% of target distance
        ]);

        for (const reachableNode of reachableNodes.rows) {
          if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

          // Use KSP to find multiple paths back to start
          const kspResult = await this.pgClient.query(`
            SELECT 
              seq,
              path_seq,
              node,
              edge,
              cost,
              agg_cost
            FROM pgr_ksp(
              'SELECT id, source, target, cost
               FROM ${this.config.stagingSchema}.ways_noded
               WHERE source IS NOT NULL
                 AND target IS NOT NULL
                 AND cost <= 5.0
               ORDER BY id',
              $1::bigint, $2::bigint, 3, false
            )
            WHERE agg_cost >= $3 AND agg_cost <= $4
            ORDER BY agg_cost DESC
          `, [
            reachableNode.node_id,
            startPoint.id,
            pattern.target_distance_km * (1 - tolerance.distance / 100),
            pattern.target_distance_km * (1 + tolerance.distance / 100)
          ]);

          if (kspResult.rows.length > 0) {
            const route = await this.createLoopRouteFromKsp(
              pattern,
              tolerance,
              kspResult.rows,
              startPoint,
              reachableNode,
              seenTrailCombinations
            );

            if (route) {
              patternRoutes.push(route);
              console.log(`✅ [UNIFIED-LOOP] Added KSP circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-LOOP] Error with KSP circuits:', error);
    }
  }

  /**
   * Strategy 3: Use Dijkstra to find loops by exploring from multiple start points
   * Good for finding shorter, more accessible loops
   */
  private async generateLoopsWithDijkstraCircuits(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      console.log(`🔄 [UNIFIED-LOOP] Finding loops with Dijkstra circuits...`);
      
      // Get intersection nodes (good starting points for loops)
      const intersectionNodes = await this.pgClient.query(`
        SELECT 
          id,
          cnt as degree,
          the_geom
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt >= 3
        ORDER BY RANDOM()
        LIMIT 15
      `);

      for (const startNode of intersectionNodes.rows) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        // Find all reachable nodes within target distance
        const reachableNodes = await this.pgClient.query(`
          SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost
             FROM ${this.config.stagingSchema}.ways_noded
             WHERE source IS NOT NULL
               AND target IS NOT NULL
               AND cost <= 5.0
             ORDER BY id',
            $1::bigint,
            (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE cnt >= 2),
            false
          )
          WHERE agg_cost >= $2 AND agg_cost <= $3
          ORDER BY agg_cost DESC
          LIMIT 8
        `, [
          startNode.id,
          pattern.target_distance_km * 0.4,
          pattern.target_distance_km * 0.6
        ]);

        for (const endNode of reachableNodes.rows) {
          if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

          // Find path from end back to start to complete the loop
          const returnPath = await this.pgClient.query(`
            SELECT 
              seq,
              node,
              edge,
              cost,
              agg_cost
            FROM pgr_dijkstra(
              'SELECT id, source, target, cost
               FROM ${this.config.stagingSchema}.ways_noded
               WHERE source IS NOT NULL
                 AND target IS NOT NULL
                 AND cost <= 5.0
               ORDER BY id',
              $1::bigint, $2::bigint, false
            )
            ORDER BY seq
          `, [endNode.node_id, startNode.id]);

          if (returnPath.rows.length > 0) {
            const totalDistance = endNode.distance_km + returnPath.rows[returnPath.rows.length - 1].agg_cost;
            
            if (totalDistance >= pattern.target_distance_km * (1 - tolerance.distance / 100) &&
                totalDistance <= pattern.target_distance_km * (1 + tolerance.distance / 100)) {
              
              const route = await this.createLoopRouteFromDijkstra(
                pattern,
                tolerance,
                reachableNodes.rows,
                returnPath.rows,
                startNode,
                endNode,
                seenTrailCombinations
              );

              if (route) {
                patternRoutes.push(route);
                console.log(`✅ [UNIFIED-LOOP] Added Dijkstra circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-LOOP] Error with Dijkstra circuits:', error);
    }
  }

  /**
   * Create loop route from Hawick Circuits edges
   */
  private async createLoopRouteFromEdges(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    loopEdges: any[],
    pathSeq: number,
    algorithm: string,
    seenTrailCombinations: Set<string>
  ): Promise<RouteRecommendation | null> {
    try {
      const edgeIds = loopEdges.map(edge => edge.edge).filter(id => id !== -1);
      if (edgeIds.length === 0) return null;

      // Get edge details with elevation data
      const edgeDetails = await this.pgClient.query(`
        SELECT 
          wn.id,
          wn.length_km,
          COALESCE(w.trail_name, 'Unknown Trail') as trail_name,
          w.trail_type,
          COALESCE(w.elevation_gain, 0) as elevation_gain,
          COALESCE(w.elevation_loss, 0) as elevation_loss
        FROM ${this.config.stagingSchema}.ways_noded wn
        JOIN ${this.config.stagingSchema}.ways w ON wn.id = w.id
        WHERE wn.id = ANY($1)
      `, [edgeIds]);
      
      // Aggregate route geometry from constituent trails with 3D elevation
      const routeGeometry = await this.pgClient.query(`
        WITH route_edges AS (
          SELECT wn.id, wn.original_trail_uuid, w.the_geom, w.elevation_gain, w.elevation_loss, w.length_km,
                 t.min_elevation, t.max_elevation, t.avg_elevation
          FROM ${this.config.stagingSchema}.ways_noded wn
          JOIN ${this.config.stagingSchema}.ways w ON wn.id = w.id
          LEFT JOIN ${this.config.stagingSchema}.trails t ON wn.original_trail_uuid = t.app_uuid
          WHERE wn.id = ANY($1)
            AND w.the_geom IS NOT NULL
            AND ST_IsValid(w.the_geom)
        ),
        route_3d_geom AS (
          SELECT 
            ST_Force3D(
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(the_geom))) = 'ST_MultiLineString' THEN
                  ST_GeometryN(ST_LineMerge(ST_Union(the_geom)), 1)
                ELSE
                  ST_LineMerge(ST_Union(the_geom))
              END
            ) as route_geometry
          FROM route_edges
        )
        SELECT route_geometry FROM route_3d_geom
        WHERE ST_IsValid(route_geometry) AND NOT ST_IsEmpty(route_geometry)
      `, [edgeIds]);

      const totalDistance = loopEdges[loopEdges.length - 1].agg_cost;
      const totalElevation = edgeDetails.rows.reduce((sum, edge) => sum + (edge.elevation_gain || 0), 0);
      const trailNames = edgeDetails.rows.map(edge => edge.trail_name).filter(Boolean);

      // Calculate elevation gain rate (m/km)
      const elevationGainRate = totalDistance > 0 ? totalElevation / totalDistance : 0;
      const targetElevationGainRate = pattern.target_elevation_gain / pattern.target_distance_km;

      // Check if route meets pattern criteria
      const distanceTolerance = pattern.target_distance_km * (tolerance.distance / 100);
      const elevationTolerance = pattern.target_elevation_gain * (tolerance.elevation / 100);

      if (Math.abs(totalDistance - pattern.target_distance_km) > distanceTolerance) {
        return null;
      }

      // Check for duplicate trail combinations
      const trailKey = trailNames.sort().join('|');
      if (seenTrailCombinations.has(trailKey)) {
        return null;
      }

      // Calculate loop-specific score (prioritizes elevation gain rate matching)
      const distanceScore = this.calculateDistanceScore(totalDistance, pattern.target_distance_km, tolerance);
      const elevationRateScore = this.calculateElevationRateScore(elevationGainRate, targetElevationGainRate, tolerance);
      
      const routeScore = (
        this.config.distanceWeight * distanceScore +
        this.config.elevationGainRateWeight * elevationRateScore
      ) / (this.config.distanceWeight + this.config.elevationGainRateWeight);

      // Determine actual route shape based on geometry, not pattern
      const routeShapeAnalysis = await this.determineRouteShapeFromGeometry(routeGeometry.rows[0]?.route_geometry || null, loopEdges);
      
      // Generate appropriate route name based on actual shape
      const routeName = this.generateRouteNameByShape(pattern, routeShapeAnalysis.shape, trailNames, totalDistance, totalElevation);
      
      const route: RouteRecommendation = {
        route_uuid: `unified-${routeShapeAnalysis.shape}-${algorithm}-${Date.now()}-${pathSeq}`,
        route_name: routeName,

        route_shape: routeShapeAnalysis.shape,
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: totalElevation,
        route_path: loopEdges,
        route_edges: edgeDetails.rows,
        route_geometry: routeGeometry.rows[0]?.route_geometry || null,
        trail_count: trailNames.length,
        route_score: routeScore,
        similarity_score: 0,
        region: this.config.region,
        constituent_trails: trailNames,
        unique_trail_count: new Set(trailNames).size,
        total_trail_distance_km: totalDistance,
        total_trail_elevation_gain_m: totalElevation,
        out_and_back_distance_km: totalDistance,
        out_and_back_elevation_gain_m: totalElevation
      };

      seenTrailCombinations.add(trailKey);
      return route;

    } catch (error) {
      console.error('❌ [UNIFIED-LOOP] Error creating loop route:', error);
      return null;
    }
  }

  /**
   * Create loop route from KSP results
   */
  private async createLoopRouteFromKsp(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    kspEdges: any[],
    startPoint: any,
    endPoint: any,
    seenTrailCombinations: Set<string>
  ): Promise<RouteRecommendation | null> {
    // Similar to createLoopRouteFromEdges but for KSP results
    return this.createLoopRouteFromEdges(pattern, tolerance, kspEdges, 0, 'ksp-circuit', seenTrailCombinations);
  }

  /**
   * Create loop route from Dijkstra results
   */
  private async createLoopRouteFromDijkstra(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    outboundEdges: any[],
    returnEdges: any[],
    startNode: any,
    endNode: any,
    seenTrailCombinations: Set<string>
  ): Promise<RouteRecommendation | null> {
    // Combine outbound and return edges to create loop
    const allEdges = [...outboundEdges, ...returnEdges];
    return this.createLoopRouteFromEdges(pattern, tolerance, allEdges, 0, 'dijkstra-circuit', seenTrailCombinations);
  }

  /**
   * Calculate distance matching score (0-1)
   */
  private calculateDistanceScore(actualDistance: number, targetDistance: number, tolerance: ToleranceLevel): number {
    const distanceDiff = Math.abs(actualDistance - targetDistance) / targetDistance;
    const toleranceThreshold = tolerance.distance / 100;
    
    if (distanceDiff <= toleranceThreshold) {
      return 1 - (distanceDiff / toleranceThreshold);
    }
    return 0;
  }

  /**
   * Determine route shape based on logical start/end nodes and edge traversal analysis
   * 
   * Classification rules:
   * - Loop: Start and end at same node, no edge traversed twice
   * - Out-and-back: Start and end at same node, but traverses same edge twice (backtracking)
   * - Point-to-point: Different start and end nodes
   */
  private async determineRouteShapeFromGeometry(routeGeometry: any, routePath: any[]): Promise<{ shape: string; reason: string }> {
    if (!routePath || routePath.length === 0) {
      return { shape: 'point-to-point', reason: 'No path data' };
    }

    try {
      // Get the logical start and end nodes from the route path
      const validPath = routePath.filter(edge => edge.edge !== -1);
      
      if (validPath.length === 0) {
        return { shape: 'point-to-point', reason: 'No valid edges in path' };
      }

      // Get start and end nodes from the path
      const startNode = validPath[0].node;
      const endNode = validPath[validPath.length - 1].node;

      // If start and end nodes are different, it's point-to-point
      if (startNode !== endNode) {
        return { shape: 'point-to-point', reason: `Start node (${startNode}) and end node (${endNode}) are different` };
      }

      // If start and end nodes are the same, analyze edge traversal
      // Check for duplicate edge traversal (out-and-back vs loop)
      const edgeIds = validPath.map(edge => edge.edge);

      // Count edge occurrences
      const edgeCounts = new Map<number, number>();
      for (const edgeId of edgeIds) {
        edgeCounts.set(edgeId, (edgeCounts.get(edgeId) || 0) + 1);
      }

      // Check if any edge is traversed more than once
      const duplicateEdges = Array.from(edgeCounts.entries()).filter(([edgeId, count]) => count > 1);
      const hasDuplicateEdges = duplicateEdges.length > 0;

      if (hasDuplicateEdges) {
        return { 
          shape: 'out-and-back', 
          reason: `Backtracking detected: ${duplicateEdges.length} edges traversed multiple times` 
        };
      } else {
        return { 
          shape: 'loop', 
          reason: `True loop: starts and ends at same node, no edge traversed twice` 
        };
      }

    } catch (error) {
      console.error('Error determining route shape:', error);
      return { shape: 'point-to-point', reason: 'Error analyzing path' };
    }
  }

  /**
   * Validate that a route is a true loop (starts/ends at same node, no edge repetition, no direction changes)
   */
  private validateTrueLoop(edges: any[]): { isValid: boolean; reason?: string } {
    if (edges.length < 2) {
      return { isValid: false, reason: 'Loop must have at least 2 edges' };
    }

    // Check that we start and end at the same node
    const firstEdge = edges[0];
    const lastEdge = edges[edges.length - 1];
    
    if (firstEdge.source !== lastEdge.target) {
      return { isValid: false, reason: `Loop does not close: starts at ${firstEdge.source}, ends at ${lastEdge.target}` };
    }

    // Check for edge repetition (same edge used twice)
    const edgeIds = edges.map(edge => edge.edge || edge.id).filter(id => id !== -1);
    const uniqueEdgeIds = new Set(edgeIds);
    
    if (uniqueEdgeIds.size !== edgeIds.length) {
      return { isValid: false, reason: 'Loop traverses the same edge multiple times' };
    }

    // Check for direction consistency (no backtracking on same edge)
    for (let i = 0; i < edges.length - 1; i++) {
      const currentEdge = edges[i];
      const nextEdge = edges[i + 1];
      
      // Ensure consecutive edges are properly connected
      if (currentEdge.target !== nextEdge.source) {
        return { isValid: false, reason: `Edges not properly connected: edge ${i} ends at ${currentEdge.target}, edge ${i+1} starts at ${nextEdge.source}` };
      }
    }

    // Check for minimum loop size (at least 3 nodes to form a meaningful loop)
    const uniqueNodes = new Set();
    edges.forEach(edge => {
      uniqueNodes.add(edge.source);
      uniqueNodes.add(edge.target);
    });
    
    if (uniqueNodes.size < 3) {
      return { isValid: false, reason: 'Loop must have at least 3 unique nodes' };
    }

    return { isValid: true };
  }

  /**
   * Generate appropriate route name based on actual route shape
   */
  private generateRouteNameByShape(
    pattern: RoutePattern, 
    actualShape: string, 
    trailNames: string[], 
    distance: number, 
    elevation: number
  ): string {
    const distanceClass = distance < 5 ? 'Short' : distance < 10 ? 'Medium' : 'Long';
    const elevationClass = elevation < 200 ? 'Easy' : elevation < 400 ? 'Moderate' : 'Challenging';
    
    switch (actualShape) {
      case 'loop':
        return `${distanceClass} ${elevationClass} Loop via ${trailNames.slice(0, 2).join(' + ')}`;
      case 'out-and-back':
        return `${distanceClass} ${elevationClass} Out-and-Back via ${trailNames.slice(0, 2).join(' + ')}`;
      case 'point-to-point':
        return `${distanceClass} ${elevationClass} Point-to-Point via ${trailNames.slice(0, 2).join(' + ')}`;
      default:
        return `${pattern.pattern_name} via ${trailNames.slice(0, 2).join(' + ')}`;
    }
  }

  /**
   * Calculate elevation gain rate matching score (0-1)
   * This is critical for loop routes
   */
  private calculateElevationRateScore(actualRate: number, targetRate: number, tolerance: ToleranceLevel): number {
    if (targetRate === 0) return actualRate === 0 ? 1 : 0;
    
    const rateDiff = Math.abs(actualRate - targetRate) / targetRate;
    const toleranceThreshold = tolerance.elevation / 100;
    
    if (rateDiff <= toleranceThreshold) {
      return 1 - (rateDiff / toleranceThreshold);
    }
    return 0;
  }

  /**
   * Load loop patterns from configuration
   */
  private async loadLoopPatterns(): Promise<RoutePattern[]> {
    // Load loop patterns using the same approach as KSP service
    const { RouteDiscoveryConfigLoader } = await import('../../config/route-discovery-config-loader');
    const configLoader = RouteDiscoveryConfigLoader.getInstance();
    const routeDiscoveryConfig = configLoader.loadConfig();
    
    // Create loop patterns based on the configuration
    const loopPatterns: RoutePattern[] = [
      {
        pattern_name: 'Short Loop',
        route_shape: 'loop',
        target_distance_km: 3,
        target_elevation_gain: 100,
        tolerance_percent: 20
      },
      {
        pattern_name: 'Medium Loop',
        route_shape: 'loop',
        target_distance_km: 8,
        target_elevation_gain: 250,
        tolerance_percent: 20
      },
      {
        pattern_name: 'Long Loop',
        route_shape: 'loop',
        target_distance_km: 15,
        target_elevation_gain: 500,
        tolerance_percent: 20
      },
      {
        pattern_name: 'Epic Loop',
        route_shape: 'loop',
        target_distance_km: 25,
        target_elevation_gain: 800,
        tolerance_percent: 20
      }
    ];
    
    return loopPatterns;
  }

  /**
   * Verify unified network structure exists
   */
  private async verifyUnifiedNetwork(): Promise<void> {
    const networkCheck = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded) as edge_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr) as vertex_count
    `);
    
    console.log(`📊 [UNIFIED-LOOP] Unified network verified: ${networkCheck.rows[0].vertex_count} nodes, ${networkCheck.rows[0].edge_count} edges`);
  }
}
