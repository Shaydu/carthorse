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
     * Export all data from staging schema to GeoJSON
     */
    exportFromStaging(): Promise<void>;
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
     * Extract edge IDs from route path JSON
     */
    private extractEdgeIdsFromRoutePath;
}
//# sourceMappingURL=geojson-export-strategy.d.ts.map