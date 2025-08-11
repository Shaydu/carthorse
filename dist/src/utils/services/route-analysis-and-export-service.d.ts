import { Pool } from 'pg';
export interface RouteAnalysisAndExportConfig {
    stagingSchema: string;
    outputPath: string;
    exportConfig?: {
        includeTrails?: boolean;
        includeNodes?: boolean;
        includeEdges?: boolean;
        includeRoutes?: boolean;
    };
}
export interface RouteAnalysisResult {
    summary: {
        totalRoutes: number;
        averageDistance: number;
        averageElevation: number;
        routesByPattern: Record<string, number>;
    };
    constituentAnalysis: {
        totalRoutesAnalyzed: number;
        averageTrailsPerRoute: number;
        topRoutesByDiversity: Array<{
            route_name: string;
            unique_trail_count: number;
            distance: number;
            elevation: number;
        }>;
        exportedAnalysisPath?: string;
    };
}
export interface ExportResult {
    success: boolean;
    format: 'geojson' | 'sqlite';
    outputPath: string;
    message?: string;
    validationPassed?: boolean;
    exportStats?: {
        trails: number;
        nodes: number;
        edges: number;
        routes: number;
        routeAnalysis: number;
        routeTrails: number;
        sizeMB: number;
    };
}
export declare class RouteAnalysisAndExportService {
    private pgClient;
    private config;
    private summaryService;
    private constituentService;
    constructor(pgClient: Pool, config: RouteAnalysisAndExportConfig);
    /**
     * Generate comprehensive route analysis
     */
    generateRouteAnalysis(): Promise<RouteAnalysisResult>;
    /**
     * Export results to specified format
     */
    exportResults(): Promise<ExportResult>;
    /**
     * Validate export: comprehensive schema and data validation
     */
    private validateExport;
    /**
     * Generate complete analysis and export workflow
     */
    generateAnalysisAndExport(): Promise<{
        analysis: RouteAnalysisResult;
        export: ExportResult;
    }>;
}
//# sourceMappingURL=route-analysis-and-export-service.d.ts.map