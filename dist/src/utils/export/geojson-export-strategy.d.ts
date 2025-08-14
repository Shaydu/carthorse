import { Pool } from 'pg';
export interface GeoJSONExportConfig {
    region: string;
    outputPath: string;
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeTrails?: boolean;
    includeRecommendations?: boolean;
    verbose?: boolean;
}
export interface GeoJSONFeature {
    type: 'Feature';
    geometry: {
        type: string;
        coordinates: number[][];
    };
    properties: Record<string, any>;
}
export interface GeoJSONCollection {
    type: 'FeatureCollection';
    features: GeoJSONFeature[];
}
export declare class GeoJSONExportStrategy {
    private pgClient;
    private config;
    private stagingSchema;
    private exportConfig;
    constructor(pgClient: Pool, config: GeoJSONExportConfig, stagingSchema: string);
    private log;
    /**
     * Create export-ready tables in staging schema
     */
    createExportTables(): Promise<boolean>;
    /**
     * Check if pgRouting tables exist in the staging schema
     */
    private checkPgRoutingTablesExist;
    /**
     * Check what routing-related tables exist in the staging schema
     */
    private checkAvailableTables;
    /**
     * Export all data from staging schema to GeoJSON
     */
    exportFromStaging(): Promise<void>;
    /**
     * Export trails from staging schema
     */
    private exportTrails;
    /**
     * Export nodes from export-ready table
     */
    private exportNodes;
    /**
     * Export trail vertices from export-ready table
     */
    private exportTrailVertices;
    /**
     * Export edges from export-ready table
     */
    private exportEdges;
    /**
     * Export recommendations from export-ready table
     */
    private exportRecommendations;
    /**
     * Extract edge IDs from route path JSON
     */
    private extractEdgeIdsFromRoutePath;
}
//# sourceMappingURL=geojson-export-strategy.d.ts.map