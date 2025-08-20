import { Pool, Client } from 'pg';
export interface RoutePattern {
    pattern_name: string;
    target_distance_km: number;
    target_elevation_gain: number;
    route_shape: string;
    tolerance_percent: number;
}
export interface RouteRecommendation {
    route_uuid: string;
    route_name: string;
    route_shape: string;
    input_length_km: number;
    input_elevation_gain: number;
    recommended_length_km: number;
    recommended_elevation_gain: number;
    route_path: any;
    route_edges: any[];
    route_geometry?: any;
    trail_count: number;
    route_score: number;
    similarity_score: number;
    region: string;
    constituent_trails?: any[];
    unique_trail_count?: number;
    total_trail_distance_km?: number;
    total_trail_elevation_gain_m?: number;
    out_and_back_distance_km?: number;
    out_and_back_elevation_gain_m?: number;
}
export declare class KspRouteGenerator {
    private pgClient;
    private stagingSchema;
    constructor(pgClient: Pool | Client, stagingSchema: string);
    generateRouteRecommendations(): Promise<RouteRecommendation[]>;
    private loadRoutePatterns;
    private addLengthAndElevationColumns;
    private getRegionFromStagingSchema;
    storeRecommendationsInDatabase(recommendations: RouteRecommendation[]): Promise<void>;
    /**
     * Generate out-and-back routes using KSP algorithm
     * For out-and-back routes, we target half the distance since we'll double it for the return journey
     */
    generateOutAndBackRoutes(pattern: RoutePattern, targetRoutes?: number): Promise<RouteRecommendation[]>;
    private fixConnectivityIssues;
    /**
     * Generate loop routes using pgRouting's native algorithms
     * Uses pgr_dijkstra to find paths that return to the start point
     */
    generateLoopRoutes(pattern: RoutePattern, targetRoutes?: number): Promise<RouteRecommendation[]>;
    /**
     * Generate point-to-point routes using pgRouting's pgr_dijkstra
     */
    generatePointToPointRoutes(pattern: RoutePattern, targetRoutes?: number): Promise<RouteRecommendation[]>;
    /**
     * Generate routes using pgr_withPoints for more flexible routing
     * This allows starting/ending anywhere on edges, not just at nodes
     */
    generateWithPointsRoutes(pattern: RoutePattern, targetRoutes?: number): Promise<RouteRecommendation[]>;
}
//# sourceMappingURL=ksp-route-generator.d.ts.map