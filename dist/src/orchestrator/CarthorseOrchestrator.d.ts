export interface CarthorseOrchestratorConfig {
    region: string;
    bbox?: [number, number, number, number];
    outputPath: string;
    stagingSchema?: string;
    noCleanup?: boolean;
    useSplitTrails?: boolean;
    minTrailLengthMeters?: number;
    trailheadsEnabled?: boolean;
    skipValidation?: boolean;
    verbose?: boolean;
    exportConfig?: {
        includeTrails?: boolean;
        includeNodes?: boolean;
        includeEdges?: boolean;
        includeRoutes?: boolean;
    };
}
export declare class CarthorseOrchestrator {
    private pgClient;
    private config;
    readonly stagingSchema: string;
    private exportAlreadyCompleted;
    constructor(config: CarthorseOrchestratorConfig);
    /**
     * Main entry point - generate KSP routes and export
     */
    generateKspRoutes(): Promise<void>;
    /**
     * Validate existing staging schema
     */
    private validateExistingStagingSchema;
    /**
     * Create staging environment
     */
    private createStagingEnvironment;
    /**
     * Copy trail data with bbox filter
     */
    private copyTrailData;
    /**
     * Create pgRouting network
     */
    private createPgRoutingNetwork;
    /**
     * Create merged trail chains from individual routing edges
     */
    private createMergedTrailChains;
    /**
     * Add length and elevation columns to ways_noded
     */
    private addLengthAndElevationColumns;
    /**
     * Merge degree 2 chains to consolidate network before route generation
     */
    private mergeDegree2Chains;
    /**
     * Split trails at intersections using TrailSplitter
     */
    private splitTrailsAtIntersections;
    /**
     * Generate all routes using the route generation orchestrator service
     */
    private generateAllRoutesWithService;
    /**
     * Generate analysis and export using the analysis and export service
     */
    private generateAnalysisAndExport;
    /**
     * Validate database environment (schema version, required functions)
     */
    private validateDatabaseEnvironment;
    /**
     * Validate routing network topology
     */
    private validateRoutingNetwork;
    /**
     * Cleanup staging environment
     */
    private cleanup;
    /**
     * End database connection
     */
    private endConnection;
    export(outputFormat?: 'geojson' | 'sqlite' | 'trails-only'): Promise<void>;
    private determineOutputFormat;
    private exportUsingStrategy;
    private exportToSqlite;
    private exportToGeoJSON;
    private exportTrailsOnly;
    /**
     * Fix trail gaps by extending trails to meet nearby endpoints
     */
    private fixTrailGaps;
}
//# sourceMappingURL=CarthorseOrchestrator.d.ts.map