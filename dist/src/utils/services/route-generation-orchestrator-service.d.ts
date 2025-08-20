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
    };
}
export declare class RouteGenerationOrchestratorService {
    private pgClient;
    private config;
    private outAndBackService;
    private unifiedKspService;
    private unifiedLoopService;
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