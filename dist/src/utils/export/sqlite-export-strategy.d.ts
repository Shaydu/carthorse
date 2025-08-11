import { Pool } from 'pg';
export interface SQLiteExportConfig {
    region: string;
    outputPath: string;
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeTrails?: boolean;
    includeRecommendations?: boolean;
    verbose?: boolean;
}
export interface SQLiteExportResult {
    trailsExported: number;
    nodesExported: number;
    edgesExported: number;
    recommendationsExported?: number;
    dbSizeMB: number;
    isValid: boolean;
    errors: string[];
}
export declare class SQLiteExportStrategy {
    private pgClient;
    private config;
    private stagingSchema;
    constructor(pgClient: Pool, config: SQLiteExportConfig, stagingSchema: string);
    private log;
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
     * Export recommendations from staging schema
     */
    private exportRecommendations;
    /**
     * Export route_trails relationships
     */
    private exportRouteTrails;
    /**
     * Export route summaries with pre-calculated statistics
     */
    private exportRouteSummaries;
    /**
     * Insert region metadata
     */
    private insertRegionMetadata;
    /**
     * Insert schema version
     */
    private insertSchemaVersion;
}
//# sourceMappingURL=sqlite-export-strategy.d.ts.map