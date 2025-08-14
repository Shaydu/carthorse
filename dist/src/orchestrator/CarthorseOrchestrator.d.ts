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
    private finalConnectivityMetrics?;
    constructor(config: CarthorseOrchestratorConfig);
    /**
     * Main entry point - generate KSP routes and export
     *
     * 3-Layer Architecture:
     * Layer 1: TRAILS - Copy and cleanup trails, fill gaps
     * Layer 2: EDGES - Create edges from trails, node and merge for routability
     * Layer 3: ROUTES - Create routes from edges and vertices
     */
    generateKspRoutes(): Promise<void>;
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
     * Detect and fix gaps in the trail network
     */
    private detectAndFixGaps;
    /**
     * Add length and elevation columns to ways_noded
     */
    private addLengthAndElevationColumns;
    /**
     * Split trails at intersections using the consolidated TrailSplitter
     */
    private splitTrailsAtIntersections;
    /**
     * Generate all routes using the route generation orchestrator service
     */
    private generateAllRoutesWithService;
    /**
     * Generate route analysis using the analysis and export service
     */
    private generateRouteAnalysis;
    /**
     * Step 4: Clean up trails (remove invalid geometries, short segments)
     */
    private cleanupTrails;
    /**
     * Step 5: Fill gaps in trail network
     */
    private fillTrailGaps;
    /**
     * Step 6: Remove duplicates/overlaps while preserving all trails
     */
    private deduplicateTrails;
    /**
     * Step 7: Create edges from trails
     */
    private createEdgesFromTrails;
    /**
     * Step 8: Node the network (create vertices at intersections)
     */
    private nodeNetwork;
    /**
     * Step 10: Validate edge network connectivity
     */
    private validateEdgeNetwork;
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
    /**
     * Merge degree 2 chains to consolidate network before route generation
     */
    private mergeDegree2Chains;
    /**
     * Iterative deduplication and degree-2 chain merging
     */
    private iterativeDeduplicationAndMerging;
    /**
     * [Overlap] Deduplicate overlaps in the current trails table
     */
    private deduplicateOverlaps;
    /**
     * Single iteration of degree-2 chain merging
     */
    private mergeDegree2ChainsIteration;
    /**
     * Clean up orphan nodes in the pgRouting network
     */
    private cleanupOrphanNodes;
    /**
     * Measure network connectivity using pgRouting
     */
    private measureNetworkConnectivity;
    /**
     * Verify that no overlaps or degree-2 chains remain
     */
    private verifyNoOverlapsOrDegree2Chains;
    /**
     * Iterative network optimization: Bridge → Degree-2 merge → Cleanup → Repeat
     */
    private iterativeNetworkOptimization;
}
//# sourceMappingURL=CarthorseOrchestrator.d.ts.map