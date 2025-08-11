import { Pool } from 'pg';
export interface ConstituentTrail {
    app_uuid: string;
    name: string;
    trail_type: string;
    surface: string;
    difficulty: string;
    length_km: number;
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
}
export interface RouteConstituentAnalysis {
    route_uuid: string;
    route_name: string;
    edge_count: number;
    unique_trail_count: number;
    constituent_trails: ConstituentTrail[];
    total_trail_distance_km: number;
    total_trail_elevation_gain_m: number;
    total_trail_elevation_loss_m: number;
    out_and_back_distance_km: number;
    out_and_back_elevation_gain_m: number;
    out_and_back_elevation_loss_m: number;
}
export declare class ConstituentTrailAnalysisService {
    private pgClient;
    constructor(pgClient: Pool);
    /**
     * Analyze constituent trails for a route
     */
    analyzeRouteConstituentTrails(stagingSchema: string, routeEdges: any[]): Promise<RouteConstituentAnalysis>;
    /**
     * Extract unique trails from route edges
     */
    private extractUniqueTrails;
    /**
     * Generate comprehensive route report
     */
    generateRouteReport(stagingSchema: string, routeAnalysis: RouteConstituentAnalysis): Promise<void>;
    /**
     * Analyze all routes in a staging schema
     */
    analyzeAllRoutes(stagingSchema: string): Promise<RouteConstituentAnalysis[]>;
    /**
     * Export constituent trail analysis to JSON
     */
    exportConstituentAnalysis(analyses: RouteConstituentAnalysis[], outputPath: string): Promise<void>;
    /**
     * Populate route_trails table in staging schema with constituent trail data
     */
    populateRouteTrailsTable(stagingSchema: string, routeAnalysis: RouteConstituentAnalysis): Promise<void>;
    /**
     * Populate route_trails table for all routes
     */
    populateAllRouteTrailsTables(stagingSchema: string, routeAnalyses: RouteConstituentAnalysis[]): Promise<void>;
}
//# sourceMappingURL=constituent-trail-analysis-service.d.ts.map