export interface CarthorseOrchestratorConfig {
    region: string;
    bbox?: [number, number, number, number];
    outputPath: string;
    stagingSchema?: string;
    sourceFilter?: string;
    noCleanup?: boolean;
    usePgRoutingSplitting?: boolean;
    splittingMethod?: 'postgis' | 'pgrouting';
    minTrailLengthMeters?: number;
    trailheadsEnabled?: boolean;
    skipValidation?: boolean;
    verbose?: boolean;
    enableDegree2Optimization?: boolean;
    useUnifiedNetwork?: boolean;
    analyzeNetwork?: boolean;
    skipIntersectionSplitting?: boolean;
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
    private layer1ConnectivityMetrics;
    private layer2ConnectivityMetrics;
    private finalConnectivityMetrics?;
    constructor(config: CarthorseOrchestratorConfig);
    /**
     * Process all layers with timeout protection
     */
    processLayers(): Promise<void>;
    /**
     * Process Layer 1: Trails - Building clean trail network
     */
    private processLayer1;
    /**
     * Process Layer 2: Edges and nodes from clean trails with robust guards
     */
    private processLayer2;
    /**
     * GUARD 1: Verify Layer 1 data exists and is valid
     */
    private verifyLayer1DataExists;
    /**
     * GUARD 2: Create vertex-based network with verification
     */
    private createVertexBasedNetworkWithGuards;
    /**
     * GUARD 3: Verify routing tables exist
     */
    private verifyRoutingTablesExist;
    /**
     * GUARD 2: Split trails at all intersection points using enhanced intersection splitting service
     */
    private splitTrailsAtIntersectionsWithVerification;
    /**
     * Apply loop splitting to handle self-intersecting trails
     */
    private applyLoopSplitting;
    /**
     * Verify loop splitting results
     */
    private verifyLoopSplittingResults;
    /**
     * Verify trail splitting results
     */
    private verifyTrailSplittingResults;
    /**
     * GUARD 4: Snap endpoints and split trails for better connectivity
     */
    private snapEndpointsAndSplitTrailsWithVerification;
    /**
     * GUARD 5: Add length and elevation columns with verification
     */
    private addLengthAndElevationColumnsWithVerification;
    /**
     * GUARD 6: Validate edge network connectivity
     */
    private validateEdgeNetworkWithVerification;
    /**
     * Analyze Layer 2 connectivity using pgRouting tools
     */
    private analyzeLayer2Connectivity;
    /**
     * Create staging environment with robust guards against race conditions
     */
    private createStagingEnvironment;
    /**
     * GUARD 1: Verify database connection is active and responsive
     */
    private verifyDatabaseConnection;
    /**
     * GUARD 2: Check if schema exists with proper error handling
     */
    private checkSchemaExists;
    /**
     * GUARD 2.1: Drop schema with verification
     */
    private dropSchemaWithVerification;
    /**
     * GUARD 3: Create schema with explicit transaction and verification
     */
    private createSchemaWithVerification;
    /**
     * GUARD 4: Verify schema was created successfully
     */
    private verifySchemaCreation;
    /**
     * GUARD 5: Create all staging tables with verification
     */
    private createStagingTablesWithVerification;
    /**
     * Create individual table with verification
     */
    private createTableWithVerification;
    /**
     * GUARD 6: Verify all staging tables exist and are accessible
     */
    private verifyStagingTablesExist;
    /**
     * Check if table exists in staging schema
     */
    private checkTableExists;
    /**
     * Get table creation SQL for staging tables
     */
    private getTableCreationSQL;
    /**
     * Check if Shadow Canyon Trail exists in staging at any point
     */
    private checkShadowCanyonTrail;
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
     * Validate that trail coverage hasn't been lost during processing
     */
    private validateTrailCoverage;
    /**
     * Step 5: Fill gaps in trail network
     */
    private fillTrailGaps;
    /**
     * Step 6: Remove duplicates/overlaps while preserving all trails
     */
    private deduplicateTrails;
    /**
     * Step 7: Create edges from trails and node the network
     */
    private createEdgesFromTrails;
    /**
     * Step 8: Node the network (create vertices at intersections)
     * This is now handled in createEdgesFromTrails()
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
     * Cleanup staging environment using centralized cleanup service
     */
    private cleanup;
    /**
     * End database connection
     */
    private endConnection;
    export(outputFormat?: 'geojson' | 'sqlite' | 'trails-only'): Promise<void>;
    private determineOutputFormat;
    private exportUsingStrategy;
    /**
     * Process elevation data before export to ensure all trails have elevation and bbox data
     */
    private processElevationDataBeforeExport;
    /**
     * GUARD: Verify all required data exists before export
     */
    private verifyExportPrerequisites;
    private exportToSqliteWithGuards;
    private exportToGeoJSONWithGuards;
    private exportTrailsOnlyWithGuards;
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
    /**
     * [REMOVED] Iterative deduplication and merging - moved to Layer 2 only
     * This method operated on trails table and included degree-2 merging
     * Degree-2 merging now only happens in Layer 2 on ways_noded table
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
    /**
     * Perform final degree 2 connector optimization using EdgeProcessingService
     * This runs after Layer 2 is complete and before Layer 3 starts
     */
    private performFinalDegree2Optimization;
    /**
     * Export network analysis visualization with component colors and endpoint degrees
     */
    private exportNetworkAnalysis;
    /**
     * Generate network analysis data with component colors and endpoint degrees
     */
    private generateNetworkAnalysisData;
    /**
     * Generate distinct colors for network components
     */
    private generateComponentColors;
    /**
     * Enhanced intersection-based trail splitting using improved ST_Split approach
     * This handles MultiPoint intersections properly
     */
    private replaceTrailsWithEnhancedSplitTrails;
}
//# sourceMappingURL=CarthorseOrchestrator.d.ts.map