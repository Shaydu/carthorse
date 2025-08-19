import { Pool } from 'pg';
import { RouteRecommendation } from '../../types/route-types';
import { RouteGeometryGeneratorService } from './route-geometry-generator-service';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface LollipopRouteServiceConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
}

export interface LollipopPattern {
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: 'lollipop';
}

/**
 * Dedicated service for generating lollipop routes
 * Consolidates all lollipop route generation logic in one place
 */
export class LollipopRouteService {
  private geometryGeneratorService: RouteGeometryGeneratorService;
  private constituentAnalysisService: ConstituentTrailAnalysisService;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: LollipopRouteServiceConfig
  ) {
    this.geometryGeneratorService = new RouteGeometryGeneratorService(pgClient, config);
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

  /**
   * Generate all lollipop routes for all patterns
   */
  async generateLollipopRoutes(): Promise<RouteRecommendation[]> {
    console.log('🍭 [LOLLIPOP] Starting lollipop route generation...');
    
    const patterns = await this.getLollipopPatterns();
    const allRoutes: RouteRecommendation[] = [];
    
    // First, find available loops in the network
    const availableLoops = await this.findLoopsInNetwork();
    
    if (availableLoops.length === 0) {
      console.log('⚠️ [LOLLIPOP] No loops found in network, cannot generate lollipop routes');
      return allRoutes;
    }
    
    console.log(`🔍 [LOLLIPOP] Found ${availableLoops.length} potential loops in the network`);
    
    for (const pattern of patterns) {
      console.log(`🎯 [LOLLIPOP] Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern, availableLoops);
      allRoutes.push(...patternRoutes);
      
      console.log(`✅ [LOLLIPOP] Generated ${patternRoutes.length} routes for ${pattern.pattern_name}`);
    }
    
    console.log(`🎉 [LOLLIPOP] Total lollipop routes generated: ${allRoutes.length}`);
    return allRoutes;
  }

  /**
   * Generate lollipop routes for a specific pattern
   */
  private async generateRoutesForPattern(
    pattern: LollipopPattern,
    availableLoops: any[]
  ): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    
    for (const loop of availableLoops) {
      if (routes.length >= this.config.targetRoutesPerPattern) break;
      
      // Find suitable stems (linear paths) that can connect to this loop
      const stems = await this.findStemsForLoop(loop, pattern);
      
      for (const stem of stems) {
        if (routes.length >= this.config.targetRoutesPerPattern) break;
        
        const route = await this.createLollipopRoute(stem, loop, pattern);
        
        if (route) {
          routes.push(route);
          console.log(`✅ [LOLLIPOP] Added route: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    }
    
    return routes;
  }

  /**
   * Find loops in the network using pgr_hawickcircuits
   */
  private async findLoopsInNetwork(): Promise<any[]> {
    try {
      const result = await this.pgClient.query(`
        SELECT DISTINCT path_id, array_agg(edge ORDER BY seq) as loop_edges
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, COALESCE(cost, length_km, 0.1) as cost, COALESCE(cost, length_km, 0.1) as reverse_cost FROM ${this.config.stagingSchema}.ways_noded'
        )
        GROUP BY path_id
        ORDER BY path_id
        LIMIT 50
      `);
      
      return result.rows;
    } catch (error) {
      console.error('❌ [LOLLIPOP] Error finding loops:', error);
      return [];
    }
  }

  /**
   * Find suitable stems (linear paths) that can connect to a loop
   */
  private async findStemsForLoop(
    loop: any,
    pattern: LollipopPattern
  ): Promise<any[]> {
    const stems: any[] = [];
    
    try {
      // Get nodes that are part of the loop
      const loopNodes = await this.getLoopNodes(loop.loop_edges);
      
      if (loopNodes.length === 0) return stems;
      
      // For each loop node, try to find linear paths extending outward
      for (const loopNode of loopNodes) {
        // Target stem length should be roughly 1/3 of total route length
        const targetStemLength = pattern.target_distance_km * 0.33;
        
        const nodeStem = await this.findStemFromNode(loopNode.id, targetStemLength);
        
        if (nodeStem && nodeStem.length > 0) {
          stems.push({
            startNode: loopNode,
            stemEdges: nodeStem,
            loopConnection: loopNode.id
          });
        }
        
        // Limit number of stems to avoid too many combinations
        if (stems.length >= 10) break;
      }
    } catch (error) {
      console.error('❌ [LOLLIPOP] Error finding stems for loop:', error);
    }
    
    return stems;
  }

  /**
   * Get nodes that are part of a loop
   */
  private async getLoopNodes(loopEdges: number[]): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT DISTINCT source as id, 'source' as type
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1::bigint[])
      UNION
      SELECT DISTINCT target as id, 'target' as type
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1::bigint[])
      ORDER BY id
    `, [loopEdges]);
    
    return result.rows;
  }

  /**
   * Find a stem (linear path) extending from a node
   */
  private async findStemFromNode(
    startNodeId: number,
    targetLength: number
  ): Promise<any[]> {
    try {
      // Find potential endpoints for the stem
      const endpoints = await this.pgClient.query(`
        SELECT v.id
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE v.id != $1
          AND v.cnt <= 2  -- Endpoints or simple intersections
        ORDER BY v.id
        LIMIT 20
      `, [startNodeId]);
      
      for (const endpoint of endpoints.rows) {
        // Try to find a path from start to this endpoint
        const pathResult = await this.pgClient.query(`
          SELECT *
          FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM ${this.config.stagingSchema}.ways_noded',
            $1::bigint, $2::bigint, false
          )
          ORDER BY path_seq
        `, [startNodeId, endpoint.id]);
        
        if (pathResult.rows.length > 0) {
          const totalCost = pathResult.rows.reduce((sum, row) => sum + (row.cost || 0), 0);
          
          // Check if path length is suitable for a stem
          if (totalCost >= targetLength * 0.5 && totalCost <= targetLength * 1.5) {
            return pathResult.rows;
          }
        }
      }
      
      return [];
    } catch (error) {
      console.error(`❌ [LOLLIPOP] Error finding stem from node ${startNodeId}:`, error);
      return [];
    }
  }

  /**
   * Create a lollipop route from a stem and loop
   */
  private async createLollipopRoute(
    stem: any,
    loop: any,
    pattern: LollipopPattern
  ): Promise<RouteRecommendation | null> {
    try {
      // Combine stem edges (out and back) with loop edges
      const stemEdgeIds = stem.stemEdges.map((edge: any) => parseInt(edge.edge)).filter((id: number) => !isNaN(id));
      const loopEdgeIds = loop.loop_edges.map((id: string) => parseInt(id)).filter((id: number) => !isNaN(id));
      
      // Create the complete lollipop path: stem out + loop + stem back
      const completeEdgeIds = [...stemEdgeIds, ...loopEdgeIds, ...stemEdgeIds.reverse()];
      
      if (completeEdgeIds.length === 0) {
        return null;
      }
      
      // Generate geometry for lollipop route
      const routeGeometry = await this.geometryGeneratorService.generateRouteGeometry(
        completeEdgeIds,
        'lollipop'
      );
      
      if (!routeGeometry) {
        console.log(`⚠️ [LOLLIPOP] Failed to generate geometry for lollipop route`);
        return null;
      }
      
      // Calculate metrics
      const stemDistance = stem.stemEdges.reduce((sum: number, edge: any) => sum + (edge.cost || 0), 0);
      const loopDistance = await this.calculateLoopDistance(loopEdgeIds);
      const totalDistance = (stemDistance * 2) + loopDistance; // Stem out + loop + stem back
      
      // Get elevation data
      const elevationData = await this.getElevationDataForEdges(completeEdgeIds);
      
      // Get trail names for route naming
      const trailNames = await this.getTrailNamesForEdges([...stemEdgeIds, ...loopEdgeIds]);
      const primaryTrailName = trailNames[0] || 'Unknown Trail';
      
      const route: RouteRecommendation = {
        route_uuid: `lollipop-${stem.startNode.id}-${loop.path_id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: elevationData.elevation_gain,
        route_score: this.calculateRouteScore(totalDistance, elevationData.elevation_gain, pattern),
        route_type: 'lollipop',
        route_name: `${pattern.pattern_name} via ${primaryTrailName}`,
        route_shape: 'lollipop',
        trail_count: trailNames.length,
        route_path: null, // Redundant with route_geometry
        route_edges: completeEdgeIds,
        route_geometry: routeGeometry,
        similarity_score: 0,
        region: this.config.region
      };
      
      return route;
    } catch (error) {
      console.error('❌ [LOLLIPOP] Error creating lollipop route:', error);
      return null;
    }
  }

  /**
   * Calculate distance for loop edges
   */
  private async calculateLoopDistance(loopEdgeIds: number[]): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COALESCE(SUM(cost), 0) as total_distance
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1::bigint[])
    `, [loopEdgeIds]);
    
    return result.rows[0]?.total_distance || 0;
  }

  /**
   * Get elevation data for edges
   */
  private async getElevationDataForEdges(edgeIds: number[]): Promise<any> {
    const result = await this.pgClient.query(`
      SELECT 
        COALESCE(SUM(elevation_gain), 0) as elevation_gain,
        COALESCE(SUM(elevation_loss), 0) as elevation_loss
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1::bigint[])
    `, [edgeIds]);
    
    return result.rows[0] || { elevation_gain: 0, elevation_loss: 0 };
  }

  /**
   * Get trail names for edges
   */
  private async getTrailNamesForEdges(edgeIds: number[]): Promise<string[]> {
    const result = await this.pgClient.query(`
      SELECT DISTINCT trail_name
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1::bigint[])
        AND trail_name IS NOT NULL
        AND trail_name != ''
      ORDER BY trail_name
    `, [edgeIds]);
    
    return result.rows.map(row => row.trail_name);
  }

  /**
   * Calculate route score based on how well it matches target criteria
   */
  private calculateRouteScore(
    actualDistance: number,
    actualElevation: number,
    pattern: LollipopPattern
  ): number {
    const distanceScore = 1 - Math.abs(actualDistance - pattern.target_distance_km) / pattern.target_distance_km;
    const elevationScore = pattern.target_elevation_gain > 0 
      ? 1 - Math.abs(actualElevation - pattern.target_elevation_gain) / pattern.target_elevation_gain
      : 1;
    
    return Math.max(0, (distanceScore + elevationScore) / 2);
  }

  /**
   * Get lollipop route patterns
   */
  private async getLollipopPatterns(): Promise<LollipopPattern[]> {
    // Default lollipop patterns
    const defaultPatterns: LollipopPattern[] = [
      {
        pattern_name: 'Short Lollipop',
        target_distance_km: 4,
        target_elevation_gain: 150,
        route_shape: 'lollipop'
      },
      {
        pattern_name: 'Medium Lollipop',
        target_distance_km: 10,
        target_elevation_gain: 350,
        route_shape: 'lollipop'
      },
      {
        pattern_name: 'Long Lollipop',
        target_distance_km: 18,
        target_elevation_gain: 650,
        route_shape: 'lollipop'
      }
    ];
    
    return defaultPatterns;
  }
}
