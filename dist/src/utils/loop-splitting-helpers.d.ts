import { Pool } from 'pg';
export interface LoopSplittingConfig {
    stagingSchema: string;
    pgClient: Pool;
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
     * This method now properly handles database transactions and original_trail_uuid relationships
     */
    splitLoopTrails(): Promise<LoopSplittingResult>;
    /**
     * Deduplicate trails by geometry before processing
     */
    private deduplicateTrailsByGeometry;
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
     * This method now properly handles the original_trail_uuid field and uses a single atomic operation
     */
    private replaceLoopTrailsWithSegments;
    /**
     * Get statistics about loop splitting
     */
    getLoopSplittingStats(): Promise<any>;
}
export declare function createLoopSplittingHelpers(stagingSchema: string, pgClient: Pool, intersectionTolerance?: number): LoopSplittingHelpers;
//# sourceMappingURL=loop-splitting-helpers.d.ts.map