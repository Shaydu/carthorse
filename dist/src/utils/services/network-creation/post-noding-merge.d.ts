import { Pool } from 'pg';
/**
 * Merge vertices within a tolerance so adjacent edges share the same vertex ID.
 * This resolves tiny gaps where endpoints are near-coincident but not identical.
 */
export declare function runPostNodingVertexMerge(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    mergedVertices: number;
    remappedSources: number;
    remappedTargets: number;
    deletedOrphans: number;
}>;
//# sourceMappingURL=post-noding-merge.d.ts.map