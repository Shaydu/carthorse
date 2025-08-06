import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RoutePatternSqlHelpers } from '../sql/route-pattern-sql-helpers';
import { RouteGenerationBusinessLogic, ToleranceLevel, UsedArea } from '../business/route-generation-business-logic';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';

export interface KspRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
}

export class KspRouteGeneratorService {
  private sqlHelpers: RoutePatternSqlHelpers;
  private constituentAnalysisService: ConstituentTrailAnalysisService;

  constructor(
    private pgClient: Pool,
    private config: KspRouteGeneratorConfig
  ) {
    this.sqlHelpers = new RoutePatternSqlHelpers(pgClient);
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
  }

  /**
   * Generate KSP routes for all patterns
   */
  async generateKspRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 Generating KSP routes...');
    
    const patterns = await this.sqlHelpers.loadOutAndBackPatterns();
    const allRecommendations: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`\n🎯 Processing out-and-back pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern);
      
      // Sort by score and take top routes
      const bestRoutes = patternRoutes
        .sort((a, b) => b.route_score - a.route_score)
        .slice(0, this.config.targetRoutesPerPattern);
      
      allRecommendations.push(...bestRoutes);
      console.log(`✅ Generated ${bestRoutes.length} out-and-back routes for ${pattern.pattern_name}`);
    }

    return allRecommendations;
  }

  /**
   * Generate routes for a specific pattern
   */
  private async generateRoutesForPattern(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    const { halfTargetDistance, halfTargetElevation } = RouteGenerationBusinessLogic.calculateTargetMetrics(pattern);
    
    console.log(`📏 Targeting half-distance: ${halfTargetDistance.toFixed(1)}km, half-elevation: ${halfTargetElevation.toFixed(0)}m`);
    
    // Get network entry points
    const nodesResult = await this.sqlHelpers.getNetworkEntryPoints(this.config.stagingSchema);
    
    if (nodesResult.length < 2) {
      console.log('⚠️ Not enough nodes for routing');
      return [];
    }

    const patternRoutes: RouteRecommendation[] = [];
    const usedAreas: UsedArea[] = [];
    const toleranceLevels = RouteGenerationBusinessLogic.getToleranceLevels(pattern);

    for (const tolerance of toleranceLevels) {
      if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
      
      console.log(`🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
      
      await this.generateRoutesWithTolerance(
        pattern, 
        tolerance, 
        nodesResult, 
        halfTargetDistance, 
        patternRoutes, 
        usedAreas
      );
    }
    
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
    usedAreas: UsedArea[]
  ): Promise<void> {
    // Generate out-and-back routes from each node with geographic diversity
    for (let i = 0; i < Math.min(nodesResult.length, 20); i++) {
      if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
      
      const startNode = nodesResult[i].id;
      const startLon = nodesResult[i].lon;
      const startLat = nodesResult[i].lat;
      
      // Check if this area is already used
      if (RouteGenerationBusinessLogic.isAreaUsed(startLon, startLat, usedAreas, this.config.minDistanceBetweenRoutes)) {
        console.log(`  ⏭️ Skipping node ${startNode} - area already used`);
        continue;
      }
      
      await this.generateRoutesFromNode(
        pattern,
        tolerance,
        startNode,
        startLon,
        startLat,
        halfTargetDistance,
        patternRoutes,
        usedAreas
      );
    }
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
    usedAreas: UsedArea[]
  ): Promise<void> {
    // Find reachable nodes within reasonable distance
    const maxSearchDistance = halfTargetDistance * 2;
    console.log(`  🔍 Finding nodes reachable within ${maxSearchDistance.toFixed(1)}km from node ${startNode}...`);
    
    const reachableNodes = await this.sqlHelpers.findReachableNodes(
      this.config.stagingSchema, 
      startNode, 
      maxSearchDistance
    );
    
    if (reachableNodes.length === 0) {
      console.log(`  ❌ No reachable nodes found from node ${startNode} within ${maxSearchDistance.toFixed(1)}km`);
      return;
    }
    
    console.log(`  ✅ Found ${reachableNodes.length} reachable nodes from node ${startNode}`);
    
    // Try each reachable node as a destination
    for (const reachableNode of reachableNodes) {
      if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
      
      const endNode = reachableNode.node_id;
      const oneWayDistance = reachableNode.distance_km;
      
      console.log(`  🛤️ Trying out-and-back route: ${startNode} → ${endNode} → ${startNode} (one-way: ${oneWayDistance.toFixed(2)}km)`);
      
      await this.generateRouteBetweenNodes(
        pattern,
        tolerance,
        startNode,
        endNode,
        startLon,
        startLat,
        oneWayDistance,
        patternRoutes,
        usedAreas
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
    usedAreas: UsedArea[]
  ): Promise<void> {
    // Check if the one-way distance is reasonable for our target
    const { minDistance, maxDistance } = RouteGenerationBusinessLogic.calculateDistanceToleranceRange(
      pattern.target_distance_km / 2,
      tolerance
    );
    
    if (oneWayDistance < minDistance || oneWayDistance > maxDistance) {
      console.log(`  ❌ One-way distance ${oneWayDistance.toFixed(2)}km outside tolerance range [${minDistance.toFixed(2)}km, ${maxDistance.toFixed(2)}km]`);
      return;
    }
    
    try {
      // Use KSP to find multiple routes for the outbound journey
      const kspRows = await this.sqlHelpers.executeKspRouting(
        this.config.stagingSchema,
        startNode,
        endNode
      );
      
      console.log(`✅ KSP found ${kspRows.length} routes`);
      
      // Process each KSP route
      const routeGroups = RouteGenerationBusinessLogic.groupKspRouteSteps(kspRows);
      
      for (const [pathId, routeSteps] of routeGroups) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
        
        await this.processKspRoute(
          pattern,
          tolerance,
          pathId,
          routeSteps,
          startLon,
          startLat,
          patternRoutes,
          usedAreas
        );
      }
    } catch (error: any) {
      console.log(`❌ KSP routing failed: ${error.message}`);
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
    usedAreas: UsedArea[]
  ): Promise<void> {
    console.log(`  🔍 DEBUG: Processing KSP route path ${pathId} with ${routeSteps.length} steps`);
    // Extract edge IDs from the route steps
    const edgeIds = RouteGenerationBusinessLogic.extractEdgeIds(routeSteps);
    
    if (edgeIds.length === 0) {
      console.log(`  ⚠️ No valid edges found for path ${pathId}`);
      return;
    }
    
    // Get the edges for this route with UUID mapping
    const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
    
    if (routeEdges.length === 0) {
      console.log(`  ⚠️ No edges found for route path`);
      return;
    }
    
    // Calculate route metrics
    const { totalDistance, totalElevationGain } = RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
    const { outAndBackDistance, outAndBackElevation } = RouteGenerationBusinessLogic.calculateOutAndBackMetrics(
      totalDistance, 
      totalElevationGain
    );
    
    console.log(`  📏 Route metrics: ${totalDistance.toFixed(2)}km → ${outAndBackDistance.toFixed(2)}km (out-and-back), ${totalElevationGain.toFixed(0)}m → ${outAndBackElevation.toFixed(0)}m elevation`);
    
    // Check if route meets tolerance criteria
    const { distanceOk, elevationOk } = RouteGenerationBusinessLogic.meetsToleranceCriteria(
      outAndBackDistance,
      outAndBackElevation,
      pattern,
      tolerance
    );
    
    console.log(`  🔍 DEBUG: Route tolerance check - distance: ${distanceOk}, elevation: ${elevationOk}`);
    console.log(`  🔍 DEBUG: Route metrics vs target - distance: ${outAndBackDistance.toFixed(2)}km vs ${pattern.target_distance_km}km, elevation: ${outAndBackElevation.toFixed(0)}m vs ${pattern.target_elevation_gain}m`);
    
    if (distanceOk && elevationOk) {
      // Calculate quality score with improved metrics
      const finalScore = RouteGenerationBusinessLogic.calculateRouteScore(
        outAndBackDistance,
        outAndBackElevation,
        pattern,
        tolerance,
        routeEdges
      );
      
      console.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
      
      // Analyze constituent trails
      const constituentAnalysis = await this.constituentAnalysisService.analyzeRouteConstituentTrails(
        this.config.stagingSchema,
        routeEdges
      );
      
      console.log(`  🛤️ Constituent trails: ${constituentAnalysis.unique_trail_count} unique trails`);
      constituentAnalysis.constituent_trails.forEach((trail, index) => {
        console.log(`    ${index + 1}. ${trail.name} (${trail.length_km.toFixed(2)}km, ${trail.elevation_gain.toFixed(0)}m)`);
      });
      
      // Create route recommendation with constituent trail data
      const recommendation = RouteGenerationBusinessLogic.createRouteRecommendation(
        pattern,
        pathId,
        routeSteps,
        routeEdges,
        outAndBackDistance,
        outAndBackElevation,
        finalScore,
        this.config.region
      );
      
      // Fix route_type to be the correct type, not the shape
      recommendation.route_type = 'similar_distance'; // KSP routes are similar distance matches
      
      // Add constituent trail analysis to the recommendation
      recommendation.constituent_trails = constituentAnalysis.constituent_trails;
      recommendation.unique_trail_count = constituentAnalysis.unique_trail_count;
      recommendation.total_trail_distance_km = constituentAnalysis.total_trail_distance_km;
      recommendation.total_trail_elevation_gain_m = constituentAnalysis.total_trail_elevation_gain_m;
      recommendation.out_and_back_distance_km = constituentAnalysis.out_and_back_distance_km;
      recommendation.out_and_back_elevation_gain_m = constituentAnalysis.out_and_back_elevation_gain_m;
      
      patternRoutes.push(recommendation);
      
      // Track this geographic area as used
      usedAreas.push({
        lon: startLon,
        lat: startLat,
        distance: outAndBackDistance
      });
      
      console.log(`  📍 Added route in area: ${startLon.toFixed(4)}, ${startLat.toFixed(4)}`);
    } else {
      console.log(`  ❌ Route doesn't meet criteria (distance: ${distanceOk}, elevation: ${elevationOk})`);
    }
  }

  /**
   * Store route recommendations in database
   */
  async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`\n💾 Storing ${recommendations.length} route recommendations...`);
    
    for (const rec of recommendations) {
      try {
        console.log(`  📝 Storing route: ${rec.route_uuid} (${rec.route_name})`);
        await this.sqlHelpers.storeRouteRecommendation(this.config.stagingSchema, rec);
        console.log(`  ✅ Stored route: ${rec.route_uuid}`);
      } catch (error) {
        console.error(`  ❌ Failed to store route ${rec.route_uuid}:`, error);
        throw error;
      }
    }

    console.log(`✅ Successfully stored ${recommendations.length} route recommendations`);
  }
} 