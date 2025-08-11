import { Pool, Client } from 'pg';
export interface LoopSplittingConfig {
    stagingSchema: string;
    pgClient: Pool | Client;
    intersectionTolerance?: number;
}
export interface LoopSplittingResult {
    success: boolean;
    error?: string;
    loopCount?: number;
    splitSegments?: number;
    intersectionPoints?: number;
    apexPoints?: number;
}
export declare class LoopSplittingHelpers {
    private stagingSchema;
    private pgClient;
    private intersectionTolerance;
    constructor(config: LoopSplittingConfig);
    /**
     * Intelligently split loop trails at intersections and apex points
     */
    splitLoopTrails(): Promise<LoopSplittingResult>;
    /**
     * Identify loop trails (self-intersecting geometries)
     */
    private identifyLoopTrails;
    /**
     * Find intersection points between loop trails and other trails
     */
    private findLoopIntersections;
    /**
     * Find apex points for loops that only intersect once
     */
    private findLoopApexPoints;
    /**
     * Split loops at both intersection and apex points
     */
    private splitLoopsAtPoints;
    /**
     * Replace loop trails with split segments in the main trails table
     */
    replaceLoopTrailsWithSegments(): Promise<LoopSplittingResult>;
    /**
     * Get statistics about loop splitting
     */
    getLoopSplittingStats(): Promise<any>;
}
export declare function createLoopSplittingHelpers(stagingSchema: string, pgClient: Pool | Client, intersectionTolerance?: number): LoopSplittingHelpers;
//# sourceMappingURL=loop-splitting-helpers.d.ts.map