import { Pool } from 'pg';
export interface TrailSplitterConfig {
    minTrailLengthMeters: number;
    verbose?: boolean;
}
export interface TrailSplitResult {
    iterations: number;
    finalSegmentCount: number;
    intersectionCount: number;
}
export declare class TrailSplitter {
    private pgClient;
    private stagingSchema;
    private config;
    constructor(pgClient: Pool, stagingSchema: string, config: TrailSplitterConfig);
    /**
     * Perform comprehensive trail splitting at intersections
     */
    splitTrails(sourceQuery: string, params: any[]): Promise<TrailSplitResult>;
    /**
     * Check if there are any intersections between trails
     */
    hasIntersections(): Promise<boolean>;
    /**
     * Get statistics about the current trail network
     */
    getStatistics(): Promise<{
        totalTrails: number;
        intersectionCount: number;
        averageTrailLength: number;
    }>;
}
//# sourceMappingURL=trail-splitter.d.ts.map