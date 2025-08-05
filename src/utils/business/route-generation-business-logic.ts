import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';

export interface ToleranceLevel {
  name: string;
  distance: number;
  elevation: number;
  quality: number;
}

export interface UsedArea {
  lon: number;
  lat: number;
  distance: number;
}

export class RouteGenerationBusinessLogic {
  /**
   * Calculate tolerance levels for route generation
   */
  static getToleranceLevels(pattern: RoutePattern): ToleranceLevel[] {
    return [
      { name: 'strict', distance: pattern.tolerance_percent, elevation: pattern.tolerance_percent, quality: 1.0 },
      { name: 'medium', distance: 50, elevation: 50, quality: 0.8 },
      { name: 'wide', distance: 100, elevation: 100, quality: 0.6 }
    ];
  }

  /**
   * Check if a geographic area is already used
   */
  static isAreaUsed(
    startLon: number, 
    startLat: number, 
    usedAreas: UsedArea[], 
    minDistanceBetweenRoutes: number = 2.0
  ): boolean {
    return usedAreas.some(area => {
      const distance = Math.sqrt(
        Math.pow((startLon - area.lon) * 111.32 * Math.cos(startLat * Math.PI / 180), 2) +
        Math.pow((startLat - area.lat) * 111.32, 2)
      );
      return distance < minDistanceBetweenRoutes;
    });
  }

  /**
   * Calculate route metrics from edges
   */
  static calculateRouteMetrics(routeEdges: any[]): { totalDistance: number; totalElevationGain: number } {
    let totalDistance = 0;
    let totalElevationGain = 0;
    
    for (const edge of routeEdges) {
      totalDistance += edge.length_km || 0;
      totalElevationGain += edge.elevation_gain || 0;
    }
    
    return { totalDistance, totalElevationGain };
  }

  /**
   * Calculate out-and-back metrics
   */
  static calculateOutAndBackMetrics(
    oneWayDistance: number, 
    oneWayElevation: number
  ): { outAndBackDistance: number; outAndBackElevation: number } {
    return {
      outAndBackDistance: oneWayDistance * 2,
      outAndBackElevation: oneWayElevation * 2
    };
  }

  /**
   * Check if route meets tolerance criteria
   */
  static meetsToleranceCriteria(
    outAndBackDistance: number,
    outAndBackElevation: number,
    pattern: RoutePattern,
    tolerance: ToleranceLevel
  ): { distanceOk: boolean; elevationOk: boolean } {
    const distanceOk = outAndBackDistance >= pattern.target_distance_km * (1 - tolerance.distance / 100) && 
                      outAndBackDistance <= pattern.target_distance_km * (1 + tolerance.distance / 100);
    
    const elevationOk = outAndBackElevation >= pattern.target_elevation_gain * (1 - tolerance.elevation / 100) && 
                       outAndBackElevation <= pattern.target_elevation_gain * (1 + tolerance.elevation / 100);
    
    return { distanceOk, elevationOk };
  }

  /**
   * Calculate route quality score
   */
  static calculateRouteScore(
    outAndBackDistance: number,
    pattern: RoutePattern,
    tolerance: ToleranceLevel
  ): number {
    return tolerance.quality * (1.0 - Math.abs(outAndBackDistance - pattern.target_distance_km) / pattern.target_distance_km);
  }

  /**
   * Create route recommendation object
   */
  static createRouteRecommendation(
    pattern: RoutePattern,
    pathId: number,
    routeSteps: any[],
    routeEdges: any[],
    outAndBackDistance: number,
    outAndBackElevation: number,
    finalScore: number,
    region: string
  ): RouteRecommendation {
    return {
      route_uuid: `ksp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      route_name: `${pattern.pattern_name} - KSP Route`,
      route_type: 'custom',
      route_shape: 'out-and-back',
      input_distance_km: pattern.target_distance_km,
      input_elevation_gain: pattern.target_elevation_gain,
      recommended_distance_km: outAndBackDistance,
      recommended_elevation_gain: outAndBackElevation,
      route_path: { path_id: pathId, steps: routeSteps },
      route_edges: routeEdges,
      trail_count: routeEdges.length,
      route_score: Math.floor(finalScore * 100),
      similarity_score: finalScore,
      region: region
    };
  }

  /**
   * Group KSP route steps by path ID
   */
  static groupKspRouteSteps(kspRows: any[]): Map<number, any[]> {
    const routeGroups = new Map();
    for (const row of kspRows) {
      if (!routeGroups.has(row.path_id)) {
        routeGroups.set(row.path_id, []);
      }
      routeGroups.get(row.path_id).push(row);
    }
    return routeGroups;
  }

  /**
   * Extract edge IDs from route steps
   */
  static extractEdgeIds(routeSteps: any[]): number[] {
    return routeSteps.map((step: any) => step.edge).filter((edge: number) => edge !== -1);
  }

  /**
   * Calculate target metrics for out-and-back routes
   */
  static calculateTargetMetrics(pattern: RoutePattern): { halfTargetDistance: number; halfTargetElevation: number } {
    return {
      halfTargetDistance: pattern.target_distance_km / 2,
      halfTargetElevation: pattern.target_elevation_gain / 2
    };
  }

  /**
   * Calculate distance tolerance range
   */
  static calculateDistanceToleranceRange(
    halfTargetDistance: number,
    tolerance: ToleranceLevel
  ): { minDistance: number; maxDistance: number } {
    return {
      minDistance: halfTargetDistance * (1 - tolerance.distance / 100),
      maxDistance: halfTargetDistance * (1 + tolerance.distance / 100)
    };
  }
} 