import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RoutePatternSqlHelpers } from '../sql/route-pattern-sql-helpers';
import { RouteGenerationBusinessLogic, ToleranceLevel, UsedArea } from '../business/route-generation-business-logic';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';
import * as fs from 'fs';
import * as path from 'path';

export interface KspRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
  useTrailheadsOnly?: boolean; // Use only trailhead nodes for route generation (alias for trailheads.enabled)
  trailheadLocations?: Array<{name?: string, lat: number, lng: number, tolerance_meters?: number}>; // Trailhead coordinate locations
}

export class KspRouteGeneratorService {
  private sqlHelpers: RoutePatternSqlHelpers;
  private constituentAnalysisService: ConstituentTrailAnalysisService;
  private generatedTrailCombinations: Set<string> = new Set(); // Track unique trail combinations
  private generatedEndpointCombinations: Map<string, number> = new Map(); // Track endpoint combinations with their longest route distance
  private generatedIdenticalRoutes: Set<string> = new Set(); // Track truly identical routes (same edge sequence)
  private configLoader: RouteDiscoveryConfigLoader;
  private logFile: string;

  constructor(
    private pgClient: Pool,
    private config: KspRouteGeneratorConfig
  ) {
    this.sqlHelpers = new RoutePatternSqlHelpers(pgClient);
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    
    // Create log file path - use single consistent filename
    this.logFile = path.join(process.cwd(), 'logs', 'route-generation.log');
    
    // Ensure logs directory exists
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  /**
   * Log message to both console and file
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    // Write to console
    console.log(message);
    
    // Write to file
    try {
      fs.appendFileSync(this.logFile, logMessage + '\n');
    } catch (error) {
      console.warn(`⚠️ Failed to write to log file ${this.logFile}:`, error);
    }
  }

  /**
   * Generate KSP routes for all patterns
   */
  async generateKspRoutes(): Promise<RouteRecommendation[]> {
    this.log('[RECOMMENDATIONS] 🎯 Generating KSP routes...');
    
    const patterns = await this.sqlHelpers.loadOutAndBackPatterns();
    const allRecommendations: RouteRecommendation[] = [];
    
    this.log(`[RECOMMENDATIONS] 📊 ROUTE GENERATION SUMMARY:`);
    this.log(`[RECOMMENDATIONS]    - Total patterns to process: ${patterns.length}`);
    this.log(`[RECOMMENDATIONS]    - Target routes per pattern: ${this.config.targetRoutesPerPattern}`);
    this.log(`[RECOMMENDATIONS]    - KSP K value: ${this.config.kspKValue}`);
    this.log(`[RECOMMENDATIONS]    - Use trailheads only: ${this.config.useTrailheadsOnly}`);
    
    // Track all unique routes across all patterns to prevent duplicates
    const allGeneratedTrailCombinations = new Set<string>();
    
    for (const pattern of patterns) {
      this.log(`[RECOMMENDATIONS] \n🎯 Processing out-and-back pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      // Reset endpoint tracking for each pattern to allow different patterns to use same endpoints
      this.resetEndpointTracking();
      
      // Generate routes specifically for this pattern's distance/elevation targets
      const patternRoutes = await this.generateRoutesForPattern(pattern, allGeneratedTrailCombinations);
      
      // Add all routes from this pattern (don't limit per pattern, let them accumulate)
      allRecommendations.push(...patternRoutes);
      this.log(`[RECOMMENDATIONS] ✅ Generated ${patternRoutes.length} out-and-back routes for ${pattern.pattern_name}`);
      
      // Log route details for this pattern
      patternRoutes.forEach((route, index) => {
        this.log(`[RECOMMENDATIONS]    ${index + 1}. ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m, score: ${route.route_score})`);
      });
    }

    this.log(`[RECOMMENDATIONS] \n📊 FINAL ROUTE GENERATION SUMMARY:`);
    this.log(`[RECOMMENDATIONS]    - Total routes generated: ${allRecommendations.length}`);
    this.log(`[RECOMMENDATIONS]    - Routes by pattern:`);
    const routesByPattern = allRecommendations.reduce((acc, route) => {
      const patternName = route.route_name.split(' - ')[0] || 'Unknown';
      acc[patternName] = (acc[patternName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(routesByPattern).forEach(([pattern, count]) => {
      this.log(`[RECOMMENDATIONS]      - ${pattern}: ${count} routes`);
    });

    return allRecommendations;
  }

  /**
   * Reset endpoint tracking for new pattern
   */
  private resetEndpointTracking(): void {
    this.generatedEndpointCombinations.clear();
    this.log('[RECOMMENDATIONS] 🔄 Reset endpoint tracking for new pattern');
  }

  /**
   * Generate routes for a specific pattern
   */
  private async generateRoutesForPattern(pattern: RoutePattern, allGeneratedTrailCombinations?: Set<string>): Promise<RouteRecommendation[]> {
    const { halfTargetDistance, halfTargetElevation } = RouteGenerationBusinessLogic.calculateTargetMetrics(pattern);
    
    this.log(`[RECOMMENDATIONS] 📏 Targeting half-distance: ${halfTargetDistance.toFixed(1)}km, half-elevation: ${halfTargetElevation.toFixed(0)}m`);
    
    // Load trailhead configuration from YAML
    const routeDiscoveryConfig = this.configLoader.loadConfig();
    const trailheadConfig = routeDiscoveryConfig.trailheads;
    
    // Determine if we should use trailheads based on config
    // If CLI explicitly sets useTrailheadsOnly, use that value; otherwise fall back to YAML config
    const shouldUseTrailheads = this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled;
    
    this.log(`[RECOMMENDATIONS] 🔍 Trailhead usage: useTrailheadsOnly=${this.config.useTrailheadsOnly}, config.enabled=${trailheadConfig.enabled}, shouldUseTrailheads=${shouldUseTrailheads}`);
    
    // Get network entry points (trailheads or default)
    this.log(`[RECOMMENDATIONS] 🔍 Finding network entry points...`);
    const nodesResult = await this.sqlHelpers.getNetworkEntryPoints(
      this.config.stagingSchema,
      shouldUseTrailheads,
      trailheadConfig.maxTrailheads,
      this.config.trailheadLocations
    );
    
    this.log(`[RECOMMENDATIONS] 📍 Found ${nodesResult.length} network entry points`);
    if (this.config.trailheadLocations && this.config.trailheadLocations.length > 0) {
      this.log(`[RECOMMENDATIONS]    - Trailhead locations configured: ${this.config.trailheadLocations.length}`);
      this.config.trailheadLocations.forEach((th, index) => {
        this.log(`[RECOMMENDATIONS]      ${index + 1}. ${th.name || `Trailhead ${index + 1}`}: (${th.lat}, ${th.lng}) ±${th.tolerance_meters || 50}m`);
      });
    }
    
    if (nodesResult.length < 2) {
      this.log('[RECOMMENDATIONS] ⚠️ Not enough nodes for routing');
      return [];
    }

    const patternRoutes: RouteRecommendation[] = [];
    const usedAreas: UsedArea[] = [];
    const toleranceLevels = RouteGenerationBusinessLogic.getToleranceLevels(pattern);
    
    this.log(`[RECOMMENDATIONS] 🔍 Will try ${toleranceLevels.length} tolerance levels for this pattern`);
    
    // Generate routes specifically for this pattern's targets
    // Each pattern should generate different routes that match its distance/elevation criteria
    for (const tolerance of toleranceLevels) {
      this.log(`[RECOMMENDATIONS] 🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation) for pattern "${pattern.pattern_name}"`);
      
      await this.generateRoutesWithTolerance(
        pattern, 
        tolerance, 
        nodesResult, 
        halfTargetDistance, 
        patternRoutes, 
        usedAreas,
        allGeneratedTrailCombinations
      );
      
      this.log(`[RECOMMENDATIONS] 📊 After ${tolerance.name} tolerance for "${pattern.pattern_name}": ${patternRoutes.length} routes found`);
    }
    
    this.log(`[RECOMMENDATIONS] 📊 Pattern ${pattern.pattern_name} complete: ${patternRoutes.length} total routes generated`);
    return patternRoutes;
  }

  /**
   * Generate routes with specific tolerance level
   */
  private async generateRoutesWithTolerance(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    nodesResult: any[],
    halfTargetDistance: number,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    allGeneratedTrailCombinations?: Set<string>
  ): Promise<void> {
    // Generate out-and-back routes from each node with geographic diversity
    // Use YAML configuration for max starting nodes, or all available nodes if not specified
    const maxStartingNodes = this.configLoader.loadConfig().routeGeneration?.ksp?.maxStartingNodes || nodesResult.length;
    const actualMaxStartingNodes = maxStartingNodes === -1 ? nodesResult.length : Math.min(maxStartingNodes, nodesResult.length);
    
          this.log(`🔍 Processing ${actualMaxStartingNodes} starting nodes (from ${nodesResult.length} total nodes)`);
    
    let routesFoundThisTolerance = 0;
    let nodesProcessed = 0;
    let nodesWithRoutes = 0;
    
    for (const startNode of nodesResult.slice(0, actualMaxStartingNodes)) {
      // Remove per-pattern limit to allow accumulation across all patterns
      
      nodesProcessed++;
      const nodeRoutesBefore = patternRoutes.length;
      
      await this.generateRoutesFromNode(
        pattern,
        tolerance,
        startNode.id,
        startNode.lon,
        startNode.lat,
        halfTargetDistance,
        patternRoutes,
        usedAreas,
        allGeneratedTrailCombinations
      );
      
      const nodeRoutesAfter = patternRoutes.length;
      const routesFromThisNode = nodeRoutesAfter - nodeRoutesBefore;
      
      if (routesFromThisNode > 0) {
        nodesWithRoutes++;
        routesFoundThisTolerance += routesFromThisNode;
        this.log(`  📍 Node ${startNode.id} (${startNode.lat.toFixed(4)}, ${startNode.lon.toFixed(4)}): ${routesFromThisNode} routes found`);
      }
    }
    
    this.log(`📊 ${tolerance.name} tolerance complete:`);
    this.log(`   - Nodes processed: ${nodesProcessed}/${actualMaxStartingNodes}`);
    this.log(`   - Nodes with routes: ${nodesWithRoutes}`);
    this.log(`   - Routes found this tolerance: ${routesFoundThisTolerance}`);
    this.log(`   - Total routes so far: ${patternRoutes.length}`);
  }

  /**
   * Generate routes from a specific starting node
   */
  private async generateRoutesFromNode(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    startNode: number,
    startLon: number,
    startLat: number,
    halfTargetDistance: number,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    allGeneratedTrailCombinations?: Set<string>
  ): Promise<void> {
          // Find reachable nodes within reasonable distance for this specific pattern
      // Use pattern-specific search distance to target routes that match the pattern
      const maxSearchDistance = Math.max(halfTargetDistance * 2, pattern.target_distance_km * 1.5);
      this.log(`  🔍 Finding nodes reachable within ${maxSearchDistance.toFixed(1)}km from node ${startNode} for pattern ${pattern.pattern_name}...`);
      
      const reachableNodes = await this.sqlHelpers.findReachableNodes(
        this.config.stagingSchema, 
        startNode, 
        maxSearchDistance
      );
    
    if (reachableNodes.length === 0) {
      this.log(`  ❌ No reachable nodes found from node ${startNode} within ${maxSearchDistance.toFixed(1)}km`);
      return;
    }
    
    this.log(`  ✅ Found ${reachableNodes.length} reachable nodes from node ${startNode}`);
    
          // Try each reachable node as a destination
      for (const reachableNode of reachableNodes) {
        // Remove per-pattern limit to allow more routes
      
      const endNode = reachableNode.node_id;
      const oneWayDistance = reachableNode.distance_km;
      
      this.log(`  🛤️ Trying out-and-back route: ${startNode} → ${endNode} → ${startNode} (one-way: ${oneWayDistance.toFixed(2)}km)`);
      
      await this.generateRouteBetweenNodes(
        pattern,
        tolerance,
        startNode,
        endNode,
        startLon,
        startLat,
        oneWayDistance,
        patternRoutes,
        usedAreas,
        allGeneratedTrailCombinations
      );
    }
  }

  /**
   * Generate route between two specific nodes
   */
  private async generateRouteBetweenNodes(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    startNode: number,
    endNode: number,
    startLon: number,
    startLat: number,
    oneWayDistance: number,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    allGeneratedTrailCombinations?: Set<string>
  ): Promise<void> {
    // Check if the one-way distance is reasonable for our target
    const { minDistance, maxDistance } = RouteGenerationBusinessLogic.calculateDistanceToleranceRange(
      pattern.target_distance_km / 2,
      tolerance
    );
    
    if (oneWayDistance < minDistance || oneWayDistance > maxDistance) {
      this.log(`  ❌ One-way distance ${oneWayDistance.toFixed(2)}km outside tolerance range [${minDistance.toFixed(2)}km, ${maxDistance.toFixed(2)}km]`);
      return;
    }
    
    try {
      // Use KSP to find multiple routes for the outbound journey
      const kspRows = await this.sqlHelpers.executeKspRouting(
        this.config.stagingSchema,
        startNode,
        endNode,
        this.config.kspKValue
      );
      
      this.log(`✅ KSP found ${kspRows.length} candidate routes from node ${startNode} to node ${endNode}`);
      
      // Process each KSP route
      const routeGroups = RouteGenerationBusinessLogic.groupKspRouteSteps(kspRows);
      
      for (const [pathId, routeSteps] of routeGroups) {
        // Remove per-pattern limit to allow accumulation across all patterns
        
        await this.processKspRoute(
          pattern,
          tolerance,
          pathId,
          routeSteps,
          startLon,
          startLat,
          patternRoutes,
          usedAreas,
          allGeneratedTrailCombinations
        );
      }
    } catch (error: any) {
      this.log(`❌ KSP routing failed: ${error.message}`);
    }
  }

  /**
   * Process a single KSP route
   */
  private async processKspRoute(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    pathId: number,
    routeSteps: any[],
    startLon: number,
    startLat: number,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    allGeneratedTrailCombinations?: Set<string>
  ): Promise<void> {
    this.log(`  🔍 DEBUG: Processing KSP route path ${pathId} with ${routeSteps.length} steps`);
    // Extract edge IDs from the route steps
    const edgeIds = RouteGenerationBusinessLogic.extractEdgeIds(routeSteps);
    
    if (edgeIds.length === 0) {
      this.log(`  ⚠️ No valid edges found for path ${pathId}`);
      return;
    }
    
    // Get the edges for this route with UUID mapping
    let routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
    
    if (routeEdges.length === 0) {
      this.log(`  ⚠️ No edges found for route path`);
      return;
    }
    
          // Check for truly identical routes (same exact edge sequence) - only filter exact repeats
      const identicalRouteHash = this.createExactRouteHash(routeEdges);
      if (this.generatedIdenticalRoutes.has(identicalRouteHash)) {
        this.log(`  ⏭️ Skipping truly identical route: ${identicalRouteHash}`);
        return;
      }
    
    // Optionally coalesce consecutive same-name edges for cleaner, longer segments
    const coalesceSameName = process.env.COALESCE_SAME_NAME_EDGES === '1';
    if (coalesceSameName) {
      routeEdges = this.coalesceConsecutiveSameNameEdges(routeEdges);
    }

    // Calculate route metrics for outbound journey
    const { totalDistance, totalElevationGain } = RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
    
    // For out-and-back routes, we need to reverse the edges to create the return journey
    // This ensures the route follows actual trails both ways, not straight lines
    const reversedEdges = this.createReversedEdges(routeEdges);
    const completeOutAndBackEdges = [...routeEdges, ...reversedEdges];
    
    const { outAndBackDistance, outAndBackElevation } = RouteGenerationBusinessLogic.calculateOutAndBackMetrics(
      totalDistance, 
      totalElevationGain
    );
    
    this.log(`  📏 Route metrics: ${totalDistance.toFixed(2)}km → ${outAndBackDistance.toFixed(2)}km (out-and-back), ${totalElevationGain.toFixed(0)}m → ${outAndBackElevation.toFixed(0)}m elevation`);
    
    // Check if route meets tolerance criteria
    const { distanceOk, elevationOk } = RouteGenerationBusinessLogic.meetsToleranceCriteria(
      outAndBackDistance,
      outAndBackElevation,
      pattern,
      tolerance
    );
    
    this.log(`  🔍 DEBUG: Route tolerance check - distance: ${distanceOk}, elevation: ${elevationOk}`);
    this.log(`  🔍 DEBUG: Route metrics vs target - distance: ${outAndBackDistance.toFixed(2)}km vs ${pattern.target_distance_km}km, elevation: ${outAndBackElevation.toFixed(0)}m vs ${pattern.target_elevation_gain}m`);
    
    if (distanceOk && elevationOk) {
      // Calculate quality score with improved metrics
      const finalScore = RouteGenerationBusinessLogic.calculateRouteScore(
        outAndBackDistance,
        outAndBackElevation,
        pattern,
        tolerance,
        routeEdges
      );
      
      this.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
      
      // Analyze constituent trails
      const constituentAnalysis = await this.constituentAnalysisService.analyzeRouteConstituentTrails(
        this.config.stagingSchema,
        routeEdges
      );
      
      this.log(`  🛤️ Constituent trails: ${constituentAnalysis.unique_trail_count} unique trails`);
      
      // Create route recommendation with complete out-and-back edges
      const recommendation = RouteGenerationBusinessLogic.createRouteRecommendation(
        pattern,
        pathId,
        routeSteps,
        completeOutAndBackEdges, // Use complete out-and-back edges instead of just outbound
        outAndBackDistance,
        outAndBackElevation,
        finalScore,
        this.config.region
      );
      
      // Add to results
      patternRoutes.push(recommendation);
      
      // Track this exact route to prevent truly identical routes from being added again (exact-only dedupe)
      const dedupExactOnly = process.env.DEDUP_EXACT_ONLY === '1';
      if (dedupExactOnly) {
        this.generatedIdenticalRoutes.add(identicalRouteHash);
      } else {
        // Backward-compatible behavior: still only uses exact dedupe in this version
        this.generatedIdenticalRoutes.add(identicalRouteHash);
      }
      
      this.log(`  ✅ Added route: ${recommendation.route_name} (${outAndBackDistance.toFixed(2)}km, ${outAndBackElevation.toFixed(0)}m, score: ${finalScore.toFixed(1)})`);
    } else {
      this.log(`  ❌ Route does not meet tolerance criteria`);
    }
  }

  /**
   * Merge consecutive edges that share the same trail name and are contiguous.
   * Does not modify database; only affects the route_edges payload for recommendations.
   */
  private coalesceConsecutiveSameNameEdges(routeEdges: any[]): any[] {
    if (!routeEdges || routeEdges.length === 0) return routeEdges;

    const merged: any[] = [];
    for (const edge of routeEdges) {
      const last = merged[merged.length - 1];
      const sameName = last && (last.trail_name || last.name) === (edge.trail_name || edge.name);
      const contiguous = last && last.target != null && edge.source != null && last.target === edge.source;
      if (sameName && contiguous) {
        // Merge metrics and keep geometry of the combined segment as the latest edge's geom for simplicity
        last.length_km = (last.length_km || 0) + (edge.length_km || 0);
        last.elevation_gain = (last.elevation_gain || 0) + (edge.elevation_gain || 0);
        last.elevation_loss = (last.elevation_loss || 0) + (edge.elevation_loss || 0);
        last.target = edge.target;
        if (!last.merged_ids) last.merged_ids = [last.id];
        last.merged_ids.push(edge.id);
      } else {
        merged.push({ ...edge });
      }
    }
    return merged;
  }

  /**
   * Create a unique hash for a trail combination to prevent duplicates
   */
  private createTrailCombinationHash(routeEdges: any[]): string {
    // Sort trail IDs to ensure consistent hash regardless of order
    const trailIds = routeEdges
      .map(edge => edge.trail_id || edge.trail_uuid)
      .filter(id => id) // Remove null/undefined
      .sort();
    
    // Create a hash from the sorted trail IDs
    return trailIds.join('|');
  }

  /**
   * Create a unique hash for exact edge sequence to detect truly identical routes
   */
  private createExactRouteHash(routeEdges: any[]): string {
    // Create hash based on exact edge sequence (order matters)
    const edgeSequence = routeEdges
      .map(edge => edge.id) // Use edge ID for exact sequence
      .filter(id => id) // Remove null/undefined
      .join('|');
    
    return edgeSequence;
  }

  /**
   * Create a unique hash for an endpoint combination to prevent duplicates
   */
  private createEndpointHash(routeEdges: any[]): string {
    if (routeEdges.length === 0) {
      return '';
    }
    
    // Get the start and end nodes of the route
    const firstEdge = routeEdges[0];
    const lastEdge = routeEdges[routeEdges.length - 1];
    
    // For out-and-back routes, we need to identify the unique endpoints
    // Sort node IDs to ensure consistent hash regardless of direction
    const startNode = Math.min(firstEdge.source || firstEdge.from_node_id, firstEdge.target || firstEdge.to_node_id);
    const endNode = Math.max(lastEdge.source || lastEdge.from_node_id, lastEdge.target || lastEdge.to_node_id);
    
    return `${startNode}|${endNode}`;
  }

  /**
   * Store route recommendations in database
   */
  async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    this.log(`\n💾 Storing ${recommendations.length} route recommendations...`);
    
    for (const rec of recommendations) {
      try {
        this.log(`  📝 Storing route: ${rec.route_uuid} (${rec.route_name})`);
        await this.sqlHelpers.storeRouteRecommendation(this.config.stagingSchema, rec);
        this.log(`  ✅ Stored route: ${rec.route_uuid}`);
              } catch (error) {
          this.log(`  ❌ Failed to store route ${rec.route_uuid}: ${error}`);
          throw error;
        }
    }

    this.log(`✅ Successfully stored ${recommendations.length} route recommendations`);
  }

  /**
   * Create reversed edges for out-and-back routes
   * This ensures the return journey follows actual trails, not straight lines
   */
  private createReversedEdges(routeEdges: any[]): any[] {
    return routeEdges.map(edge => ({
      ...edge,
      source: edge.target,
      target: edge.source,
      // Reverse the geometry if it exists
      the_geom: edge.the_geom ? this.reverseGeometry(edge.the_geom) : edge.the_geom,
      // Keep other properties the same
      id: edge.id,
      app_uuid: edge.app_uuid,
      name: edge.name,
      length_km: edge.length_km,
      elevation_gain: edge.elevation_loss, // Swap elevation gain/loss for return journey
      elevation_loss: edge.elevation_gain,
      trail_name: edge.trail_name
    }));
  }

  /**
   * Reverse a WKB geometry (for out-and-back routes)
   */
  private reverseGeometry(wkbGeometry: string): string {
    // For now, return the original geometry
    // In a full implementation, we would reverse the coordinate order
    // This is a placeholder - the actual reversal should be done in PostGIS
    return wkbGeometry;
  }
} 