import { Pool } from 'pg';
export interface SQLiteExportConfig {
    region: string;
    outputPath: string;
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeTrails?: boolean;
    includeRecommendations?: boolean;
    includeRouteTrails?: boolean;
    verbose?: boolean;
}
export interface SQLiteExportResult {
    trailsExported: number;
    nodesExported: number;
    edgesExported: number;
    recommendationsExported?: number;
    routeTrailsExported?: number;
    routeAnalysisExported?: number;
    dbSizeMB: number;
    isValid: boolean;
    errors: string[];
}
export declare class SQLiteExportStrategy {
    private pgClient;
    private config;
    private stagingSchema;
    constructor(pgClient: Pool, config: SQLiteExportConfig, stagingSchema: string);
    /**
     * Export all data from staging schema to SQLite
     */
    exportFromStaging(): Promise<SQLiteExportResult>;
    /**
     * Create SQLite tables
     */
    private createSqliteTables;
    /**
     * Export trails from staging schema
     */
    private exportTrails;
    /**
     * Export nodes from staging schema
     */
    private exportNodes;
    /**
     * Export edges from staging schema
     */
    private exportEdges;
    /**
     * Export route recommendations from staging schema (v14 schema)
     */
    private exportRouteRecommendations;
    /**
     * Export from lollipop_routes table to unified route_recommendations table
     */
    private exportFromLollipopRoutes;
    /**
     * Export from route_recommendations table to unified route_recommendations table
     */
    private exportFromRouteRecommendations;
    /**
     * Insert region metadata
     */
    private insertRegionMetadata;
    /**
     * Export route analysis data
     */
    private exportRouteAnalysis;
    /**
     * Find constituent analysis files
     */
    private findConstituentAnalysisFiles;
    /**
     * Load constituent analysis file
     */
    private loadConstituentAnalysisFile;
    /**
     * Insert route analysis data into SQLite
     */
    private insertRouteAnalysisData;
    /**
     * Export legacy route_trails data
     */
    private exportRouteTrails;
    /**
     * Insert schema version
     */
    private insertSchemaVersion;
    /**
     * Calculate export fields in staging schema before export
     */
    private calculateExportFields;
    /**
     * Ensure export columns exist in route_recommendations table
     */
    private ensureExportColumnsExist;
    /**
     * Log message if verbose mode is enabled
     */
    private log;
}
//# sourceMappingURL=sqlite-export-strategy.d.ts.map