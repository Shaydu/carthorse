import { Pool, Client } from 'pg';
export interface BboxSubdivision {
    id: string;
    bbox: [number, number, number, number];
    name: string;
}
export interface SubdivisionConfig {
    region: string;
    maxTrailsPerChunk?: number;
    overlapPercentage?: number;
    minChunkSize?: number;
}
export declare class BboxSubdivider {
    private pgClient;
    constructor(pgClient: Pool | Client);
    /**
     * Subdivide a region into smaller bbox chunks based on trail density
     */
    subdivideRegion(config: SubdivisionConfig): Promise<BboxSubdivision[]>;
    /**
     * Process a single bbox subdivision
     */
    processSubdivision(subdivision: BboxSubdivision, stagingSchema: string, region: string): Promise<{
        success: boolean;
        trailCount: number;
        errors: string[];
    }>;
    /**
     * Subdivide existing staging data into smaller chunks
     */
    subdivideStagingData(sourceStagingSchema: string, maxTrailsPerChunk?: number, minChunkSize?: number): Promise<BboxSubdivision[]>;
    /**
     * Process a staging subdivision (copy from source staging to new staging)
     */
    processStagingSubdivision(subdivision: BboxSubdivision, sourceStagingSchema: string, targetStagingSchema: string): Promise<{
        success: boolean;
        trailCount: number;
        errors: string[];
    }>;
    /**
     * Clean up staging schemas
     */
    cleanupSubdivisions(subdivisions: BboxSubdivision[]): Promise<void>;
}
/**
 * Create a BboxSubdivider instance
 */
export declare function createBboxSubdivider(pgClient: Pool | Client): BboxSubdivider;
//# sourceMappingURL=bbox-subdivision.d.ts.map