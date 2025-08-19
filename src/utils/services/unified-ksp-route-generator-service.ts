import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../../types/route-types';
import { RoutePatternSqlHelpers } from '../sql/route-pattern-sql-helpers';
import { RouteGenerationBusinessLogic, ToleranceLevel, UsedArea } from '../business/route-generation-business-logic';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';
import { RouteGeometryGeneratorService } from './route-geometry-generator-service';
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
  private geometryGeneratorService: RouteGeometryGeneratorService;
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
    this.geometryGeneratorService = new RouteGeometryGeneratorService(pgClient, { stagingSchema: config.stagingSchema });
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
    startNodeId: number,
    endNodeId: number,
    pattern: RoutePattern,
    tolerance: ToleranceLevel
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
      `, [startNodeId, endNodeId, this.config.kspKValue]);
      
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
          { id: startNodeId },
          { id: endNodeId },
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
      this.log(`[UNIFIED-KSP] ❌ Error generating KSP between nodes ${startNodeId}-${endNodeId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Generate a single point-to-point route using Dijkstra
   */
  private async generatePointToPointRoute(
    startNodeId: number,
    endNodeId: number,
    pattern: RoutePattern,
    tolerance: ToleranceLevel
  ): Promise<RouteRecommendation | null> {
    try {
      // Use pgr_dijkstra for single shortest path
      const dijkstraResult = await this.pgClient.query(`
        SELECT 
          seq,
          path_seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_dijkstra(
          'SELECT id::integer, source::integer, target::integer, cost::double precision, reverse_cost::double precision FROM ${this.config.stagingSchema}.ways_noded WHERE cost > 0',
          $1::integer, $2::integer, false
        )
      `, [startNodeId, endNodeId]);
      
      if (dijkstraResult.rows.length === 0) {
        return null;
      }
      
      const route = await this.createRouteFromKspPath(
        pattern,
        tolerance,
        { id: startNodeId },
        { id: endNodeId },
        dijkstraResult.rows,
        1
      );
      
      return route;
      
    } catch (error) {
      this.log(`[UNIFIED-KSP] ❌ Error generating point-to-point route between nodes ${startNodeId}-${endNodeId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
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
      
      // Generate route geometry using shared service
      const routeGeometry = await this.geometryGeneratorService.generateRouteGeometry(edgeIds, 'out-and-back');
      
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
        route_geometry: routeGeometry,
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
   * Create route from edges (shared helper for different route types)
   */
  private async createRouteFromEdges(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    edges: any[],
    pathSeq: number,
    routeType: string,
    seenTrailCombinations: Set<string>
  ): Promise<RouteRecommendation | null> {
    try {
      // Calculate total cost (distance)
      const totalCost = edges[edges.length - 1].agg_cost;
      
      // Get edge details from ways_noded
      const edgeIds = edges.map(edge => edge.edge).filter(id => id !== -1);
      
      if (edgeIds.length === 0) {
        return null;
      }
      
      const edgeDetails = await this.pgClient.query(`
        SELECT 
          wn.id,
          wn.cost,
          COALESCE(w.trail_name, 'Unknown Trail') as trail_name,
          w.trail_type
        FROM ${this.config.stagingSchema}.ways_noded wn
        JOIN ${this.config.stagingSchema}.ways w ON wn.id = w.id
        WHERE wn.id = ANY($1)
      `, [edgeIds]);
      
      // Generate route geometry using shared service with route type
      const routeGeometry = await this.geometryGeneratorService.generateRouteGeometry(edgeIds, pattern.route_shape);
      
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
      
      // Check for duplicate trail combinations
      const trailKey = trailNames.sort().join('|');
      if (seenTrailCombinations.has(trailKey)) {
        return null;
      }
      
      // Create route recommendation
      const route: RouteRecommendation = {
        route_uuid: `unified-${routeType}-${Date.now()}-${pathSeq}`,
        route_name: `${pattern.pattern_name} via ${trailNames.slice(0, 2).join(' + ')}`,
        route_type: pattern.route_shape,
        route_shape: pattern.route_shape,
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: totalElevation,
        route_path: edges,
        route_edges: edgeDetails.rows,
        route_geometry: routeGeometry,
        trail_count: trailNames.length,
        route_score: this.calculateRouteScore(pattern, totalDistance, totalElevation, tolerance),
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
      this.log(`[UNIFIED-KSP] ❌ Error creating route from edges: ${error instanceof Error ? error.message : String(error)}`);
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
            route_name,
            route_geometry
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (route_uuid) DO UPDATE SET
            recommended_length_km = EXCLUDED.recommended_length_km,
            recommended_elevation_gain = EXCLUDED.recommended_elevation_gain,
            route_score = EXCLUDED.route_score,
            similarity_score = EXCLUDED.similarity_score,
            route_path = EXCLUDED.route_path,
            route_edges = EXCLUDED.route_edges,
            route_name = EXCLUDED.route_name,
            route_geometry = EXCLUDED.route_geometry
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
          recommendation.route_name,
          recommendation.route_geometry
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
    
    // Process each component
    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      console.log(`🔗 Processing component ${i + 1}/8: ${component.nodeCount} nodes, 0 edges`);
      
      const componentRoutes = await this.generateRoutesForComponent(component.componentId, component.nodeIds);
      allRoutes.push(...componentRoutes);
    }
    
    console.log(`[UNIFIED-KSP] 🎉 Total routes generated: ${allRoutes.length}`);
    return allRoutes;
  }

  /**
   * Identify disconnected network components
   */
  private async identifyNetworkComponents(): Promise<any[]> {
    // Use pgr_connectedComponents properly with the correct SQL format
    console.log(`[UNIFIED-KSP] 🔍 Using pgr_connectedComponents for component detection...`);
    
    try {
      // First, let's verify our ways_noded table has the right structure
      const tableCheck = await this.pgClient.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'ways_noded'
        ORDER BY ordinal_position
      `, [this.config.stagingSchema]);
      
      console.log(`[UNIFIED-KSP] 🔍 ways_noded columns: ${tableCheck.rows.map(r => `${r.column_name}(${r.data_type})`).join(', ')}`);
      
      // Check if we have valid data
      const dataCheck = await this.pgClient.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN id IS NOT NULL THEN 1 END) as edges_with_id,
          COUNT(CASE WHEN source IS NOT NULL THEN 1 END) as edges_with_source,
          COUNT(CASE WHEN target IS NOT NULL THEN 1 END) as edges_with_target,
          COUNT(CASE WHEN cost > 0 THEN 1 END) as edges_with_cost
        FROM ${this.config.stagingSchema}.ways_noded
      `);
      
      const data = dataCheck.rows[0];
      console.log(`[UNIFIED-KSP] 🔍 Data check: ${data.total_edges} total, ${data.edges_with_id} with id, ${data.edges_with_source} with source, ${data.edges_with_target} with target, ${data.edges_with_cost} with cost`);
      
      if (data.edges_with_cost === 0) {
        console.log(`[UNIFIED-KSP] ⚠️ No edges with valid cost found, using simplified approach`);
        return this.createSingleComponent();
      }
      
      // Use pgr_connectedComponents with proper SQL format
      const componentsResult = await this.pgClient.query(`
        SELECT 
          component,
          COUNT(DISTINCT node) as node_count
        FROM pgr_connectedComponents(
          'SELECT id, source, target, cost FROM ${this.config.stagingSchema}.ways_noded WHERE cost > 0'
        )
        GROUP BY component
        ORDER BY node_count DESC
      `);
      
      console.log(`[UNIFIED-KSP] 🔍 pgr_connectedComponents found ${componentsResult.rows.length} components`);
      
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
          edgeCount: 0, // We'll calculate this separately if needed
          nodeIds: nodeIds
        });
      }
      
      console.log(`[UNIFIED-KSP] 🔍 Found ${components.length} network components`);
      components.forEach((comp, i) => {
        console.log(`[UNIFIED-KSP]   Component ${i + 1}: ${comp.nodeCount} nodes, ${comp.nodeIds.length} node IDs`);
      });
      
      return components;
      
    } catch (error) {
      console.log(`[UNIFIED-KSP] ⚠️ pgr_connectedComponents failed: ${error}`);
      console.log(`[UNIFIED-KSP] 🔍 Falling back to simplified component detection...`);
      return this.createSingleComponent();
    }
  }

  /**
   * Create a single component with all nodes (fallback method)
   */
  private async createSingleComponent(): Promise<any[]> {
    console.log(`[UNIFIED-KSP] 🔍 Creating single component with all nodes...`);
    
    // Get all nodes in the network
    const allNodesResult = await this.pgClient.query(`
      SELECT DISTINCT id as node_id
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      ORDER BY id
    `);
    
    const allNodeIds = allNodesResult.rows.map(row => row.node_id);
    
    if (allNodeIds.length === 0) {
      console.log(`[UNIFIED-KSP] ⚠️ No nodes found in network`);
      return [];
    }
    
    // Create a single component with all nodes
    const components = [{
      componentId: 1,
      nodeCount: allNodeIds.length,
      edgeCount: 0,
      nodeIds: allNodeIds
    }];
    
    console.log(`[UNIFIED-KSP] 🔍 Created single component with ${allNodeIds.length} nodes`);
    return components;
  }

  /**
   * Generate routes for a specific component
   */
  private async generateRoutesForComponent(componentId: number, componentNodes: number[]): Promise<RouteRecommendation[]> {
    console.log(`🔗 Processing component ${componentId}/8: ${componentNodes.length} nodes, 0 edges`);
    
    if (componentNodes.length < 2) {
      console.log(`⚠️ Component ${componentId} has insufficient nodes (${componentNodes.length}), skipping`);
      return [];
    }

    console.log(`🔍 Generating routes for component ${componentId} (${componentNodes.length} nodes)`);
    
    // Use the new endpoint detection method
    const endpoints = await this.findEndpoints(componentNodes);
    
    if (endpoints.length < 2) {
      console.log(`⚠️ Component ${componentId} has insufficient endpoints (${endpoints.length}), skipping`);
      return [];
    }

    console.log(`🎯 Found ${endpoints.length} endpoints for component ${componentId}`);
    console.log(`📍 Endpoint types:`, endpoints.map(e => `degree-${e.degree}-${e.node_type}`).join(', '));

    const componentRoutes: RouteRecommendation[] = [];
    
    // Generate routes for each out-and-back pattern
    const outAndBackPatterns = await this.getOutAndBackPatterns();
    
    for (const pattern of outAndBackPatterns) {
      console.log(`🎯 Processing out-and-back pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      // For out-and-back routes, we target half the distance since we'll double it
      const halfTargetDistance = pattern.target_distance_km / 2;
      const halfTargetElevation = pattern.target_elevation_gain / 2;
      
      console.log(`📏 Targeting half-distance: ${halfTargetDistance.toFixed(1)}km, half-elevation: ${halfTargetElevation.toFixed(0)}m`);
      
      // Generate routes from each endpoint
      for (const startEndpoint of endpoints.slice(0, 10)) { // Limit to first 10 endpoints
        const endpointRoutes = await this.generateRoutesFromEndpoint(
          pattern,
          startEndpoint,
          halfTargetDistance,
          endpoints.slice(0, 20) // Use first 20 endpoints as potential destinations
        );
        
        componentRoutes.push(...endpointRoutes);
        
        if (componentRoutes.length >= 50) { // Limit total routes per component
          break;
        }
      }
      
      if (componentRoutes.length >= 50) {
        break;
      }
    }

    console.log(`✅ Component ${componentId} generated ${componentRoutes.length} routes`);
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
   * Get automatic endpoints using middle-out scanning
   * Starts from component center and expands outward until finding degree-1 nodes
   */
  private async getComponentAutoEndpoints(component: any): Promise<any[]> {
    console.log(`[UNIFIED-KSP] 🔍 Starting middle-out scan for component ${component.componentId}`);
    
    // First, find the center point of this component
    const centerResult = await this.pgClient.query(`
      SELECT 
        ST_X(ST_Centroid(ST_Collect(the_geom))) as center_lng,
        ST_Y(ST_Centroid(ST_Collect(the_geom))) as center_lat
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE id = ANY($1)
    `, [component.nodeIds]);
    
    if (centerResult.rows.length === 0) {
      console.log(`[UNIFIED-KSP] ⚠️ No center point found for component ${component.componentId}`);
      return [];
    }
    
    const center = centerResult.rows[0];
    console.log(`[UNIFIED-KSP] Component ${component.componentId} center: [${center.center_lng}, ${center.center_lat}]`);
    
    // Calculate the maximum distance from center to any node in the component
    const maxDistanceResult = await this.pgClient.query(`
      SELECT MAX(ST_Distance(
        the_geom, 
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      )) as max_distance
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE id = ANY($3)
    `, [center.center_lng, center.center_lat, component.nodeIds]);
    
    const maxDistance = maxDistanceResult.rows[0].max_distance;
    console.log(`[UNIFIED-KSP] Maximum distance from center: ${maxDistance.toFixed(6)}°`);
    
    // Start from center and expand outward in rings
    const scanSteps = 15; // Number of concentric rings to check
    const stepSize = maxDistance / scanSteps; // Distance between rings
    
    console.log(`[UNIFIED-KSP] Scanning ${scanSteps} rings with ${stepSize.toFixed(6)}° step size`);
    
    const foundEndpoints: any[] = [];
    const centerPoint = `ST_SetSRID(ST_MakePoint(${center.center_lng}, ${center.center_lat}), 4326)`;
    
    // Scan from center outward
    for (let step = 0; step < scanSteps; step++) {
      const innerRadius = step * stepSize;
      const outerRadius = (step + 1) * stepSize;
      
      // Find nodes in this ring
      const ringResult = await this.pgClient.query(`
        SELECT 
          v.id,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          ST_Distance(v.the_geom, ${centerPoint}) as distance_from_center
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id = ANY($1)  -- Only nodes in this component
          AND ST_Distance(v.the_geom, ${centerPoint}) >= $2  -- At least this far from center
          AND ST_Distance(v.the_geom, ${centerPoint}) < $3   -- Less than this far from center
        ORDER BY v.cnt ASC, ST_Distance(v.the_geom, ${centerPoint}) DESC  -- Prefer degree-1 nodes, then furthest from center
        LIMIT 10  -- Limit per ring to avoid too many combinations
      `, [component.nodeIds, innerRadius, outerRadius]);
      
      console.log(`[UNIFIED-KSP] Ring ${step + 1} (${innerRadius.toFixed(6)}° - ${outerRadius.toFixed(6)}°): Found ${ringResult.rows.length} nodes`);
      
      // Add degree-1 nodes from this ring (these are our preferred endpoints)
      const degree1Nodes = ringResult.rows.filter(node => node.degree === 1);
      if (degree1Nodes.length > 0) {
        console.log(`[UNIFIED-KSP] ✅ Found ${degree1Nodes.length} degree-1 nodes in ring ${step + 1}`);
        foundEndpoints.push(...degree1Nodes.map(node => ({
          ...node,
          node_type: 'boundary_endpoint',
          boundary_distance: node.distance_from_center
        })));
        
        // If we found enough degree-1 nodes, we can stop scanning
        if (foundEndpoints.length >= 10) {
          console.log(`[UNIFIED-KSP] 🎯 Found sufficient degree-1 endpoints (${foundEndpoints.length}), stopping scan`);
          break;
        }
      }
    }
    
    // If we didn't find enough endpoints, look for more nodes at the outer rings
    if (foundEndpoints.length < 8) {
      console.log(`[UNIFIED-KSP] ⚠️ Only found ${foundEndpoints.length} endpoints, scanning outer rings for additional nodes`);
      
      // Look in the outer 50% of the component for additional nodes
      const outerRadius = maxDistance * 0.5;
      
      const additionalResult = await this.pgClient.query(`
        SELECT 
          v.id,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          ST_Distance(v.the_geom, ${centerPoint}) as distance_from_center
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id = ANY($1)  -- Only nodes in this component
          AND v.cnt IN (1, 2, 3)  -- Degree 1, 2, or 3 nodes
          AND ST_Distance(v.the_geom, ${centerPoint}) >= $2  -- In outer 50% of component
        ORDER BY v.cnt ASC, ST_Distance(v.the_geom, ${centerPoint}) DESC  -- Prefer lower degree, then furthest from center
        LIMIT 15
      `, [component.nodeIds, outerRadius]);
      
      const additionalNodes = additionalResult.rows.map(node => ({
        ...node,
        node_type: node.cnt === 1 ? 'boundary_endpoint' : node.cnt === 2 ? 'intersection_endpoint' : 'major_intersection',
        boundary_distance: node.distance_from_center
      }));
      
      console.log(`[UNIFIED-KSP] Found ${additionalNodes.length} additional nodes in outer rings`);
      foundEndpoints.push(...additionalNodes);
    }
    
    // Final fallback: if still not enough, use any nodes with degree >= 1
    if (foundEndpoints.length < 5) {
      console.log(`[UNIFIED-KSP] ⚠️ Still insufficient endpoints (${foundEndpoints.length}), using any nodes with degree >= 1`);
      
      const fallbackResult = await this.pgClient.query(`
        SELECT 
          v.id,
          v.cnt as degree,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          ST_Distance(v.the_geom, ${centerPoint}) as distance_from_center
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id = ANY($1)  -- Only nodes in this component
          AND v.cnt >= 1  -- Any nodes with at least one connection
        ORDER BY v.cnt ASC, ST_Distance(v.the_geom, ${centerPoint}) DESC  -- Prefer lower degree nodes, then furthest from center
        LIMIT 15
      `, [component.nodeIds]);
      
      const fallbackNodes = fallbackResult.rows.map(node => ({
        ...node,
        node_type: node.cnt === 1 ? 'boundary_endpoint' : node.cnt === 2 ? 'intersection_endpoint' : 'major_intersection',
        boundary_distance: node.distance_from_center
      }));
      
      console.log(`[UNIFIED-KSP] Found ${fallbackNodes.length} fallback nodes`);
      foundEndpoints.push(...fallbackNodes);
    }
    
    console.log(`[UNIFIED-KSP] 🎯 Total endpoints found for component ${component.componentId}: ${foundEndpoints.length}`);
    console.log(`[UNIFIED-KSP] Endpoint types: ${JSON.stringify(foundEndpoints.reduce((acc, ep) => {
      acc[ep.node_type] = (acc[ep.node_type] || 0) + 1;
      return acc;
    }, {}))}`);
    
    return foundEndpoints.slice(0, 10); // Limit to 10 endpoints per component
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

  /**
   * Find endpoints for route generation
   * Endpoints are typically degree-1 nodes (dead ends) or intersection nodes
   */
  private async findEndpoints(componentNodes: number[]): Promise<any[]> {
    if (componentNodes.length === 0) {
      return [];
    }

    console.log(`🔍 Finding endpoints for component with ${componentNodes.length} nodes`);

    // Query to find endpoints - join node_mapping with ways_noded_vertices_pgr to get coordinates
    const endpointQuery = `
      SELECT 
        nm.pg_id as id,
        ST_X(v.the_geom) as lon,
        ST_Y(v.the_geom) as lat,
        nm.connection_count as degree,
        nm.node_type,
        nm.connection_count
      FROM ${this.config.stagingSchema}.node_mapping nm
      JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.pg_id = ANY($1)
        AND (nm.connection_count = 1 OR nm.node_type IN ('intersection', 'endpoint'))
      ORDER BY 
        nm.connection_count ASC,  -- Prioritize degree-1 nodes (dead ends)
        nm.connection_count DESC,  -- Then by connection count
        nm.pg_id ASC
      LIMIT 50
    `;

    const result = await this.pgClient.query(endpointQuery, [componentNodes]);
    
    console.log(`📍 Found ${result.rows.length} endpoints for component`);
    
    // Log endpoint details for debugging
    if (result.rows.length > 0) {
      const endpointTypes = result.rows.reduce((acc: any, row: any) => {
        const key = `degree-${row.degree}-${row.node_type}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`📍 Endpoint types:`, endpointTypes);
    }

    return result.rows;
  }

  /**
   * Get out-and-back route patterns from the database
   */
  private async getOutAndBackPatterns(): Promise<RoutePattern[]> {
    const query = `
      SELECT 
        pattern_name,
        target_distance_km,
        target_elevation_gain,
        route_shape,
        tolerance_percent
      FROM route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km ASC
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows;
  }

  /**
   * Generate routes from a specific endpoint
   */
  private async generateRoutesFromEndpoint(
    pattern: RoutePattern,
    startEndpoint: any,
    halfTargetDistance: number,
    potentialDestinations: any[]
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    // Generate routes to each potential destination
    for (const destination of potentialDestinations.slice(0, 5)) { // Limit to 5 destinations per endpoint
      if (startEndpoint.id === destination.id) {
        continue; // Skip self
      }
      
      try {
        // Use KSP to find routes from start to destination
        const kspQuery = `
          SELECT 
            path_id,
            edge,
            cost,
            agg_cost,
            path_seq
          FROM pgr_ksp(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            ${startEndpoint.id},
            ${destination.id},
            3, -- K value
            false -- directed
          )
          WHERE edge != -1
        `;
        
        const kspResult = await this.pgClient.query(kspQuery);
        
        if (kspResult.rows.length > 0) {
          // Create route recommendation
          const route: RouteRecommendation = {
            route_uuid: `out-and-back-${startEndpoint.id}-${destination.id}-${Date.now()}`,
            route_name: `${pattern.pattern_name} via ${startEndpoint.id} to ${destination.id}`,
            input_length_km: pattern.target_distance_km,
            input_elevation_gain: pattern.target_elevation_gain,
            recommended_length_km: kspResult.rows.reduce((sum, row) => sum + row.cost, 0) * 2, // Double for out-and-back
            recommended_elevation_gain: 0, // TODO: Calculate elevation
            route_shape: 'out-and-back',
            route_score: 100,
            route_path: kspResult.rows.map(row => ({
              seq: row.path_seq,
              cost: row.cost,
              edge: row.edge.toString(),
              node: row.path_seq.toString()
            })),
            route_edges: kspResult.rows.map(row => parseInt(row.edge)),
            trail_count: 1,
            route_type: 'out-and-back',
            similarity_score: 1.0,
            region: this.config.region
          };
          
          routes.push(route);
        }
      } catch (error) {
        console.log(`⚠️ Error generating route from ${startEndpoint.id} to ${destination.id}:`, error);
      }
    }
    
    return routes;
  }
}
