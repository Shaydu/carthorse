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
export declare class RouteGenerationBusinessLogic {
    /**
     * Calculate tolerance levels for route generation
     */
    static getToleranceLevels(pattern: RoutePattern): ToleranceLevel[];
    /**
     * Check if a geographic area is already used
     */
    static isAreaUsed(startLon: number, startLat: number, usedAreas: UsedArea[], minDistanceBetweenRoutes?: number): boolean;
    /**
     * Calculate route metrics from edges
     */
    static calculateRouteMetrics(routeEdges: any[]): {
        totalDistance: number;
        totalElevationGain: number;
    };
    /**
     * Calculate out-and-back metrics
     */
    static calculateOutAndBackMetrics(oneWayDistance: number, oneWayElevation: number): {
        outAndBackDistance: number;
        outAndBackElevation: number;
    };
    /**
     * Check if route meets tolerance criteria
     */
    static meetsToleranceCriteria(outAndBackDistance: number, outAndBackElevation: number, pattern: RoutePattern, tolerance: ToleranceLevel): {
        distanceOk: boolean;
        elevationOk: boolean;
    };
    /**
     * Calculate route quality score with improved metrics
     */
    static calculateRouteScore(outAndBackDistance: number, outAndBackElevation: number, pattern: RoutePattern, tolerance: ToleranceLevel, routeEdges?: any[]): number;
    /**
     * Create route recommendation object
     */
    static createRouteRecommendation(pattern: RoutePattern, pathId: number, routeSteps: any[], routeEdges: any[], outAndBackDistance: number, outAndBackElevation: number, finalScore: number, region: string): RouteRecommendation;
    /**
     * Group KSP route steps by path ID
     */
    static groupKspRouteSteps(kspRows: any[]): Map<number, any[]>;
    /**
     * Extract edge IDs from route steps
     */
    static extractEdgeIds(routeSteps: any[]): number[];
    /**
     * Calculate target metrics for out-and-back routes
     */
    static calculateTargetMetrics(pattern: RoutePattern): {
        halfTargetDistance: number;
        halfTargetElevation: number;
    };
    /**
     * Calculate distance tolerance range
     */
    static calculateDistanceToleranceRange(halfTargetDistance: number, tolerance: ToleranceLevel): {
        minDistance: number;
        maxDistance: number;
    };
}
//# sourceMappingURL=route-generation-business-logic.d.ts.map