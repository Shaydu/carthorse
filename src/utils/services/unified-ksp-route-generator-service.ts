import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RoutePatternSqlHelpers } from '../sql/route-pattern-sql-helpers';
import { RouteGenerationBusinessLogic, ToleranceLevel, UsedArea } from '../business/route-generation-business-logic';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';
import * as fs from 'fs';
import * as path from 'path';

export interface UnifiedKspRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
  useTrailheadsOnly?: boolean;
  trailheadLocations?: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>;
}

export class UnifiedKspRouteGeneratorService {
  private sqlHelpers: RoutePatternSqlHelpers;
  private constituentAnalysisService: ConstituentTrailAnalysisService;
  private generatedTrailCombinations: Set<string> = new Set();
  private generatedEndpointCombinations: Map<string, number> = new Map();
  private generatedIdenticalRoutes: Set<string> = new Set();
  private configLoader: RouteDiscoveryConfigLoader;
  private logFile: string;

  constructor(
    private pgClient: Pool,
    private config: UnifiedKspRouteGeneratorConfig
  ) {
    this.sqlHelpers = new RoutePatternSqlHelpers(pgClient);
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    
    this.logFile = path.join(process.cwd(), 'logs', 'unified-route-generation.log');
    
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(message);
    try {
      fs.appendFileSync(this.logFile, logMessage + '\n');
    } catch (error) {
      console.warn(`⚠️ Failed to write to log file ${this.logFile}:`, error);
    }
  }

  /**
   * Generate KSP routes using unified network structure
   */
  async generateKspRoutes(): Promise<RouteRecommendation[]> {
    this.log('[UNIFIED-KSP] 🎯 Generating KSP routes with unified network...');
    
    // Verify unified network exists
    await this.verifyUnifiedNetwork();
    
    const patterns = await this.sqlHelpers.loadOutAndBackPatterns();
    const allRecommendations: RouteRecommendation[] = [];
    
    this.log(`[UNIFIED-KSP] 📊 ROUTE GENERATION SUMMARY:`);
    this.log(`[UNIFIED-KSP]    - Total patterns to process: ${patterns.length}`);
    this.log(`[UNIFIED-KSP]    - Target routes per pattern: ${this.config.targetRoutesPerPattern}`);
    this.log(`[UNIFIED-KSP]    - KSP K value: ${this.config.kspKValue}`);
    this.log(`[UNIFIED-KSP]    - Use trailheads only: ${this.config.useTrailheadsOnly}`);
    
    const allGeneratedTrailCombinations = new Set<string>();
    
    for (const pattern of patterns) {
      this.log(`[UNIFIED-KSP] \n🎯 Processing out-and-back pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      this.resetEndpointTracking();
      
      const patternRoutes = await this.generateRoutesForPattern(pattern, allGeneratedTrailCombinations);
      
      allRecommendations.push(...patternRoutes);
      this.log(`[UNIFIED-KSP] ✅ Generated ${patternRoutes.length} out-and-back routes for ${pattern.pattern_name}`);
      
      patternRoutes.forEach((route, index) => {
        this.log(`[UNIFIED-KSP]    ${index + 1}. ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, +${route.recommended_elevation_gain.toFixed(0)}m)`);
      });
    }

    return allRecommendations;
  }

  /**
   * Verify unified network structure exists
   */
  private async verifyUnifiedNetwork(): Promise<void> {
    this.log('[UNIFIED-KSP] 🔍 Verifying unified network structure...');
    
    const requiredTables = ['ways_noded', 'ways_noded_vertices_pgr', 'export_edges', 'export_nodes'];
    
    for (const table of requiredTables) {
      const exists = await this.pgClient.query(`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = $2
        )
      `, [this.config.stagingSchema, table]);
      
      if (!exists.rows[0].exists) {
        throw new Error(`❌ Required table ${this.config.stagingSchema}.${table} does not exist`);
      }
    }
    
    // Check data exists
    const nodeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const edgeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    this.log(`[UNIFIED-KSP] ✅ Unified network verified: ${nodeCount.rows[0].count} nodes, ${edgeCount.rows[0].count} edges`);
  }

  /**
   * Generate routes for a specific pattern using unified network
   */
  private async generateRoutesForPattern(
    pattern: RoutePattern, 
    allGeneratedTrailCombinations: Set<string>
  ): Promise<RouteRecommendation[]> {
    this.log(`[UNIFIED-KSP] 📏 Targeting out-and-back: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    
    const patternRoutes: RouteRecommendation[] = [];
    const usedAreas: UsedArea[] = [];
    const toleranceLevels = RouteGenerationBusinessLogic.getToleranceLevels(pattern);
    const seenTrailCombinations = new Set<string>();

    for (const tolerance of toleranceLevels) {
      if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
      
      this.log(`[UNIFIED-KSP] 🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
      
      await this.generateKspRoutesWithUnifiedNetwork(
        pattern, 
        tolerance, 
        patternRoutes, 
        usedAreas,
        seenTrailCombinations,
        allGeneratedTrailCombinations
      );
    }
    
    return patternRoutes;
  }

  /**
   * Generate KSP routes using unified network structure
   */
  private async generateKspRoutesWithUnifiedNetwork(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>,
    allGeneratedTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      // Get valid start/end points from unified network
      const endpoints = await this.getValidEndpoints();
      
      if (endpoints.length < 2) {
        this.log(`[UNIFIED-KSP] ⚠️ Not enough endpoints (${endpoints.length}) for KSP routing`);
        return;
      }
      
      this.log(`[UNIFIED-KSP] 🎯 Found ${endpoints.length} valid endpoints for KSP routing`);
      
      // Collect all potential routes first, then sort and deduplicate
      const allPotentialRoutes: RouteRecommendation[] = [];
      
      // Generate routes between endpoint pairs
      for (let i = 0; i < endpoints.length && allPotentialRoutes.length < this.config.targetRoutesPerPattern * 3; i++) {
        const startNode = endpoints[i];
        
        // Find reachable nodes within pattern distance
        const maxDistance = pattern.target_distance_km * 1.5; // Allow some flexibility
        const reachableNodes = await this.findReachableNodes(startNode.id, maxDistance);
        
        for (const reachableNode of reachableNodes) {
          if (allPotentialRoutes.length >= this.config.targetRoutesPerPattern * 3) break;
          
          const endNode = { id: reachableNode.node_id };
          const oneWayDistance = reachableNode.distance_km;
          
          this.log(`[UNIFIED-KSP] 🛤️ Trying out-and-back route: ${startNode.id} → ${endNode.id} → ${startNode.id} (one-way: ${oneWayDistance.toFixed(2)}km)`);
          
          const routes = await this.generateKspRoutesBetweenNodes(
            pattern,
            tolerance,
            startNode,
            endNode
          );
          
          allPotentialRoutes.push(...routes);
        }
      }
      
      // Sort routes by length (longer routes first) and then by score
      allPotentialRoutes.sort((a, b) => {
        // Primary sort: by length (longer first)
        const lengthDiff = b.recommended_length_km - a.recommended_length_km;
        if (Math.abs(lengthDiff) > 0.1) { // 100m threshold
          return lengthDiff;
        }
        // Secondary sort: by score (higher first)
        return b.route_score - a.route_score;
      });
      
      this.log(`[UNIFIED-KSP] 📊 Generated ${allPotentialRoutes.length} potential routes, sorting by length and score`);
      
      // Apply deduplication and similarity filtering
      const finalRoutes: RouteRecommendation[] = [];
      const seenTrailCombinationsLocal = new Set<string>();
      
      for (const route of allPotentialRoutes) {
        if (finalRoutes.length >= this.config.targetRoutesPerPattern) break;
        
        // Check for exact trail combination duplicates
        const trailKey = route.constituent_trails?.sort().join('|') || '';
        if (seenTrailCombinations.has(trailKey) || allGeneratedTrailCombinations.has(trailKey) || seenTrailCombinationsLocal.has(trailKey)) {
          this.log(`[UNIFIED-KSP] ⏭️ Skipping duplicate trail combination: ${trailKey}`);
          continue;
        }
        
        // Check for similarity with existing routes (>50% overlap)
        if (this.isRouteTooSimilar(route, finalRoutes)) {
          this.log(`[UNIFIED-KSP] ⏭️ Skipping route due to high similarity: ${route.route_name}`);
          continue;
        }
        
        // Add route to final results
        finalRoutes.push(route);
        seenTrailCombinations.add(trailKey);
        allGeneratedTrailCombinations.add(trailKey);
        seenTrailCombinationsLocal.add(trailKey);
        
        this.log(`[UNIFIED-KSP] ✅ Added route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, score: ${route.route_score.toFixed(3)})`);
      }
      
      // Add final routes to pattern routes
      patternRoutes.push(...finalRoutes);
      
    } catch (error) {
      this.log(`[UNIFIED-KSP] ❌ Error generating KSP routes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get valid endpoints from unified network
   */
  private async getValidEndpoints(): Promise<any[]> {
    // Use ways_noded_vertices_pgr for endpoint selection (has correct connectivity info)
    const result = await this.pgClient.query(`
      SELECT 
        id,
        cnt as degree,
        the_geom
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE cnt >= 2  -- Only nodes with multiple connections
      ORDER BY RANDOM()
      LIMIT 50  -- Limit to avoid too many combinations
    `);
    
    return result.rows;
  }

  /**
   * Find nodes reachable from a starting node within a maximum distance
   */
  private async findReachableNodes(startNode: number, maxDistance: number): Promise<any[]> {
    const reachableNodes = await this.pgClient.query(`
      SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
      FROM pgr_dijkstra(
        'SELECT id, source, target, cost 
         FROM ${this.config.stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND cost <= 2.0  -- Prevent use of extremely long edges (>2km)
         ORDER BY id',
        $1::bigint, 
        (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE cnt > 0),
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
   * Generate KSP routes between two nodes using unified network
   */
  private async generateKspRoutesBetweenNodes(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    startNode: any,
    endNode: any
  ): Promise<RouteRecommendation[]> {
    try {
      // Use pgr_ksp with ways_noded table - explicit type casting to avoid ambiguity
      const kspResult = await this.pgClient.query(`
        SELECT 
          seq,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_ksp(
          'SELECT id::integer, source::integer, target::integer, cost::double precision, reverse_cost::double precision FROM ${this.config.stagingSchema}.ways_noded WHERE cost > 0',
          $1::integer, $2::integer, $3::integer
        )
      `, [startNode.id, endNode.id, this.config.kspKValue]);
      
      if (kspResult.rows.length === 0) {
        return [];
      }
      
      // Group by path sequence
      const paths = new Map<number, any[]>();
      kspResult.rows.forEach(row => {
        if (!paths.has(row.seq)) {
          paths.set(row.seq, []);
        }
        paths.get(row.seq)!.push(row);
      });
      
      // Process each KSP path
      const routes: RouteRecommendation[] = [];
      for (const [pathSeq, pathEdges] of paths) {
        const route = await this.createRouteFromKspPath(
          pattern,
          tolerance,
          startNode,
          endNode,
          pathEdges,
          pathSeq
        );
        
        if (route && this.isValidNewRoute(route, new Set(), new Set())) { // No need to check duplicates here, they are handled in generateKspRoutesWithUnifiedNetwork
          routes.push(route);
          this.log(`[UNIFIED-KSP] ✅ Generated route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km)`);
        }
      }
      
      return routes;
      
    } catch (error) {
      this.log(`[UNIFIED-KSP] ❌ Error generating KSP between nodes ${startNode.id}-${endNode.id}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Create route recommendation from KSP path
   */
  private async createRouteFromKspPath(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    startNode: any,
    endNode: any,
    pathEdges: any[],
    pathSeq: number
  ): Promise<RouteRecommendation | null> {
    try {
      // Calculate total cost (distance)
      const totalCost = pathEdges[pathEdges.length - 1].agg_cost;
      
      // Get edge details from ways_noded
      const edgeIds = pathEdges.map(edge => edge.edge).filter(id => id !== -1);
      
      if (edgeIds.length === 0) {
        return null;
      }
      
      const edgeDetails = await this.pgClient.query(`
        SELECT 
          wn.id,
          wn.cost,
          w.trail_name,
          w.trail_type
        FROM ${this.config.stagingSchema}.ways_noded wn
        JOIN ${this.config.stagingSchema}.ways w ON wn.id = w.id
        WHERE wn.id = ANY($1)
      `, [edgeIds]);
      
      // Calculate route metrics
      const totalDistance = totalCost;
      const totalElevation = edgeDetails.rows.reduce((sum, edge) => sum + (edge.cost || 0), 0);
      const trailNames = edgeDetails.rows.map(edge => edge.trail_name).filter(Boolean);
      
      // Check if route meets pattern criteria
      const distanceTolerance = pattern.target_distance_km * (tolerance.distance / 100);
      const elevationTolerance = pattern.target_elevation_gain * (tolerance.elevation / 100);
      
      if (Math.abs(totalDistance - pattern.target_distance_km) > distanceTolerance) {
        return null;
      }
      
      // Create route recommendation
      const route: RouteRecommendation = {
        route_uuid: `unified-ksp-${Date.now()}-${pathSeq}`,
        route_name: `${pattern.pattern_name} via ${trailNames.slice(0, 2).join(' + ')}`,
        route_type: 'out-and-back',
        route_shape: 'out-and-back',
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: totalElevation,
        route_path: pathEdges,
        route_edges: edgeDetails.rows,
        trail_count: trailNames.length,
        route_score: this.calculateRouteScore(pattern, totalDistance, totalElevation, tolerance),
        similarity_score: 0,
        region: this.config.region,
        constituent_trails: trailNames,
        unique_trail_count: new Set(trailNames).size,
        total_trail_distance_km: totalDistance,
        total_trail_elevation_gain_m: totalElevation,
        out_and_back_distance_km: totalDistance * 2,
        out_and_back_elevation_gain_m: totalElevation * 2
      };
      
      return route;
      
    } catch (error) {
      this.log(`[UNIFIED-KSP] ❌ Error creating route from KSP path: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Calculate route score based on pattern match
   */
  private calculateRouteScore(
    pattern: RoutePattern, 
    actualDistance: number, 
    actualElevation: number, 
    tolerance: ToleranceLevel
  ): number {
    const distanceDiff = Math.abs(actualDistance - pattern.target_distance_km) / pattern.target_distance_km;
    const elevationDiff = Math.abs(actualElevation - pattern.target_elevation_gain) / pattern.target_elevation_gain;
    
    const distanceScore = Math.max(0, 1 - distanceDiff);
    const elevationScore = Math.max(0, 1 - elevationDiff);
    
    return (distanceScore + elevationScore) / 2;
  }

  /**
   * Check if route is valid and new
   */
  private isValidNewRoute(
    route: RouteRecommendation,
    seenTrailCombinations: Set<string>,
    allGeneratedTrailCombinations: Set<string>
  ): boolean {
    const trailKey = route.constituent_trails?.sort().join('|') || '';
    
    if (seenTrailCombinations.has(trailKey) || allGeneratedTrailCombinations.has(trailKey)) {
      return false;
    }
    
    seenTrailCombinations.add(trailKey);
    allGeneratedTrailCombinations.add(trailKey);
    
    return true;
  }

  /**
   * Check if a new route is too similar to existing routes (>50% overlap)
   */
  private isRouteTooSimilar(newRoute: RouteRecommendation, existingRoutes: RouteRecommendation[]): boolean {
    if (existingRoutes.length === 0) {
      return false;
    }

    // Extract trail names from the new route
    const newRouteTrails = new Set(newRoute.constituent_trails || []);
    
    for (const existingRoute of existingRoutes) {
      // Extract trail names from existing route
      const existingRouteTrails = new Set(existingRoute.constituent_trails || []);
      
      // Calculate similarity as intersection over union
      const intersection = new Set([...newRouteTrails].filter(trail => existingRouteTrails.has(trail)));
      const union = new Set([...newRouteTrails, ...existingRouteTrails]);
      
      const similarity = intersection.size / union.size;
      
      if (similarity > 0.5) {
        this.log(`[UNIFIED-KSP] ⏭️ Route too similar (${(similarity * 100).toFixed(1)}% overlap) to existing route: ${existingRoute.route_name}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Reset endpoint tracking for new pattern
   */
  private resetEndpointTracking(): void {
    this.generatedEndpointCombinations.clear();
  }
}
