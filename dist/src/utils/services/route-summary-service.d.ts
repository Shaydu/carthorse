import { Pool } from 'pg';
export interface RouteSummary {
    totalRoutes: number;
    routesByPattern: Record<string, number>;
    averageDistance: number;
    averageElevation: number;
    topRoutes: any[];
    region: string;
}
export interface SubdivisionResult {
    subdivision: string;
    success: boolean;
    initialCount: number;
    finalCount: number;
    droppedCount: number;
    routingSuccess: boolean;
    routeRecommendationsCount?: number;
    routingError?: string;
    errors?: string[];
}
export declare class RouteSummaryService {
    private pgClient;
    constructor(pgClient: Pool);
    /**
     * Generate summary for a single staging schema
     */
    generateRouteSummary(stagingSchema: string): Promise<RouteSummary>;
    /**
     * Generate comprehensive summary across multiple subdivisions
     */
    generateComprehensiveSummary(results: SubdivisionResult[]): Promise<void>;
    /**
     * Generate per-subdivision route summary
     */
    generateSubdivisionRouteSummary(subdivision: string, routeRecommendations: any[]): Promise<void>;
    /**
     * Check route recommendations in all staging schemas
     */
    checkAllStagingSchemas(): Promise<void>;
    /**
     * Export summary to JSON file
     */
    exportSummaryToJson(results: SubdivisionResult[], outputPath: string): Promise<void>;
}
//# sourceMappingURL=route-summary-service.d.ts.map