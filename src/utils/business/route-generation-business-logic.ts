import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

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
    try {
      const configLoader = RouteDiscoveryConfigLoader.getInstance();
      const tolerances = configLoader.getRecommendationTolerances();
      
      // Adjust tolerances based on route length - longer routes need more flexibility
      const isLongRoute = pattern.target_distance_km >= 15;
      const toleranceMultiplier = isLongRoute ? 1.5 : 1.0;
      
      return [
        { 
          name: 'strict', 
          distance: tolerances.strict.distance * toleranceMultiplier, 
          elevation: tolerances.strict.elevation * toleranceMultiplier, 
          quality: tolerances.strict.quality 
        },
        { 
          name: 'medium', 
          distance: tolerances.medium.distance * toleranceMultiplier, 
          elevation: tolerances.medium.elevation * toleranceMultiplier, 
          quality: tolerances.medium.quality 
        },
        { 
          name: 'wide', 
          distance: tolerances.wide.distance * toleranceMultiplier, 
          elevation: tolerances.wide.elevation * toleranceMultiplier, 
          quality: tolerances.wide.quality 
        },
        { 
          name: 'custom', 
          distance: tolerances.custom.distance * toleranceMultiplier, 
          elevation: tolerances.custom.elevation * toleranceMultiplier, 
          quality: tolerances.custom.quality 
        }
      ];
    } catch (error) {
      console.warn('⚠️ Failed to load configurable tolerances, using defaults:', error);
      // Fallback to hardcoded values if config loading fails
      const isLongRoute = pattern.target_distance_km >= 15;
      const toleranceMultiplier = isLongRoute ? 1.5 : 1.0;
      
      return [
        { name: 'strict', distance: pattern.tolerance_percent * toleranceMultiplier, elevation: pattern.tolerance_percent * toleranceMultiplier, quality: 1.0 },
        { name: 'medium', distance: 50 * toleranceMultiplier, elevation: 50 * toleranceMultiplier, quality: 0.8 },
        { name: 'wide', distance: 100 * toleranceMultiplier, elevation: 100 * toleranceMultiplier, quality: 0.6 }
      ];
    }
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
   * Calculate route quality score with improved metrics
   */
  static calculateRouteScore(
    outAndBackDistance: number,
    outAndBackElevation: number,
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    routeEdges: any[] = []
  ): number {
    // Base score from tolerance quality (0-100)
    let score = tolerance.quality * 100;
    
    // Distance accuracy bonus/penalty (0-20)
    const distanceAccuracy = Math.max(0, 1.0 - Math.abs(outAndBackDistance - pattern.target_distance_km) / pattern.target_distance_km);
    score += distanceAccuracy * 15;
    
    // Elevation accuracy bonus/penalty (0-20)
    const elevationAccuracy = Math.max(0, 1.0 - Math.abs(outAndBackElevation - pattern.target_elevation_gain) / Math.max(pattern.target_elevation_gain, 1));
    score += elevationAccuracy * 15;
    
    // Enhanced trail diversity bonus (0-15) - favor multi-trail routes
    if (routeEdges.length > 0) {
      const uniqueTrails = new Set(routeEdges.map(edge => edge.app_uuid)).size;
      const trailDiversityBonus = Math.min(uniqueTrails / 2, 1.0) * 15; // Increased from 10 to 15
      score += trailDiversityBonus;
      
      // Additional bonus for routes with 3+ trails
      if (uniqueTrails >= 3) {
        score += 5; // Extra bonus for complex multi-trail routes
      }
    }
    
    // Route length bonus (0-10) - favor longer routes
    const lengthBonus = Math.max(0, 10 - Math.abs(outAndBackDistance - pattern.target_distance_km));
    score += lengthBonus;
    
    // Elevation gain bonus (0-10)
    const elevationBonus = Math.max(0, 10 - Math.abs(outAndBackElevation - pattern.target_elevation_gain) / Math.max(pattern.target_elevation_gain / 10, 1));
    score += elevationBonus;
    
    // Bonus for longer routes (encourage longer, more challenging routes)
    if (outAndBackDistance >= 15) {
      score += 10; // Significant bonus for longer routes
    } else if (outAndBackDistance >= 10) {
      score += 5; // Moderate bonus for medium routes
    }
    
    // Bonus for routes with good elevation gain
    if (outAndBackElevation >= 500) {
      score += 5; // Bonus for challenging elevation
    }
    
    // Ensure score is within 0-100 range
    return Math.max(0, Math.min(100, Math.round(score)));
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
    // Generate route name from trail names, with fallback for unnamed trails
    const routeName = routeEdges.length > 0 
      ? routeEdges.map(edge => edge.trail_name || 'Unnamed Trail').join(' → ')
      : `${pattern.pattern_name} - KSP Route`;
    
    return {
      route_uuid: `ksp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      route_name: routeName,
      route_type: 'out-and-back',
      route_shape: 'out-and-back',
      input_length_km: pattern.target_distance_km,
      input_elevation_gain: pattern.target_elevation_gain,
      recommended_length_km: outAndBackDistance,
      recommended_elevation_gain: outAndBackElevation,
      route_path: JSON.stringify({ path_id: pathId, steps: routeSteps }),
      route_edges: routeEdges,
      trail_count: routeEdges.length,
      route_score: Math.floor(finalScore), // finalScore is already 0-100, no need to multiply
      similarity_score: finalScore / 100, // Convert from 0-100 to 0-1 range
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