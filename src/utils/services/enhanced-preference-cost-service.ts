import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface PreferenceCostConfig {
  priorityWeights: {
    elevation: number;
    distance: number;
    shape: number;
  };
  elevationCost: {
    deviationWeight: number;
    deviationExponent: number;
  };
  distanceCost: {
    deviationWeight: number;
    deviationExponent: number;
  };
}

export interface RouteCostBreakdown {
  totalCost: number;
  elevationCost: number;
  distanceCost: number;
  shapeCost: number;
  elevationGainRate: number;
  targetElevationGainRate: number;
  distanceDeviation: number;
  shapePreference: string;
}

export class EnhancedPreferenceCostService {
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(private pgClient: Pool) {
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

  /**
   * Calculate preference-based cost for a route
   * Lower cost = better match to user preferences
   */
  async calculateRoutePreferenceCost(
    stagingSchema: string,
    routeId: string,
    targetDistance: number,
    targetElevation: number
  ): Promise<RouteCostBreakdown> {
    // Get route details
    const routeResult = await this.pgClient.query(`
      SELECT 
        total_distance_km,
        total_elevation_gain,
        route_shape
      FROM ${stagingSchema}.route_recommendations 
      WHERE route_uuid = $1
    `, [routeId]);

    if (routeResult.rows.length === 0) {
      throw new Error(`Route not found: ${routeId}`);
    }

    const route = routeResult.rows[0];
    const actualDistance = route.total_distance_km;
    const actualElevation = route.total_elevation_gain;
    const routeShape = route.route_shape;

    // Calculate elevation gain rate
    const elevationGainRate = actualDistance > 0 ? actualElevation / actualDistance : 0;
    const targetElevationGainRate = targetDistance > 0 ? targetElevation / targetDistance : 0;

    // Calculate individual costs
    const elevationCost = this.calculateElevationGainRateCost(elevationGainRate, targetElevationGainRate);
    const distanceCost = this.calculateDistanceCost(actualDistance, targetDistance);
    const shapeCost = this.calculateRouteShapeCost(routeShape);

    // Get priority weights
    const config = this.configLoader.loadConfig();
    const weights = config.costWeighting?.enhancedCostRouting?.priorityWeights || {
      elevation: 0.6,
      distance: 0.3,
      shape: 0.1
    };

    // Calculate weighted total cost
    const totalCost = (elevationCost * weights.elevation) + 
                     (distanceCost * weights.distance) + 
                     (shapeCost * weights.shape);

    return {
      totalCost: totalCost * 100, // Normalize to 0-100 range
      elevationCost: elevationCost * 100,
      distanceCost: distanceCost * 100,
      shapeCost: shapeCost * 100,
      elevationGainRate,
      targetElevationGainRate,
      distanceDeviation: Math.abs(actualDistance - targetDistance) / targetDistance,
      shapePreference: routeShape
    };
  }

  /**
   * Calculate elevation gain rate cost (deviation from target)
   */
  private calculateElevationGainRateCost(actual: number, target: number): number {
    const config = this.configLoader.loadConfig();
    const deviationWeight = config.costWeighting?.enhancedCostRouting?.elevationCost?.deviationWeight || 3.0;
    const deviationExponent = config.costWeighting?.enhancedCostRouting?.elevationCost?.deviationExponent || 1.5;

    // Calculate deviation percentage
    const deviationPercent = target > 0 ? Math.abs(actual - target) / target : 0;
    
    // Calculate deviation cost (higher = worse match)
    const deviationCost = Math.pow(deviationPercent * deviationWeight, deviationExponent);

    // Calculate preference cost based on difficulty ranges
    const preferenceCost = this.getElevationGainRatePreferenceCost(actual);

    // Combine deviation cost and preference cost (weighted sum)
    return (deviationCost * 0.7) + (preferenceCost * 0.3);
  }

  /**
   * Calculate distance cost (deviation from target)
   */
  private calculateDistanceCost(actual: number, target: number): number {
    const config = this.configLoader.loadConfig();
    const deviationWeight = config.costWeighting?.enhancedCostRouting?.distanceCost?.deviationWeight || 2.0;
    const deviationExponent = config.costWeighting?.enhancedCostRouting?.distanceCost?.deviationExponent || 1.2;

    // Calculate deviation percentage
    const deviationPercent = target > 0 ? Math.abs(actual - target) / target : 0;
    
    // Calculate deviation cost (higher = worse match)
    const deviationCost = Math.pow(deviationPercent * deviationWeight, deviationExponent);

    // Calculate preference cost based on distance ranges
    const preferenceCost = this.getDistancePreferenceCost(actual);

    // Combine deviation cost and preference cost (weighted sum)
    return (deviationCost * 0.7) + (preferenceCost * 0.3);
  }

  /**
   * Calculate route shape cost (deviation from preferred shapes)
   */
  private calculateRouteShapeCost(routeShape: string): number {
    return this.getRouteShapePreferenceCost(routeShape);
  }

  /**
   * Get elevation gain rate preference cost based on difficulty ranges
   */
  private getElevationGainRatePreferenceCost(gainRate: number): number {
    if (gainRate >= 0 && gainRate < 50) return 0.2;      // Easy terrain - low cost
    if (gainRate >= 50 && gainRate < 100) return 0.0;    // Moderate terrain - lowest cost (most preferred)
    if (gainRate >= 100 && gainRate < 150) return 0.1;   // Hard terrain - low cost
    if (gainRate >= 150 && gainRate < 200) return 0.3;   // Expert terrain - higher cost
    if (gainRate >= 200) return 0.5;                     // Extreme terrain - highest cost
    return 0.5; // Default
  }

  /**
   * Get distance preference cost based on distance ranges
   */
  private getDistancePreferenceCost(distance: number): number {
    if (distance >= 0 && distance < 2) return 0.4;       // Very short routes - higher cost
    if (distance >= 2 && distance < 5) return 0.2;       // Short routes - moderate cost
    if (distance >= 5 && distance < 15) return 0.0;      // Medium routes - lowest cost (most preferred)
    if (distance >= 15 && distance < 25) return 0.1;     // Long routes - low cost
    if (distance >= 25) return 0.3;                      // Very long routes - higher cost
    return 0.5; // Default
  }

  /**
   * Get route shape preference cost
   */
  private getRouteShapePreferenceCost(routeShape: string): number {
    switch (routeShape) {
      case 'loop': return 0.0;           // Most preferred (lowest cost)
      case 'out-and-back': return 0.1;   // Highly preferred (low cost)
      case 'point-to-point': return 0.3; // Less preferred (higher cost)
      default: return 0.5;               // Default for unknown shapes (highest cost)
    }
  }

  /**
   * Find routes with minimum preference cost using SQL functions
   */
  async findRoutesWithMinimumPreferenceCost(
    stagingSchema: string,
    targetDistance: number,
    targetElevation: number,
    maxRoutes: number = 50
  ): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT * FROM find_routes_with_minimum_preference_cost($1, $2, $3, $4)
    `, [stagingSchema, targetDistance, targetElevation, maxRoutes]);

    return result.rows;
  }

  /**
   * Sort routes by preference cost (ascending - lowest cost first)
   */
  async sortRoutesByPreferenceCost(
    stagingSchema: string,
    routeIds: string[],
    targetDistance: number,
    targetElevation: number
  ): Promise<Array<{ routeId: string; cost: number; breakdown: RouteCostBreakdown }>> {
    const costPromises = routeIds.map(async (routeId) => {
      const breakdown = await this.calculateRoutePreferenceCost(
        stagingSchema, 
        routeId, 
        targetDistance, 
        targetElevation
      );
      return {
        routeId,
        cost: breakdown.totalCost,
        breakdown
      };
    });

    const routeCosts = await Promise.all(costPromises);
    
    // Sort by cost (ascending - lowest cost first)
    return routeCosts.sort((a, b) => a.cost - b.cost);
  }

  /**
   * Get cost configuration for debugging
   */
  getCostConfiguration(): PreferenceCostConfig {
    const config = this.configLoader.loadConfig();
    return {
      priorityWeights: config.costWeighting?.enhancedCostRouting?.priorityWeights || {
        elevation: 0.6,
        distance: 0.3,
        shape: 0.1
      },
      elevationCost: config.costWeighting?.enhancedCostRouting?.elevationCost || {
        deviationWeight: 3.0,
        deviationExponent: 1.5
      },
      distanceCost: config.costWeighting?.enhancedCostRouting?.distanceCost || {
        deviationWeight: 2.0,
        deviationExponent: 1.2
      }
    };
  }
}
