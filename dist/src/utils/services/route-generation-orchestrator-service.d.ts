import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
export interface RouteGenerationOrchestratorConfig {
    stagingSchema: string;
    region: string;
    targetRoutesPerPattern: number;
    minDistanceBetweenRoutes: number;
    kspKValue: number;
    generateKspRoutes: boolean;
    generateLoopRoutes: boolean;
    generateP2PRoutes: boolean;
    includeP2PRoutesInOutput: boolean;
    generateLollipopRoutes: boolean;
    useTrailheadsOnly?: boolean;
    trailheadLocations?: Array<{
        name?: string;
        lat: number;
        lng: number;
        tolerance_meters?: number;
    }>;
    loopConfig?: {
        useHawickCircuits: boolean;
        targetRoutesPerPattern: number;
        elevationGainRateWeight?: number;
        distanceWeight?: number;
        hawickMaxRows?: number;
    };
    lollipopConfig?: {
        targetDistance: number;
        maxAnchorNodes: number;
        maxReachableNodes: number;
        maxDestinationExploration: number;
        distanceRangeMin: number;
        distanceRangeMax: number;
        edgeOverlapThreshold: number;
        kspPaths: number;
        minOutboundDistance: number;
        autoDiscoverEndpoints?: boolean;
        maxRoutesToKeep?: number;
    };
}
export declare class RouteGenerationOrchestratorService {
    private pgClient;
    private config;
    private trueOutAndBackService;
    private unifiedKspService;
    private unifiedLoopService;
    private lollipopService;
    private unifiedNetworkGenerator;
    private configLoader;
    constructor(pgClient: Pool, config: RouteGenerationOrchestratorConfig);
    /**
     * Create necessary tables in staging schema for route generation
     */
    private createStagingTables;
    /**
     * Generate all route types (KSP and Loop)
     */
    generateAllRoutes(): Promise<{
        kspRoutes: RouteRecommendation[];
        loopRoutes: RouteRecommendation[];
        totalRoutes: number;
    }>;
    /**
   * Generate only out-and-back routes
   */
    /**
     * Generate only loop routes
     */
    generateLoopRoutes(): Promise<RouteRecommendation[]>;
    /**
     * Get route generation statistics
     */
    getRouteGenerationStats(): Promise<{
        kspEnabled: boolean;
        loopEnabled: boolean;
        totalRoutesGenerated: number;
        routeTypes: string[];
    }>;
    /**
     * Store unified loop route recommendations in the database
     */
    private storeUnifiedLoopRouteRecommendations;
    /**
     * Store unified KSP route recommendations in the database
     */
    private storeUnifiedKspRouteRecommendations;
}
//# sourceMappingURL=route-generation-orchestrator-service.d.ts.map