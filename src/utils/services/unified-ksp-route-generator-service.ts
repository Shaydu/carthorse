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
      
      await this.generateRoutesWithUnifiedNetwork(
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
   * Generate routes using unified network structure based on route shape
   */
  private async generateRoutesWithUnifiedNetwork(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>,
    allGeneratedTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      // Route generation strategy based on route shape
      if (pattern.route_shape === 'loop') {
        await this.generateLoopRoutes(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      } else if (pattern.route_shape === 'point-to-point') {
        await this.generatePointToPointRoutes(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      } else {
        // Default to out-and-back using KSP
        await this.generateOutAndBackRoutes(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      }
      
      // The route generation is now handled by the specific methods above
      // No additional processing needed here
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating routes with unified network:', error);
    }
  }

  /**
   * Get valid endpoints from unified network with auto/manual selection
   */
  private async getValidEndpoints(): Promise<any[]> {
    // Check if manual trailhead configuration is enabled
    const routeDiscoveryConfig = await this.configLoader.loadConfig();
    const trailheadConfig = routeDiscoveryConfig.trailheads;
    
    if (trailheadConfig?.enabled) {
      console.log(`[UNIFIED-KSP] Using manual trailhead configuration (${trailheadConfig.locations?.length || 0} locations)`);
      return await this.getManualTrailheadEndpoints(trailheadConfig);
    } else {
      console.log(`[UNIFIED-KSP] Using automatic endpoint selection`);
      return await this.getAutoSelectedEndpoints();
    }
  }

  /**
   * Get endpoints from manual trailhead configuration
   */
  private async getManualTrailheadEndpoints(trailheadConfig: any): Promise<any[]> {
    const locations = trailheadConfig.locations || [];
    const maxTrailheads = trailheadConfig.maxTrailheads || 50;
    
    if (locations.length === 0) {
      console.log(`[UNIFIED-KSP] No manual trailhead locations configured, falling back to auto selection`);
      return await this.getAutoSelectedEndpoints();
    }

    const trailheadNodes: any[] = [];
    
    for (const location of locations.slice(0, maxTrailheads)) {
      const tolerance = location.tolerance_meters || 50;
      
      // Find the nearest node to this coordinate location
      const nearestNode = await this.pgClient.query(`
        SELECT 
          v.id,
          'trailhead' as node_type,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          ST_Distance(
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            v.the_geom
          ) * 111000 as distance_meters
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
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
        console.log(`[UNIFIED-KSP] ✅ Found trailhead node: ID ${node.id} at ${node.lat}, ${node.lng} (distance: ${node.distance_meters.toFixed(1)}m) - ${location.name || 'unnamed'}`);
        trailheadNodes.push(node);
      } else {
        console.log(`[UNIFIED-KSP] ❌ No routing nodes found within ${tolerance}m of ${location.lat}, ${location.lng} - ${location.name || 'unnamed'}`);
      }
    }
    
    console.log(`[UNIFIED-KSP] Found ${trailheadNodes.length} trailhead nodes total`);
    return trailheadNodes.slice(0, maxTrailheads);
  }

  /**
   * Get endpoints using automatic selection (degree-1 nodes at network boundaries)
   */
  private async getAutoSelectedEndpoints(): Promise<any[]> {
    // Find degree-1 nodes at the edges of the network (network boundaries)
    const result = await this.pgClient.query(`
      WITH network_bounds AS (
        -- Calculate the bounding box of the entire network
        SELECT ST_Envelope(ST_Collect(the_geom)) as bounds
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt > 0
      ),
      edge_endpoints AS (
        -- Find degree-1 vertices and calculate their distance to network boundary
        SELECT 
          v.id,
          'boundary_endpoint' as node_type,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          -- Calculate distance to network boundary (closer = more edge-like)
          ST_Distance(v.the_geom, nb.bounds) as boundary_distance
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        CROSS JOIN network_bounds nb
        WHERE v.cnt = 1  -- Only use degree-1 vertices
      )
      SELECT 
        id,
        node_type,
        degree,
        lat,
        lng,
        boundary_distance
      FROM edge_endpoints
      ORDER BY boundary_distance ASC, id  -- Prefer nodes closer to network boundaries
      LIMIT 50  -- Limit to avoid too many combinations
    `);
    
    console.log(`[UNIFIED-KSP] Found ${result.rows.length} auto-selected boundary endpoints for routing`);
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
   * Generate out-and-back routes using KSP
   */
  private async generateOutAndBackRoutes(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      // Get valid start/end points from unified network
      const endpoints = await this.getValidEndpoints();
      
      if (endpoints.length < 2) {
        this.log(`[UNIFIED-KSP] ⚠️ Not enough endpoints (${endpoints.length}) for out-and-back routing`);
        return;
      }
      
      this.log(`[UNIFIED-KSP] 🎯 Found ${endpoints.length} valid endpoints for out-and-back routing`);

      // Use the existing KSP logic for out-and-back routes
      for (const startPoint of endpoints) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        // Find reachable nodes within target distance range
        const reachableNodes = await this.findReachableNodes(startPoint.id, pattern.target_distance_km * 0.7);

        for (const endPoint of reachableNodes) {
          if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

          // Generate KSP routes between start and end points
          const kspRoutes = await this.generateKspRoutesBetweenNodes(
            startPoint.id,
            endPoint.node_id,
            pattern,
            tolerance
          );

          for (const route of kspRoutes) {
            if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

            // Check for duplicate trail combinations
            const trailKey = route.constituent_trails?.sort().join('|') || '';
            if (seenTrailCombinations.has(trailKey)) {
              continue;
            }

            // Check for similarity with existing routes
            if (this.isRouteTooSimilar(route, patternRoutes)) {
              continue;
            }

            patternRoutes.push(route);
            seenTrailCombinations.add(trailKey);
            this.log(`✅ [UNIFIED-KSP] Added out-and-back route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
          }
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating out-and-back routes:', error);
    }
  }

  /**
   * Generate point-to-point routes using Dijkstra
   */
  private async generatePointToPointRoutes(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      // Get valid start/end points from unified network
      const endpoints = await this.getValidEndpoints();
      
      if (endpoints.length < 2) {
        this.log(`[UNIFIED-KSP] ⚠️ Not enough endpoints (${endpoints.length}) for point-to-point routing`);
        return;
      }
      
      this.log(`[UNIFIED-KSP] 🎯 Found ${endpoints.length} valid endpoints for point-to-point routing`);

      // Generate point-to-point routes between different endpoints
      for (let i = 0; i < endpoints.length; i++) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        for (let j = i + 1; j < endpoints.length; j++) {
          if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

          const startPoint = endpoints[i];
          const endPoint = endpoints[j];

          // Generate single shortest path between points
          const route = await this.generatePointToPointRoute(
            startPoint.id,
            endPoint.id,
            pattern,
            tolerance
          );

          if (route) {
            // Check for duplicate trail combinations
            const trailKey = route.constituent_trails?.sort().join('|') || '';
            if (seenTrailCombinations.has(trailKey)) {
              continue;
            }

            // Check for similarity with existing routes
            if (this.isRouteTooSimilar(route, patternRoutes)) {
              continue;
            }

            patternRoutes.push(route);
            seenTrailCombinations.add(trailKey);
            this.log(`✅ [UNIFIED-KSP] Added point-to-point route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
          }
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating point-to-point routes:', error);
    }
  }

  /**
   * Generate loop routes using Hawick Circuits
   */
  private async generateLoopRoutes(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      this.log(`[UNIFIED-KSP] 🔄 Generating loop routes with Hawick Circuits...`);
      
      const loops = await this.pgClient.query(`
        SELECT 
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
             AND cost <= 2.0
           ORDER BY id'
        )
        WHERE agg_cost >= $1 AND agg_cost <= $2
        ORDER BY agg_cost DESC
        LIMIT 50
      `, [
        pattern.target_distance_km * (1 - tolerance.distance / 100),
        pattern.target_distance_km * (1 + tolerance.distance / 100)
      ]);

      this.log(`🔍 [UNIFIED-KSP] Found ${loops.rows.length} potential loops with Hawick Circuits`);

      // Group loops by path_seq
      const loopGroups = new Map<number, any[]>();
      loops.rows.forEach(row => {
        if (!loopGroups.has(row.path_seq)) {
          loopGroups.set(row.path_seq, []);
        }
        loopGroups.get(row.path_seq)!.push(row);
      });

      for (const [pathSeq, loopEdges] of loopGroups) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        const route = await this.createRouteFromEdges(
          pattern,
          tolerance,
          loopEdges,
          pathSeq,
          'hawick-circuits',
          seenTrailCombinations
        );

        if (route) {
          patternRoutes.push(route);
          this.log(`✅ [UNIFIED-KSP] Added Hawick Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating loop routes:', error);
    }
  }

  /**
   * Generate a single point-to-point route using Dijkstra
   */
  private async generatePointToPointRoute(
    startNode: number,
    endNode: number,
    pattern: RoutePattern,
    tolerance: ToleranceLevel
  ): Promise<RouteRecommendation | null> {
    try {
      const result = await this.pgClient.query(`
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
             AND cost <= 2.0
           ORDER BY id',
          $1::bigint, $2::bigint, false
        )
        ORDER BY seq
      `, [startNode, endNode]);

      if (result.rows.length === 0) {
        return null;
      }

      return await this.createRouteFromEdges(
        pattern,
        tolerance,
        result.rows,
        0,
        'dijkstra-point-to-point',
        new Set<string>()
      );
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating point-to-point route:', error);
      return null;
    }
  }

  /**
   * Create route from edges (shared method for all route types)
   */
  private async createRouteFromEdges(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    edges: any[],
    pathSeq: number,
    algorithm: string,
    seenTrailCombinations: Set<string>
  ): Promise<RouteRecommendation | null> {
    try {
      const edgeIds = edges.map(edge => edge.edge).filter(id => id !== -1);
      if (edgeIds.length === 0) return null;

      // Get edge details with elevation data
      const edgeDetails = await this.pgClient.query(`
        SELECT 
          wn.id,
          wn.cost,
          COALESCE(w.trail_name, 'Unknown Trail') as trail_name,
          w.trail_type,
          COALESCE(w.elevation_gain, 0) as elevation_gain,
          COALESCE(w.elevation_loss, 0) as elevation_loss
        FROM ${this.config.stagingSchema}.ways_noded wn
        JOIN ${this.config.stagingSchema}.ways w ON wn.id = w.id
        WHERE wn.id = ANY($1)
      `, [edgeIds]);

      const totalDistance = edges[edges.length - 1].agg_cost;
      const totalElevation = edgeDetails.rows.reduce((sum, edge) => sum + (edge.elevation_gain || 0), 0);
      const trailNames = edgeDetails.rows.map(edge => edge.trail_name).filter(Boolean);

      // Check if route meets pattern criteria
      const distanceTolerance = pattern.target_distance_km * (tolerance.distance / 100);
      if (Math.abs(totalDistance - pattern.target_distance_km) > distanceTolerance) {
        return null;
      }

      // Check for duplicate trail combinations
      const trailKey = trailNames.sort().join('|');
      if (seenTrailCombinations.has(trailKey)) {
        return null;
      }

      // Calculate route score based on distance and elevation matching
      const distanceScore = this.calculateDistanceScore(totalDistance, pattern.target_distance_km, tolerance);
      const elevationScore = this.calculateElevationScore(totalElevation, pattern.target_elevation_gain, tolerance);
      const routeScore = (distanceScore + elevationScore) / 2;

      const route: RouteRecommendation = {
        route_uuid: `unified-${algorithm}-${Date.now()}-${pathSeq}`,
        route_name: `${pattern.pattern_name} via ${trailNames.slice(0, 2).join(' + ')}`,
        route_type: pattern.route_type,
        route_shape: pattern.route_shape,
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: totalElevation,
        route_path: edges,
        route_edges: edgeDetails.rows,
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
      console.error('❌ [UNIFIED-KSP] Error creating route from edges:', error);
      return null;
    }
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
   * Calculate elevation matching score (0-1)
   */
  private calculateElevationScore(actualElevation: number, targetElevation: number, tolerance: ToleranceLevel): number {
    if (targetElevation === 0) return actualElevation === 0 ? 1 : 0;
    
    const elevationDiff = Math.abs(actualElevation - targetElevation) / targetElevation;
    const toleranceThreshold = tolerance.elevation / 100;
    
    if (elevationDiff <= toleranceThreshold) {
      return 1 - (elevationDiff / toleranceThreshold);
    }
    return 0;
  }

  /**
   * Store route recommendations in the database
   */
  async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    console.log(`💾 [UNIFIED-KSP] Storing ${recommendations.length} route recommendations...`);
    
    try {
      for (const recommendation of recommendations) {
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid,
            region,
            input_length_km,
            input_elevation_gain,
            recommended_length_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            similarity_score,
            route_path,
            route_edges,
            route_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (route_uuid) DO UPDATE SET
            recommended_length_km = EXCLUDED.recommended_length_km,
            recommended_elevation_gain = EXCLUDED.recommended_elevation_gain,
            route_score = EXCLUDED.route_score,
            similarity_score = EXCLUDED.similarity_score,
            route_path = EXCLUDED.route_path,
            route_edges = EXCLUDED.route_edges,
            route_name = EXCLUDED.route_name
        `, [
          recommendation.route_uuid,
          recommendation.region,
          recommendation.input_length_km,
          recommendation.input_elevation_gain,
          recommendation.recommended_length_km,
          recommendation.recommended_elevation_gain,
          recommendation.route_type,
          recommendation.route_shape,
          recommendation.trail_count,
          recommendation.route_score,
          recommendation.similarity_score,
          JSON.stringify(recommendation.route_path),
          JSON.stringify(recommendation.route_edges),
          recommendation.route_name
        ]);
      }
      
      console.log(`✅ [UNIFIED-KSP] Stored ${recommendations.length} route recommendations`);
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error storing route recommendations:', error);
      throw error;
    }
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

  /**
   * Generate KSP routes with unified network - now component-aware
   */
  async generateKspRoutesWithUnifiedNetwork(): Promise<RouteRecommendation[]> {
    console.log(`[UNIFIED-KSP] 🚀 Starting component-aware KSP route generation...`);
    
    // First, identify disconnected components
    const components = await this.identifyNetworkComponents();
    console.log(`[UNIFIED-KSP] Found ${components.length} network components`);
    
    const allRoutes: RouteRecommendation[] = [];
    
    // Generate routes for each component separately
    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      console.log(`[UNIFIED-KSP] 🔗 Processing component ${i + 1}/${components.length}: ${component.nodeCount} nodes, ${component.edgeCount} edges`);
      
      const componentRoutes = await this.generateRoutesForComponent(component);
      console.log(`[UNIFIED-KSP] ✅ Component ${i + 1} generated ${componentRoutes.length} routes`);
      
      allRoutes.push(...componentRoutes);
    }
    
    console.log(`[UNIFIED-KSP] 🎉 Total routes generated: ${allRoutes.length}`);
    return allRoutes;
  }

  /**
   * Identify disconnected network components
   */
  private async identifyNetworkComponents(): Promise<any[]> {
    const componentsResult = await this.pgClient.query(`
      SELECT 
        component,
        COUNT(DISTINCT node) as node_count,
        COUNT(DISTINCT edge) as edge_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, cost FROM ${this.config.stagingSchema}.ways_noded WHERE cost > 0'
      )
      GROUP BY component
      ORDER BY node_count DESC
    `);
    
    const components: any[] = [];
    
    for (const row of componentsResult.rows) {
      // Get nodes in this component
      const componentNodesResult = await this.pgClient.query(`
        SELECT DISTINCT node as id
        FROM pgr_connectedComponents(
          'SELECT id, source, target, cost FROM ${this.config.stagingSchema}.ways_noded WHERE cost > 0'
        )
        WHERE component = $1
      `, [row.component]);
      
      const nodeIds = componentNodesResult.rows.map(n => n.id);
      
      components.push({
        componentId: row.component,
        nodeCount: parseInt(row.node_count),
        edgeCount: parseInt(row.edge_count),
        nodeIds: nodeIds
      });
    }
    
    return components;
  }

  /**
   * Generate routes for a specific network component
   */
  private async generateRoutesForComponent(component: any): Promise<RouteRecommendation[]> {
    console.log(`[UNIFIED-KSP] 🔍 Generating routes for component ${component.componentId} (${component.nodeCount} nodes)`);
    
    // Get endpoints specific to this component
    const componentEndpoints = await this.getComponentEndpoints(component);
    console.log(`[UNIFIED-KSP] Found ${componentEndpoints.length} endpoints for component ${component.componentId}`);
    
    if (componentEndpoints.length < 2) {
      console.log(`[UNIFIED-KSP] ⚠️ Component ${component.componentId} has insufficient endpoints (${componentEndpoints.length}), skipping`);
      return [];
    }
    
    // Load route patterns
    const patterns = await this.loadRoutePatterns();
    const componentRoutes: RouteRecommendation[] = [];
    
    // Generate routes for each pattern
    for (const pattern of patterns) {
      const tolerance = this.getToleranceForPattern(pattern);
      console.log(`[UNIFIED-KSP] 📋 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPatternInComponent(
        pattern, 
        tolerance, 
        component, 
        componentEndpoints
      );
      
      componentRoutes.push(...patternRoutes);
    }
    
    return componentRoutes;
  }

  /**
   * Get endpoints specific to a network component
   */
  private async getComponentEndpoints(component: any): Promise<any[]> {
    // Check if manual trailhead configuration is enabled
    const routeDiscoveryConfig = await this.configLoader.loadConfig();
    const trailheadConfig = routeDiscoveryConfig.trailheads;
    
    if (trailheadConfig?.enabled) {
      return await this.getComponentTrailheadEndpoints(component, trailheadConfig);
    } else {
      return await this.getComponentAutoEndpoints(component);
    }
  }

  /**
   * Get manual trailhead endpoints for a specific component
   */
  private async getComponentTrailheadEndpoints(component: any, trailheadConfig: any): Promise<any[]> {
    const locations = trailheadConfig.locations || [];
    const maxTrailheads = trailheadConfig.maxTrailheads || 50;
    
    if (locations.length === 0) {
      return await this.getComponentAutoEndpoints(component);
    }

    const trailheadNodes: any[] = [];
    
    for (const location of locations.slice(0, maxTrailheads)) {
      const tolerance = location.tolerance_meters || 50;
      
      // Find the nearest node to this coordinate location that's in this component
      const nearestNode = await this.pgClient.query(`
        SELECT 
          v.id,
          'trailhead' as node_type,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          ST_Distance(
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            v.the_geom
          ) * 111000 as distance_meters
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id = ANY($3)  -- Only nodes in this component
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            v.the_geom,
            $4 / 111000.0
          )
        ORDER BY distance_meters ASC
        LIMIT 1
      `, [location.lng, location.lat, component.nodeIds, tolerance]);
      
      if (nearestNode.rows.length > 0) {
        const node = nearestNode.rows[0];
        console.log(`[UNIFIED-KSP] ✅ Found component trailhead: ID ${node.id} at ${node.lat}, ${node.lng} (distance: ${node.distance_meters.toFixed(1)}m) - ${location.name || 'unnamed'}`);
        trailheadNodes.push(node);
      }
    }
    
    return trailheadNodes.slice(0, maxTrailheads);
  }

  /**
   * Get automatic endpoints for a specific component (degree-1 nodes at component boundaries)
   */
  private async getComponentAutoEndpoints(component: any): Promise<any[]> {
    // Find degree-1 nodes at the edges of this specific component
    const result = await this.pgClient.query(`
      WITH component_bounds AS (
        -- Calculate the bounding box of this specific component
        SELECT ST_Envelope(ST_Collect(the_geom)) as bounds
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE id = ANY($1)
      ),
      component_edge_endpoints AS (
        -- Find degree-1 vertices in this component and calculate their distance to component boundary
        SELECT 
          v.id,
          'boundary_endpoint' as node_type,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          -- Calculate distance to component boundary (closer = more edge-like)
          ST_Distance(v.the_geom, cb.bounds) as boundary_distance
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        CROSS JOIN component_bounds cb
        WHERE v.id = ANY($1)  -- Only nodes in this component
          AND v.cnt = 1  -- Only degree-1 vertices
      )
      SELECT 
        id,
        node_type,
        degree,
        lat,
        lng,
        boundary_distance
      FROM component_edge_endpoints
      ORDER BY boundary_distance ASC, id  -- Prefer nodes closer to component boundaries
      LIMIT 20  -- Limit per component to avoid too many combinations
    `, [component.nodeIds]);
    
    console.log(`[UNIFIED-KSP] Found ${result.rows.length} auto-selected boundary endpoints for component ${component.componentId}`);
    return result.rows;
  }

  /**
   * Generate routes for a specific pattern within a component
   */
  private async generateRoutesForPatternInComponent(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    component: any,
    componentEndpoints: any[]
  ): Promise<RouteRecommendation[]> {
    const patternRoutes: RouteRecommendation[] = [];
    const usedAreas: UsedArea[] = [];
    const seenTrailCombinations = new Set<string>();
    const allGeneratedTrailCombinations = new Set<string>();
    
    // Route generation strategy based on route shape
    if (pattern.route_shape === 'loop') {
      await this.generateLoopRoutesInComponent(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations, component);
    } else if (pattern.route_shape === 'point-to-point') {
      await this.generatePointToPointRoutesInComponent(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations, component, componentEndpoints);
    } else {
      // Default to out-and-back using KSP
      await this.generateOutAndBackRoutesInComponent(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations, component, componentEndpoints);
    }
    
    return patternRoutes;
  }

  /**
   * Generate loop routes using Hawick Circuits
   */
  private async generateLoopRoutesInComponent(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>,
    component: any
  ): Promise<void> {
    try {
      this.log(`[UNIFIED-KSP] 🔄 Generating loop routes with Hawick Circuits for component ${component.componentId}...`);
      
      const loops = await this.pgClient.query(`
        SELECT 
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
             AND cost <= 2.0
           ORDER BY id'
        )
        WHERE agg_cost >= $1 AND agg_cost <= $2
        ORDER BY agg_cost DESC
        LIMIT 50
      `, [
        pattern.target_distance_km * (1 - tolerance.distance / 100),
        pattern.target_distance_km * (1 + tolerance.distance / 100)
      ]);

      this.log(`🔍 [UNIFIED-KSP] Found ${loops.rows.length} potential loops with Hawick Circuits for component ${component.componentId}`);

      // Group loops by path_seq
      const loopGroups = new Map<number, any[]>();
      loops.rows.forEach(row => {
        if (!loopGroups.has(row.path_seq)) {
          loopGroups.set(row.path_seq, []);
        }
        loopGroups.get(row.path_seq)!.push(row);
      });

      for (const [pathSeq, loopEdges] of loopGroups) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        const route = await this.createRouteFromEdges(
          pattern,
          tolerance,
          loopEdges,
          pathSeq,
          'hawick-circuits',
          seenTrailCombinations
        );

        if (route) {
          patternRoutes.push(route);
          this.log(`✅ [UNIFIED-KSP] Added Hawick Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating loop routes:', error);
    }
  }

  /**
   * Generate point-to-point routes using Dijkstra
   */
  private async generatePointToPointRoutesInComponent(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>,
    component: any,
    componentEndpoints: any[]
  ): Promise<void> {
    try {
      this.log(`[UNIFIED-KSP] 📏 Generating point-to-point routes for component ${component.componentId}...`);
      
      // Generate point-to-point routes between different endpoints
      for (let i = 0; i < componentEndpoints.length; i++) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        for (let j = i + 1; j < componentEndpoints.length; j++) {
          if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

          const startPoint = componentEndpoints[i];
          const endPoint = componentEndpoints[j];

          // Generate single shortest path between points
          const route = await this.generatePointToPointRoute(
            startPoint.id,
            endPoint.id,
            pattern,
            tolerance
          );

          if (route) {
            // Check for duplicate trail combinations
            const trailKey = route.constituent_trails?.sort().join('|') || '';
            if (seenTrailCombinations.has(trailKey)) {
              continue;
            }

            // Check for similarity with existing routes
            if (this.isRouteTooSimilar(route, patternRoutes)) {
              continue;
            }

            patternRoutes.push(route);
            seenTrailCombinations.add(trailKey);
            this.log(`✅ [UNIFIED-KSP] Added point-to-point route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
          }
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating point-to-point routes:', error);
    }
  }

  /**
   * Generate out-and-back routes using KSP
   */
  private async generateOutAndBackRoutesInComponent(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: UsedArea[],
    seenTrailCombinations: Set<string>,
    component: any,
    componentEndpoints: any[]
  ): Promise<void> {
    try {
      this.log(`[UNIFIED-KSP] 📏 Generating out-and-back routes for component ${component.componentId}...`);
      
      // Use the existing KSP logic for out-and-back routes
      for (const startPoint of componentEndpoints) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        // Find reachable nodes within target distance range
        const reachableNodes = await this.findReachableNodes(startPoint.id, pattern.target_distance_km * 0.7);

        for (const endPoint of reachableNodes) {
          if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

          // Generate KSP routes between start and end points
          const kspRoutes = await this.generateKspRoutesBetweenNodes(
            startPoint.id,
            endPoint.node_id,
            pattern,
            tolerance
          );

          for (const route of kspRoutes) {
            if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

            // Check for duplicate trail combinations
            const trailKey = route.constituent_trails?.sort().join('|') || '';
            if (seenTrailCombinations.has(trailKey)) {
              continue;
            }

            // Check for similarity with existing routes
            if (this.isRouteTooSimilar(route, patternRoutes)) {
              continue;
            }

            patternRoutes.push(route);
            seenTrailCombinations.add(trailKey);
            this.log(`✅ [UNIFIED-KSP] Added out-and-back route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
          }
        }
      }
    } catch (error) {
      console.error('❌ [UNIFIED-KSP] Error generating out-and-back routes:', error);
    }
  }

  /**
   * Load route patterns from the database
   */
  private async loadRoutePatterns(): Promise<RoutePattern[]> {
    return this.sqlHelpers.loadOutAndBackPatterns();
  }

  /**
   * Get tolerance level for a specific pattern
   */
  private getToleranceForPattern(pattern: RoutePattern): ToleranceLevel {
    return RouteGenerationBusinessLogic.getToleranceLevels(pattern)[0]; // Default to first tolerance level
  }
}
