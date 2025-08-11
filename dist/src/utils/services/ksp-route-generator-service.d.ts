import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
export interface KspRouteGeneratorConfig {
    stagingSchema: string;
    region: string;
    targetRoutesPerPattern: number;
    minDistanceBetweenRoutes: number;
    kspKValue: number;
    useTrailheadsOnly?: boolean;
    trailheadLocations?: Array<{
        name?: string;
        lat: number;
        lng: number;
        tolerance_meters?: number;
    }>;
}
export declare class KspRouteGeneratorService {
    private pgClient;
    private config;
    private sqlHelpers;
    private constituentAnalysisService;
    private generatedTrailCombinations;
    private generatedEndpointCombinations;
    private generatedIdenticalRoutes;
    private configLoader;
    private logFile;
    constructor(pgClient: Pool, config: KspRouteGeneratorConfig);
    /**
     * Log message to both console and file
     */
    private log;
    /**
     * Generate KSP routes for all patterns
     */
    generateKspRoutes(): Promise<RouteRecommendation[]>;
    /**
     * Reset endpoint tracking for new pattern
     */
    private resetEndpointTracking;
    /**
     * Generate routes for a specific pattern
     */
    private generateRoutesForPattern;
    /**
     * Generate routes with specific tolerance level
     */
    private generateRoutesWithTolerance;
    /**
     * Generate routes from a specific starting node
     */
    private generateRoutesFromNode;
    /**
     * Generate route between two specific nodes
     */
    private generateRouteBetweenNodes;
    /**
     * Process a single KSP route
     */
    private processKspRoute;
    /**
     * Merge consecutive edges that share the same trail name and are contiguous.
     * Does not modify database; only affects the route_edges payload for recommendations.
     */
    private coalesceConsecutiveSameNameEdges;
    /**
     * Create a unique hash for a trail combination to prevent duplicates
     */
    private createTrailCombinationHash;
    /**
     * Create a unique hash for exact edge sequence to detect truly identical routes
     */
    private createExactRouteHash;
    /**
     * Create a unique hash for an endpoint combination to prevent duplicates
     */
    private createEndpointHash;
    /**
     * Store route recommendations in database
     */
    storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void>;
    /**
     * Create reversed edges for out-and-back routes
     * This ensures the return journey follows actual trails, not straight lines
     */
    private createReversedEdges;
    /**
     * Reverse a WKB geometry (for out-and-back routes)
     */
    private reverseGeometry;
}
//# sourceMappingURL=ksp-route-generator-service.d.ts.map