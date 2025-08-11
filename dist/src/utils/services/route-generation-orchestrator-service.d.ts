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
    };
}
export declare class RouteGenerationOrchestratorService {
    private pgClient;
    private config;
    private kspService;
    private loopService;
    private configLoader;
    constructor(pgClient: Pool, config: RouteGenerationOrchestratorConfig);
    /**
     * Generate all route types (KSP and Loop)
     */
    generateAllRoutes(): Promise<{
        kspRoutes: RouteRecommendation[];
        loopRoutes: RouteRecommendation[];
        totalRoutes: number;
    }>;
    /**
     * Generate only KSP routes
     */
    generateKspRoutes(): Promise<RouteRecommendation[]>;
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
}
//# sourceMappingURL=route-generation-orchestrator-service.d.ts.map