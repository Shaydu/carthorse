import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
import { RouteGeometryGeneratorService } from './route-geometry-generator-service';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface LoopRouteServiceConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
  kspKValue: number;
}

export interface LoopPattern {
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: 'loop';
}

export interface ToleranceLevel {
  name: string;
  distance: number; // percentage
  elevation: number; // percentage
}

/**
 * Dedicated service for generating loop routes
 * Consolidates all loop route generation logic in one place
 */
export class LoopRouteService {
  private geometryGeneratorService: RouteGeometryGeneratorService;
  private constituentAnalysisService: ConstituentTrailAnalysisService;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: LoopRouteServiceConfig
  ) {
    this.geometryGeneratorService = new RouteGeometryGeneratorService(pgClient, config);
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

  /**
   * Generate all loop routes for all patterns
   */
  async generateLoopRoutes(): Promise<RouteRecommendation[]> {
    console.log('🎯 [LOOP] Starting loop route generation...');
    
    const patterns = await this.getLoopPatterns();
    const allRoutes: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`🎯 [LOOP] Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateRoutesForPattern(pattern);
      allRoutes.push(...patternRoutes);
      
      console.log(`✅ [LOOP] Generated ${patternRoutes.length} routes for ${pattern.pattern_name}`);
    }
    
    console.log(`🎉 [LOOP] Total loop routes generated: ${allRoutes.length}`);
    return allRoutes;
  }

  /**
   * Generate loop routes for a specific pattern
   */
  private async generateRoutesForPattern(pattern: LoopPattern): Promise<RouteRecommendation[]> {
    const routes: RouteRecommendation[] = [];
    const toleranceLevels = this.getToleranceLevels(pattern);
    const seenTrailCombinations = new Set<string>();
    
    for (const tolerance of toleranceLevels) {
      if (routes.length >= this.config.targetRoutesPerPattern) break;
      
      console.log(`🔍 [LOOP] Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
      
      await this.generateLoopRoutesWithHawickCircuits(
        pattern,
        tolerance,
        routes,
        seenTrailCombinations
      );
    }
    
    return routes;
  }

  /**
   * Generate loop routes using pgr_hawickcircuits algorithm
   */
  private async generateLoopRoutesWithHawickCircuits(
    pattern: LoopPattern,
    tolerance: ToleranceLevel,
    routes: RouteRecommendation[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      console.log(`🔄 [LOOP] Finding loops with Hawick Circuits...`);
      
      // Find cycles using pgr_hawickcircuits
      const cycles = await this.findHawickCircuits();
      
      console.log(`🔍 [LOOP] Found ${cycles.length} potential loop edges with Hawick Circuits`);
      
      // Convert cycles to routes
      const validCycles = this.filterCyclesByTolerance(cycles, pattern, tolerance);
      
      console.log(`🔍 [LOOP] Found ${validCycles.length} valid cycles within distance tolerance`);
      
      for (const cycle of validCycles) {
        if (routes.length >= this.config.targetRoutesPerPattern) break;
        
        const route = await this.createLoopRoute(cycle, pattern);
        
        if (route && !seenTrailCombinations.has(route.route_name)) {
          routes.push(route);
          seenTrailCombinations.add(route.route_name);
          console.log(`✅ [LOOP] Added Hawick Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    } catch (error) {
      console.error('❌ [LOOP] Error generating Hawick Circuit loops:', error);
    }
  }

  /**
   * Find cycles using pgr_hawickcircuits
   */
  private async findHawickCircuits(): Promise<any[]> {
    try {
      const result = await this.pgClient.query(`
        SELECT *
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, cost, reverse_cost FROM ${this.config.stagingSchema}.ways_noded'
        )
        ORDER BY seq
      `);
      
      return result.rows;
    } catch (error) {
      console.error('❌ [LOOP] Error running pgr_hawickcircuits:', error);
      return [];
    }
  }

  /**
   * Filter cycles by distance and elevation tolerance
   */
  private filterCyclesByTolerance(
    cycles: any[],
    pattern: LoopPattern,
    tolerance: ToleranceLevel
  ): any[] {
    // Group cycles by path_id
    const cycleGroups = new Map<number, any[]>();
    for (const cycle of cycles) {
      if (!cycleGroups.has(cycle.path_id)) {
        cycleGroups.set(cycle.path_id, []);
      }
      cycleGroups.get(cycle.path_id)!.push(cycle);
    }
    
    const validCycles: any[] = [];
    
    for (const [pathId, cycleEdges] of cycleGroups) {
      // Calculate total distance for this cycle
      const totalDistance = this.calculateCycleDistance(cycleEdges);
      
      // Check if within tolerance
      const minDistance = pattern.target_distance_km * (1 - tolerance.distance / 100);
      const maxDistance = pattern.target_distance_km * (1 + tolerance.distance / 100);
      
      if (totalDistance >= minDistance && totalDistance <= maxDistance) {
        validCycles.push(cycleEdges);
      }
    }
    
    return validCycles;
  }

  /**
   * Calculate total distance for a cycle
   */
  private calculateCycleDistance(cycleEdges: any[]): number {
    return cycleEdges.reduce((sum, edge) => sum + (edge.cost || 0), 0);
  }

  /**
   * Create a loop route from cycle edges
   */
  private async createLoopRoute(
    cycleEdges: any[],
    pattern: LoopPattern
  ): Promise<RouteRecommendation | null> {
    try {
      // Extract edge IDs from cycle
      const edgeIds = cycleEdges.map(edge => parseInt(edge.edge));
      
      if (edgeIds.length === 0) {
        return null;
      }
      
      // Generate geometry for loop route
      const routeGeometry = await this.geometryGeneratorService.generateRouteGeometry(
        edgeIds,
        'loop'
      );
      
      if (!routeGeometry) {
        console.log(`⚠️ [LOOP] Failed to generate geometry for loop route`);
        return null;
      }
      
      // Calculate metrics
      const totalDistance = this.calculateCycleDistance(cycleEdges);
      
      // Get elevation data from edges
      const elevationData = await this.getElevationDataForEdges(edgeIds);
      
      // Get trail names for route naming
      const trailNames = await this.getTrailNamesForEdges(edgeIds);
      const primaryTrailName = trailNames[0] || 'Unknown Trail';
      
      const route: RouteRecommendation = {
        route_uuid: `loop-hawick-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        input_length_km: pattern.target_distance_km,
        input_elevation_gain: pattern.target_elevation_gain,
        recommended_length_km: totalDistance,
        recommended_elevation_gain: elevationData.elevation_gain,
        route_score: this.calculateRouteScore(totalDistance, elevationData.elevation_gain, pattern),
        route_type: 'loop',
        route_name: `${pattern.pattern_name} via ${primaryTrailName}`,
        route_shape: 'loop',
        trail_count: trailNames.length,
        route_path: null, // Redundant with route_geometry
        route_edges: edgeIds,
        route_geometry: routeGeometry,
        similarity_score: 0,
        region: this.config.region
      };
      
      return route;
    } catch (error) {
      console.error('❌ [LOOP] Error creating loop route:', error);
      return null;
    }
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
    pattern: LoopPattern
  ): number {
    const distanceScore = 1 - Math.abs(actualDistance - pattern.target_distance_km) / pattern.target_distance_km;
    const elevationScore = pattern.target_elevation_gain > 0 
      ? 1 - Math.abs(actualElevation - pattern.target_elevation_gain) / pattern.target_elevation_gain
      : 1;
    
    return Math.max(0, (distanceScore + elevationScore) / 2);
  }

  /**
   * Get tolerance levels for route generation
   */
  private getToleranceLevels(pattern: LoopPattern): ToleranceLevel[] {
    return [
      { name: 'strict', distance: 10, elevation: 15 },
      { name: 'medium', distance: 25, elevation: 35 },
      { name: 'wide', distance: 50, elevation: 75 },
      { name: 'custom', distance: 35, elevation: 50 }
    ];
  }

  /**
   * Get loop route patterns
   */
  private async getLoopPatterns(): Promise<LoopPattern[]> {
    // Default loop patterns
    const defaultPatterns: LoopPattern[] = [
      {
        pattern_name: 'Short Loop',
        target_distance_km: 3,
        target_elevation_gain: 100,
        route_shape: 'loop'
      },
      {
        pattern_name: 'Medium Loop',
        target_distance_km: 8,
        target_elevation_gain: 250,
        route_shape: 'loop'
      },
      {
        pattern_name: 'Long Loop',
        target_distance_km: 15,
        target_elevation_gain: 500,
        route_shape: 'loop'
      },
      {
        pattern_name: 'Epic Loop',
        target_distance_km: 25,
        target_elevation_gain: 800,
        route_shape: 'loop'
      }
    ];
    
    return defaultPatterns;
  }
}
