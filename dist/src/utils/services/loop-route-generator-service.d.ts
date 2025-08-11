import { Pool } from 'pg';
import { RouteRecommendation } from '../ksp-route-generator';
export interface LoopRouteGeneratorConfig {
    stagingSchema: string;
    region: string;
    targetRoutesPerPattern: number;
    minDistanceBetweenRoutes: number;
}
export declare class LoopRouteGeneratorService {
    private pgClient;
    private config;
    private sqlHelpers;
    private constituentAnalysisService;
    constructor(pgClient: Pool, config: LoopRouteGeneratorConfig);
    /**
     * Generate loop routes for all patterns
     */
    generateLoopRoutes(): Promise<RouteRecommendation[]>;
    /**
     * Generate routes for a specific loop pattern
     */
    private generateRoutesForPattern;
    /**
     * Generate loop routes using pgr_hawickcircuits
     */
    private generateLoopRoutesWithHawickCircuits;
    /**
     * Process a loop route into a route recommendation
     */
    private processLoopRoute;
    /**
     * Generate a descriptive name for the loop route
     */
    private generateLoopRouteName;
    /**
     * Generate route path from edges
     */
    private generateRoutePath;
    /**
     * Store loop route recommendations
     */
    storeLoopRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void>;
}
//# sourceMappingURL=loop-route-generator-service.d.ts.map