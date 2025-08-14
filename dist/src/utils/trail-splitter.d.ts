import { Pool } from 'pg';
export interface TrailSplitterConfig {
    minTrailLengthMeters: number;
    verbose?: boolean;
    enableDegree2Merging?: boolean;
}
export interface TrailSplitResult {
    success: boolean;
    originalCount: number;
    splitCount: number;
    finalCount: number;
    shortSegmentsRemoved: number;
    mergedOverlaps: number;
}
export declare class TrailSplitter {
    private pgClient;
    private stagingSchema;
    private config;
    constructor(pgClient: Pool, stagingSchema: string, config: TrailSplitterConfig);
    /**
     * Main method to split trails at intersections and merge overlapping segments
     */
    splitTrails(sourceQuery: string, params: any[]): Promise<TrailSplitResult>;
    /**
     * Step 1: Create temporary table for original trails
     */
    private createTempTrailsTable;
    /**
     * Step 2: Split trails at intersections using ST_Node()
     */
    private splitTrailsAtIntersections;
    /**
     * Step 3: Merge overlapping trail segments
     */
    private mergeOverlappingTrails;
    /**
     * Step 4: Remove segments that are too short
     */
    private removeShortSegments;
    /**
     * Step 5: Get final trail count
     */
    private getFinalTrailCount;
    /**
     * Step 4: Merge colinear overlapping segments and degree-2 chains
     */
    private mergeColinearOverlaps;
}
//# sourceMappingURL=trail-splitter.d.ts.map