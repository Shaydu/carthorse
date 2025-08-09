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
    // P2P-only mode: skip all non-P2P generations entirely (no loops, no out-and-back patterns)
    if (process.env.P2P_ONLY === '1') {
      if (process.env.P2P_COMPONENT_DIAMETER === '1') {
        this.log('[RECOMMENDATIONS] ▶️ P2P_ONLY=1 + P2P_COMPONENT_DIAMETER=1 — generating one longest P2P per connected component');
        const p2p = await this.generateComponentDiameterP2PRoutes();
        this.log(`[RECOMMENDATIONS] ✅ Generated ${p2p.length} point-to-point routes (components)`);
        return p2p;
      }
      this.log('[RECOMMENDATIONS] ▶️ P2P_ONLY=1 — generating longest point-to-point routes only');
      const p2p = await this.generateLongestP2PRoutes();
      this.log(`[RECOMMENDATIONS] ✅ Generated ${p2p.length} point-to-point routes (P2P_ONLY)`);
      return p2p;
    }
    
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

    // Optional stitched P2P pass: connect trails whose endpoints are within tolerance, then mirror for return
    if (process.env.STITCH_P2P === '1') {
      try {
        const stitched = await this.generateStitchedP2PRoutes();
        if (stitched.length > 0) {
          this.log(`[RECOMMENDATIONS] ➕ Added ${stitched.length} stitched P2P routes`);
          allRecommendations.push(...stitched);
        }
      } catch (e: any) {
        this.log(`[RECOMMENDATIONS] ⚠️ Stitched P2P pass failed: ${e.message}`);
      }
    }

    return allRecommendations;
  }

  /**
   * Generate one longest P2P route per connected component of the routing graph.
   * Optionally materializes tiny bridge edges between nearby degree-1 vertices to close gaps.
   */
  private async generateComponentDiameterP2PRoutes(): Promise<RouteRecommendation[]> {
    const recommendations: RouteRecommendation[] = [];
    const kValue = this.config.kspKValue || 10;
    const bridgeAtGeneration = process.env.BRIDGE_AT_GENERATION === '1';
    const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
    const tolDeg = tolMeters / 111000.0;

    // 0) Optionally pre-bridge nearby endpoints generically (degree-1 vertices)
    if (bridgeAtGeneration && tolMeters > 0) {
      try {
        const pairs = await this.pgClient.query(
          `SELECT v1.id AS a, v2.id AS b
           FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v1
           JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
           WHERE v1.cnt = 1 AND v2.cnt = 1 AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
           ORDER BY ST_Distance(v1.the_geom, v2.the_geom)
           LIMIT 200`,
          [tolDeg]
        );
        for (const row of pairs.rows) {
          await this.ensureBridgeEdgeBetweenNodes(this.config.stagingSchema, Number(row.a), Number(row.b), tolMeters);
        }
        this.log(`  🔗 Bridged ${pairs.rowCount || 0} nearby endpoint pairs (≤${tolMeters}m)`);
      } catch (e: any) {
        this.log(`  ⚠️ Failed generic pre-bridge: ${e.message}`);
      }
    }

    // 1) Compute connected components
    const comp = await this.pgClient.query(
      `SELECT * FROM pgr_connectedComponents(
         'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
       )`
    );
    if (comp.rows.length === 0) {
      this.log('  ❌ No components found');
      return recommendations;
    }

    // Group nodes by component
    const byComponent = new Map<number, number[]>();
    for (const row of comp.rows) {
      const c = Number(row.component);
      const n = Number(row.node);
      if (!byComponent.has(c)) byComponent.set(c, []);
      byComponent.get(c)!.push(n);
    }

    // 2) For each component with ≥2 nodes, find diameter endpoints (double Dijkstra heuristic)
    for (const [componentId, nodes] of byComponent.entries()) {
      if (nodes.length < 2) continue;
      const startSeed = nodes[0];

      const farARes = await this.pgClient.query(
        `SELECT end_vid AS node_id, MAX(agg_cost) AS distance_km
         FROM pgr_dijkstra(
           $$SELECT id, source, target, length_km AS cost FROM ${this.config.stagingSchema}.ways_noded$$::text,
           $1::bigint,
           $2::bigint[],
           false
         )
         GROUP BY end_vid
         ORDER BY distance_km DESC
         LIMIT 1`,
        [startSeed, nodes]
      );
      if (farARes.rows.length === 0) continue;
      const a = Number(farARes.rows[0].node_id);

      const farBRes = await this.pgClient.query(
        `SELECT end_vid AS node_id, MAX(agg_cost) AS distance_km
         FROM pgr_dijkstra(
           $$SELECT id, source, target, length_km AS cost FROM ${this.config.stagingSchema}.ways_noded$$::text,
           $1::bigint,
           $2::bigint[],
           false
         )
         GROUP BY end_vid
         ORDER BY distance_km DESC
         LIMIT 1`,
        [a, nodes]
      );
      if (farBRes.rows.length === 0) continue;
      const b = Number(farBRes.rows[0].node_id);

      if (a === b) continue;

      // 3) Run KSP between a↔b and pick the longest path
      const baseEdgeSql = `
        SELECT id, source, target, length_km as cost
        FROM ${this.config.stagingSchema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL AND length_km <= 2.0 AND app_uuid IS NOT NULL AND name IS NOT NULL
      `;
      const bridgeEdgeSql = `
        SELECT -(1000000000 + row_number() over())::bigint AS id, v1.id AS source, v2.id AS target,
               (ST_Distance(v1.the_geom::geography, v2.the_geom::geography)/1000.0) AS cost
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v1
        JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
        WHERE v1.cnt = 1 AND v2.cnt = 1 AND ST_DWithin(v1.the_geom, v2.the_geom, ${tolDeg})
      `;
      const combinedEdgeSql = bridgeAtGeneration
        ? `SELECT id, source, target, cost FROM ( ${baseEdgeSql} UNION ALL ${bridgeEdgeSql} ) AS e ORDER BY id`
        : `SELECT id, source, target, cost FROM ( ${baseEdgeSql} ) AS e ORDER BY id`;

      const kspRows = await this.pgClient.query(
        `SELECT * FROM pgr_ksp($$${combinedEdgeSql}$$, $1::bigint, $2::bigint, $3, false, false)`,
        [a, b, kValue]
      );
      const groups = RouteGenerationBusinessLogic.groupKspRouteSteps(kspRows.rows);

      let best: { pathId: number; steps: any[]; routeEdges: any[]; totalDistance: number; totalElevationGain: number } | null = null;
      for (const [pathId, steps] of groups) {
        const edgeIds = RouteGenerationBusinessLogic.extractEdgeIds(steps);
        if (edgeIds.length === 0) continue;
        const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
        if (routeEdges.length === 0) continue;
        const { totalDistance, totalElevationGain } = RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
        if (!best || totalDistance > best.totalDistance) {
          best = { pathId: Number(pathId), steps, routeEdges, totalDistance, totalElevationGain };
        }
      }

      if (!best) continue;

      const rec: RouteRecommendation = {
        route_uuid: `p2p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        route_name: best.routeEdges.map(e => e.trail_name || 'Unnamed Trail').join(' → '),
        route_type: 'point-to-point',
        route_shape: 'point-to-point',
        input_length_km: best.totalDistance,
        input_elevation_gain: best.totalElevationGain,
        recommended_length_km: best.totalDistance,
        recommended_elevation_gain: best.totalElevationGain,
        route_path: JSON.stringify({ path_id: best.pathId, steps: best.steps }),
        route_edges: best.routeEdges,
        trail_count: new Set(best.routeEdges.map(e => e.app_uuid)).size,
        route_score: 100,
        similarity_score: 1,
        region: this.config.region
      } as any;

      recommendations.push(rec);
      this.generatedIdenticalRoutes.add(this.createExactRouteHash(best.routeEdges));
      this.log(`  ✅ P2P component ${componentId}: added ${rec.recommended_length_km.toFixed(2)}km P2P ${a}→${b}`);
    }

    return recommendations;
  }

  /**
   * Generate longest point-to-point routes over the connected graph.
   * For each entry node, find the farthest reachable node, run KSP, and keep the longest path.
   */
  private async generateLongestP2PRoutes(): Promise<RouteRecommendation[]> {
    const recommendations: RouteRecommendation[] = [];

    // Load trailhead/default entry nodes
    const routeDiscoveryConfig = this.configLoader.loadConfig();
    const trailheadConfig = routeDiscoveryConfig.trailheads;
    const shouldUseTrailheads = this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled;

    const nodesResult = await this.sqlHelpers.getNetworkEntryPoints(
      this.config.stagingSchema,
      shouldUseTrailheads,
      trailheadConfig.maxTrailheads,
      this.config.trailheadLocations
    );
    if (nodesResult.length < 2) {
      this.log('[RECOMMENDATIONS] ⚠️ P2P_ONLY: not enough entry nodes');
      return recommendations;
    }

    // Limit how many starts we try (configurable via YAML; default: all)
    const maxStartingNodes = this.configLoader.loadConfig().routeGeneration?.ksp?.maxStartingNodes || nodesResult.length;
    const actualMaxStartingNodes = maxStartingNodes === -1 ? nodesResult.length : Math.min(maxStartingNodes, nodesResult.length);

    const kValue = this.config.kspKValue || 3;
    const filterTrail = process.env.P2P_FILTER_TRAIL?.trim();
    const hasFilter = !!filterTrail && filterTrail.length > 0;
    const bridgeAtGeneration = process.env.BRIDGE_AT_GENERATION === '1';
    const bridgeTolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');

    for (const start of nodesResult.slice(0, actualMaxStartingNodes)) {
      const startNode = Number(start.id);
      // Find farthest reachable node by network distance
      const farRes = await this.pgClient.query(
        `WITH edge_sql AS (
           SELECT $$SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded
                    WHERE source IS NOT NULL AND target IS NOT NULL
                    ${hasFilter ? `AND (name ILIKE '%${filterTrail!.replace(/'/g, "''")}%' OR name = 'Bridge')` : ''}
                    ORDER BY id$$ AS sql
         ), d AS (
           SELECT * FROM pgr_dijkstra((SELECT sql FROM edge_sql), $1::bigint,
                   (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr), false)
         )
         SELECT end_vid AS node_id, MAX(agg_cost) AS distance_km
         FROM d WHERE end_vid <> $1
         GROUP BY end_vid
         ORDER BY distance_km DESC
         LIMIT 1`,
        [startNode]
      );

      if (farRes.rows.length === 0) {
        this.log(`  ❌ P2P_ONLY: no reachable nodes from ${startNode}`);
        continue;
      }

      const endNode = Number(farRes.rows[0].node_id);
      const estDistance = Number(farRes.rows[0].distance_km);

      // If endpoints lie within bridge tolerance, optionally materialize tiny connector
      if ((process.env.BRIDGE_AT_GENERATION === '1') && bridgeTolMeters > 0 && estDistance <= (bridgeTolMeters / 1000.0) + 1e-6) {
        await this.ensureBridgeEdgeBetweenNodes(this.config.stagingSchema, startNode, endNode, bridgeTolMeters);
      }

      // Run KSP from start→end and pick the longest path by summed edge length
      // Build KSP over filtered subgraph (optionally include virtual short bridges)
      const bridgeAtGeneration = process.env.BRIDGE_AT_GENERATION === '1';
      const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
      const tolDeg = tolMeters / 111000.0;

      const baseEdgeSql = `
        SELECT id, source, target, length_km as cost
        FROM ${this.config.stagingSchema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL
        ${hasFilter ? `AND (name ILIKE '%${filterTrail!.replace(/'/g, "''")}%' OR name = 'Bridge')` : ''}
      `;

      const bridgeEdgeSql = `
        SELECT -(1000000000 + row_number() over())::bigint AS id,
               v1.id AS source,
               v2.id AS target,
               (ST_Distance(v1.the_geom::geography, v2.the_geom::geography)/1000.0) AS cost
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v1
        JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
        WHERE v1.cnt = 1 AND v2.cnt = 1 AND ST_DWithin(v1.the_geom, v2.the_geom, ${tolDeg})
      `;

      const combinedEdgeSql = bridgeAtGeneration
        ? `SELECT id, source, target, cost FROM ( ${baseEdgeSql} UNION ALL ${bridgeEdgeSql} ) AS e ORDER BY id`
        : `SELECT id, source, target, cost FROM ( ${baseEdgeSql} ) AS e ORDER BY id`;

      const kspRows = await this.pgClient.query(
        `SELECT * FROM pgr_ksp($$${combinedEdgeSql}$$, $1::bigint, $2::bigint, $3, false, false)`,
        [startNode, endNode, kValue]
      );
      if (kspRows.rows.length === 0) {
        this.log(`  ❌ P2P_ONLY: KSP returned no path ${startNode}→${endNode}`);
        continue;
      }

      const routeGroups = RouteGenerationBusinessLogic.groupKspRouteSteps(kspRows.rows);
      let best: { pathId: number; steps: any[]; routeEdges: any[]; totalDistance: number; totalElevationGain: number } | null = null;

      for (const [pathId, steps] of routeGroups) {
        const edgeIds = RouteGenerationBusinessLogic.extractEdgeIds(steps);
        if (edgeIds.length === 0) continue;
        const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
        if (routeEdges.length === 0) continue;

        const identicalRouteHash = this.createExactRouteHash(routeEdges);
        if (this.generatedIdenticalRoutes.has(identicalRouteHash)) {
          continue;
        }

        const { totalDistance, totalElevationGain } = RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
        if (!best || totalDistance > best.totalDistance) {
          best = { pathId: Number(pathId), steps, routeEdges, totalDistance, totalElevationGain };
        }
      }

      if (!best) continue;

      // Create P2P recommendation (no mirroring)
      const rec: RouteRecommendation = {
        route_uuid: `p2p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        route_name: best.routeEdges.map(e => e.trail_name || 'Unnamed Trail').join(' → '),
        route_type: 'point-to-point',
        route_shape: 'point-to-point',
        input_length_km: best.totalDistance,
        input_elevation_gain: best.totalElevationGain,
        recommended_length_km: best.totalDistance,
        recommended_elevation_gain: best.totalElevationGain,
        route_path: JSON.stringify({ path_id: best.pathId, steps: best.steps }),
        route_edges: best.routeEdges,
        trail_count: new Set(best.routeEdges.map(e => e.app_uuid)).size,
        route_score: 100,
        similarity_score: 1,
        region: this.config.region
      } as any;

      recommendations.push(rec);
      this.generatedIdenticalRoutes.add(this.createExactRouteHash(best.routeEdges));
      this.log(`  ✅ P2P_ONLY: added ${rec.recommended_length_km.toFixed(2)}km P2P ${startNode}→${endNode}`);
    }

    return recommendations;
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
    // Tag base candidates as non-nearby (network-reachable)
    let candidateNodes: Array<{ node_id: number; distance_km: number; is_nearby: boolean }> =
      reachableNodes.map((r: any) => ({ node_id: Number(r.node_id), distance_km: Number(r.distance_km), is_nearby: false }));
    
    // Optionally augment with nearby endpoint vertices within bridge tolerance
    const bridgeAtGeneration = process.env.BRIDGE_AT_GENERATION === '1';
    const bridgeTolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');

    if (bridgeAtGeneration && bridgeTolMeters > 0) {
      try {
        const nearbyResult = await this.pgClient.query(
          `WITH start AS (
             SELECT the_geom FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE id = $1
           )
           SELECT v.id AS node_id,
                  (ST_Distance(v.the_geom::geography, s.the_geom::geography) / 1000.0) AS distance_km
           FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
           CROSS JOIN start s
           WHERE v.id <> $1
             AND ST_DWithin(v.the_geom, s.the_geom, $2 / 111000.0)
           ORDER BY distance_km ASC
           LIMIT 10`,
          [startNode, bridgeTolMeters]
        );

        // Merge while de-duplicating existing reachable nodes
        const existingSet = new Set(candidateNodes.map((r: any) => Number(r.node_id)));
        for (const row of nearbyResult.rows) {
          const nid = Number(row.node_id);
          if (!existingSet.has(nid)) {
            candidateNodes.push({ node_id: nid, distance_km: Number(row.distance_km), is_nearby: true });
            existingSet.add(nid);
          }
        }

        this.log(`  🔍 Nearby vertices within ${bridgeTolMeters}m: +${nearbyResult.rows.length} candidates (total candidates: ${candidateNodes.length})`);
      } catch (e: any) {
        this.log(`  ⚠️ Failed to load nearby endpoints for bridging: ${e.message}`);
      }
    }

    if (reachableNodes.length === 0) {
      this.log(`  ❌ No reachable nodes found from node ${startNode} within ${maxSearchDistance.toFixed(1)}km`);
      return;
    }
    
    this.log(`  ✅ Found ${reachableNodes.length} reachable nodes from node ${startNode}`);
    
          // Try each reachable node as a destination
      for (const reachableNode of candidateNodes) {
        // Remove per-pattern limit to allow more routes
      
      const endNode = reachableNode.node_id;
      const oneWayDistance = reachableNode.distance_km;

      // If this candidate is a nearby endpoint (very small great-circle distance),
      // optionally materialize a short Bridge edge so KSP can traverse it using real edges
      if (bridgeAtGeneration && reachableNode.is_nearby && bridgeTolMeters > 0 && oneWayDistance <= (bridgeTolMeters / 1000.0) + 1e-6) {
        await this.ensureBridgeEdgeBetweenNodes(this.config.stagingSchema, startNode, endNode, bridgeTolMeters);
      }
      
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
   * Ensure a concrete short Bridge edge exists between two vertex IDs.
   * Idempotent: inserts only if no existing direct edge connects the pair.
   */
  private async ensureBridgeEdgeBetweenNodes(stagingSchema: string, a: number, b: number, tolMeters?: number): Promise<void> {
    try {
      // Skip if already directly connected by a ways_noded edge (either direction)
      const existsRes = await this.pgClient.query(
        `SELECT 1 FROM ${stagingSchema}.ways_noded WHERE (source=$1 AND target=$2) OR (source=$2 AND target=$1) LIMIT 1`,
        [a, b]
      );
      if (existsRes.rows.length > 0) {
        return;
      }

      // Build a bridge using the nearest interior points on the incident edges of A and B,
      // create interior vertices at those points, and add three short edges: A→pA, pA↔pB, pB→B
      const tol = (tolMeters && tolMeters > 0 ? tolMeters : 20);

      const pairRes = await this.pgClient.query(
        `WITH
           va AS (SELECT id, the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id=$1),
           vb AS (SELECT id, the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id=$2),
           ea AS (SELECT id, the_geom FROM ${stagingSchema}.ways_noded WHERE source=$1 OR target=$1),
           eb AS (SELECT id, the_geom FROM ${stagingSchema}.ways_noded WHERE source=$2 OR target=$2),
           ranked AS (
             SELECT ea.id  AS a_id, eb.id  AS b_id,
                    ea.the_geom AS a_geom, eb.the_geom AS b_geom,
                    ST_ShortestLine(ea.the_geom, eb.the_geom) AS sl,
                    ST_Length(ST_ShortestLine(ea.the_geom, eb.the_geom)::geography) AS meters
             FROM ea CROSS JOIN eb
             ORDER BY meters ASC
             LIMIT 1
           )
           SELECT a_id, b_id, a_geom, b_geom,
                  sl,
                  ST_StartPoint(sl) AS pa,
                  ST_EndPoint(sl)   AS pb,
                  ST_LineLocatePoint(a_geom, ST_StartPoint(sl)) AS fa,
                  ST_LineLocatePoint(b_geom, ST_EndPoint(sl))   AS fb,
                  ST_Length(sl::geography) AS meters,
                  (SELECT the_geom FROM va) AS a_vertex_geom,
                  (SELECT the_geom FROM vb) AS b_vertex_geom
           FROM ranked`,
        [a, b]
      );

      if (pairRes.rows.length === 0) return;
      const row = pairRes.rows[0];
      const meters = Number(row.meters || 1e9);
      if (meters > tol) return; // too far to bridge

      await this.pgClient.query('BEGIN');

      // Create interior vertices at pA and pB
      const nextVertexIdRes = await this.pgClient.query(`SELECT COALESCE(MAX(id),0) AS max_id FROM ${stagingSchema}.ways_noded_vertices_pgr`);
      let nextVid = Number(nextVertexIdRes.rows[0].max_id || 0);

      const insPa = await this.pgClient.query(
        `INSERT INTO ${stagingSchema}.ways_noded_vertices_pgr (id, the_geom, cnt, chk, ein, eout, node_type)
         VALUES ($1, $2, 2, 0, 0, 0, 'intersection') RETURNING id`,
        [++nextVid, row.pa]
      );
      const paVid = insPa.rows[0].id;

      const insPb = await this.pgClient.query(
        `INSERT INTO ${stagingSchema}.ways_noded_vertices_pgr (id, the_geom, cnt, chk, ein, eout, node_type)
         VALUES ($1, $2, 2, 0, 0, 0, 'intersection') RETURNING id`,
        [++nextVid, row.pb]
      );
      const pbVid = insPb.rows[0].id;

      // Determine if the vertex is closer to start or end of each incident edge
      const isAStartRes = await this.pgClient.query(
        `SELECT ST_Distance(ST_StartPoint($1::geometry), $2::geometry) <= ST_Distance(ST_EndPoint($1::geometry), $2::geometry) AS is_start`,
        [row.a_geom, row.a_vertex_geom]
      );
      const isBStartRes = await this.pgClient.query(
        `SELECT ST_Distance(ST_StartPoint($1::geometry), $2::geometry) <= ST_Distance(ST_EndPoint($1::geometry), $2::geometry) AS is_start`,
        [row.b_geom, row.b_vertex_geom]
      );
      const isAStart = Boolean(isAStartRes.rows[0].is_start);
      const isBStart = Boolean(isBStartRes.rows[0].is_start);

      // Prepare new edge ids
      const nextEdgeIdRes = await this.pgClient.query(`SELECT COALESCE(MAX(id),0) AS max_id FROM ${stagingSchema}.ways_noded`);
      let nextEid = Number(nextEdgeIdRes.rows[0].max_id || 0);

      // Insert along-edge short segment from A to pA following the actual geometry
      const segAStart = isAStart ? 0 : Number(row.fa);
      const segAEnd   = isAStart ? Number(row.fa) : 1;
      await this.pgClient.query(
        `INSERT INTO ${stagingSchema}.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
         SELECT $1, NULL, 1,
                ST_LineSubstring($2::geometry, $3, $4) AS the_geom,
                'bridge', 'Bridge',
                ST_Length(ST_LineSubstring($2::geometry, $3, $4)::geography)/1000.0,
                0, 0,
                $5, $6`,
        [++nextEid, row.a_geom, segAStart, segAEnd, (isAStart ? a : paVid), (isAStart ? paVid : a)]
      );

      // Insert along-edge short segment from B to pB
      const segBStart = isBStart ? 0 : Number(row.fb);
      const segBEnd   = isBStart ? Number(row.fb) : 1;
      await this.pgClient.query(
        `INSERT INTO ${stagingSchema}.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
         SELECT $1, NULL, 1,
                ST_LineSubstring($2::geometry, $3, $4) AS the_geom,
                'bridge', 'Bridge',
                ST_Length(ST_LineSubstring($2::geometry, $3, $4)::geography)/1000.0,
                0, 0,
                $5, $6`,
        [++nextEid, row.b_geom, segBStart, segBEnd, (isBStart ? b : pbVid), (isBStart ? pbVid : b)]
      );

      // Insert cross-gap connector pA↔pB
      await this.pgClient.query(
        `INSERT INTO ${stagingSchema}.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
         VALUES ($1, NULL, 1, $2, 'bridge', 'Bridge', ST_Length($2::geography)/1000.0, 0, 0, $3, $4)`,
        [++nextEid, row.sl, paVid, pbVid]
      );

      await this.pgClient.query('COMMIT');
      this.log(`  🧩 Inserted A→pA, pA↔pB, pB→B connectors (gap ≈ ${meters.toFixed(2)}m)`);
    } catch (e: any) {
      try { await this.pgClient.query('ROLLBACK'); } catch {}
      this.log(`  ⚠️ Failed to insert A/pA/Bridge/pB connectors between ${a} and ${b}: ${e.message}`);
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
    const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
    
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
        // Prefer longer routes for the same endpoint pair (deduplicate redundant shorter variants)
        const endpointKey = this.createEndpointHash(routeEdges);
        const previousBest = this.generatedEndpointCombinations.get(endpointKey);
        if (previousBest !== undefined && outAndBackDistance <= previousBest + 1e-6) {
          this.log(`  ⏭️ Skipping shorter redundant route for endpoints ${endpointKey} (${outAndBackDistance.toFixed(2)}km <= ${previousBest.toFixed(2)}km)`);
          return;
        }
        // If a shorter one exists already, remove it and replace with this longer one
        if (previousBest !== undefined && outAndBackDistance > previousBest + 1e-6) {
          const idx = patternRoutes.findIndex(r => this.createEndpointHash((r as any).route_edges || []) === endpointKey);
          if (idx >= 0) {
            this.log(`  🔁 Replacing prior shorter route (${previousBest.toFixed(2)}km) with longer route (${outAndBackDistance.toFixed(2)}km) for endpoints ${endpointKey}`);
            patternRoutes.splice(idx, 1);
          }
        }
        this.generatedEndpointCombinations.set(endpointKey, outAndBackDistance);
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
      
      // Track this exact route to prevent truly identical routes from being added again
      this.generatedIdenticalRoutes.add(identicalRouteHash);
      
      this.log(`  ✅ Added route: ${recommendation.route_name} (${outAndBackDistance.toFixed(2)}km, ${outAndBackElevation.toFixed(0)}m, score: ${finalScore.toFixed(1)})`);
    } else {
      this.log(`  ❌ Route does not meet tolerance criteria`);
    }
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
   * Generate stitched point-to-point routes by connecting two trails whose endpoints are within tolerance.
   * Starts at the far endpoint of trail A, traverses the bridge and trail B to its far endpoint, then mirrors back.
   */
  private async generateStitchedP2PRoutes(): Promise<RouteRecommendation[]> {
    const recommendations: RouteRecommendation[] = [];
    const tolMeters = parseFloat(process.env.BRIDGE_TOL_METERS || '20');
    const tolDeg = tolMeters / 111000.0;

    // 1) Find trail pairs whose endpoints are within tolerance
    const pairsRes = await this.pgClient.query(
      `WITH eps AS (
         SELECT app_uuid, name,
                ST_StartPoint(geometry) AS s,
                ST_EndPoint(geometry)   AS e
         FROM ${this.config.stagingSchema}.trails
         WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
       )
       SELECT a.app_uuid AS a_uuid, a.name AS a_name,
              b.app_uuid AS b_uuid, b.name AS b_name,
              a.s AS a_s, a.e AS a_e, b.s AS b_s, b.e AS b_e
       FROM eps a, eps b
       WHERE a.app_uuid < b.app_uuid
         AND (
           ST_DWithin(a.s, b.s, $1) OR ST_DWithin(a.s, b.e, $1) OR
           ST_DWithin(a.e, b.s, $1) OR ST_DWithin(a.e, b.e, $1)
         )
       LIMIT 50`,
      [tolDeg]
    );

    if (pairsRes.rows.length === 0) {
      this.log('  🔍 Stitched P2P: no close endpoint pairs found');
      return recommendations;
    }

    for (const row of pairsRes.rows) {
      // Compute which endpoints are closest and the corresponding far endpoints
      const combos = [
        { aKey: 'a_s', bKey: 'b_s' },
        { aKey: 'a_s', bKey: 'b_e' },
        { aKey: 'a_e', bKey: 'b_s' },
        { aKey: 'a_e', bKey: 'b_e' },
      ] as const;

      let minDist = Number.POSITIVE_INFINITY;
      let joinA: any = null;
      let joinB: any = null;
      let farA: any = null;
      let farB: any = null;

      for (const c of combos) {
        const aGeom = (row as any)[c.aKey];
        const bGeom = (row as any)[c.bKey];
        const dRes = await this.pgClient.query('SELECT ST_Distance($1, $2) AS d', [aGeom, bGeom]);
        const d = Number(dRes.rows[0].d);
        if (d < minDist) {
          minDist = d;
          joinA = aGeom; joinB = bGeom;
          // set far endpoints as the other endpoint on each trail
          farA = c.aKey === 'a_s' ? row.a_e : row.a_s;
          farB = c.bKey === 'b_s' ? row.b_e : row.b_s;
        }
      }

      // Sanity check tolerance
      if (minDist > tolDeg) {
        continue;
      }

      // 2) Map far endpoints to nearest routing vertices
      const startNodeRes = await this.pgClient.query(
        `SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
         ORDER BY ST_Distance(the_geom, $1) ASC LIMIT 1`,
        [farA]
      );
      const endNodeRes = await this.pgClient.query(
        `SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
         ORDER BY ST_Distance(the_geom, $1) ASC LIMIT 1`,
        [farB]
      );
      const startNode = Number(startNodeRes.rows?.[0]?.id);
      const endNode = Number(endNodeRes.rows?.[0]?.id);
      if (!startNode || !endNode || startNode === endNode) {
        continue;
      }

      // 3) Run KSP between far endpoints to get the stitch path
      const kspRows = await this.sqlHelpers.executeKspRouting(
        this.config.stagingSchema,
        startNode,
        endNode,
        this.config.kspKValue
      );
      const routeGroups = RouteGenerationBusinessLogic.groupKspRouteSteps(kspRows);
      for (const [pathId, routeSteps] of routeGroups) {
        const edgeIds = RouteGenerationBusinessLogic.extractEdgeIds(routeSteps);
        if (edgeIds.length === 0) continue;

        const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
        if (routeEdges.length === 0) continue;

        const identicalRouteHash = this.createExactRouteHash(routeEdges);
        if (this.generatedIdenticalRoutes.has(identicalRouteHash)) {
          continue;
        }

        // Build out-and-back by mirroring
        const reversedEdges = this.createReversedEdges(routeEdges);
        const completeOutAndBackEdges = [...routeEdges, ...reversedEdges];

        const { totalDistance, totalElevationGain } = RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
        const { outAndBackDistance, outAndBackElevation } = RouteGenerationBusinessLogic.calculateOutAndBackMetrics(
          totalDistance, totalElevationGain
        );

        // Use a synthetic pattern that targets the actual distance
        const stitchPattern: any = {
          pattern_name: 'Stitched P2P',
          target_distance_km: Math.max(1, outAndBackDistance),
          target_elevation_gain: Math.max(0, outAndBackElevation),
        };

        const finalScore = RouteGenerationBusinessLogic.calculateRouteScore(
          outAndBackDistance,
          outAndBackElevation,
          stitchPattern,
          { name: 'custom', distance: 1000, elevation: 1000 } as any,
          routeEdges
        );

        const recommendation = RouteGenerationBusinessLogic.createRouteRecommendation(
          stitchPattern,
          Number(pathId),
          routeSteps,
          completeOutAndBackEdges,
          outAndBackDistance,
          outAndBackElevation,
          finalScore,
          this.config.region
        );

        recommendations.push(recommendation);
        this.generatedIdenticalRoutes.add(identicalRouteHash);
        // Only need one stitched route per pair
        break;
      }
    }

    return recommendations;
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