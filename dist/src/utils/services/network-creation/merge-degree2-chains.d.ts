import { Pool, PoolClient } from 'pg';
export interface MergeDegree2ChainsResult {
    chainsMerged: number;
    edgesRemoved: number;
    finalEdges: number;
}
export interface Degree2AnalysisResult {
    chainsFound: number;
    edgesThatWouldBeRemoved: number[];
    chainsThatWouldBeCreated: Array<{
        startVertex: number;
        endVertex: number;
        edgeIds: number[];
        totalLength: number;
        name: string;
    }>;
}
/**
 * Analyze what degree-2 chains would be merged without actually merging them.
 * This is useful for debugging and understanding what the merge process would do.
 *
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 */
export declare function analyzeDegree2Chains(pgClient: Pool | PoolClient, stagingSchema: string): Promise<Degree2AnalysisResult>;
/**
 * Merge degree-2 chain edges into single edges.
 * This creates continuous edges from dead ends to intersections by merging
 * chains where internal vertices have degree 2.
 *
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 */
export declare function mergeDegree2Chains(pgClient: Pool | PoolClient, stagingSchema: string): Promise<MergeDegree2ChainsResult>;
//# sourceMappingURL=merge-degree2-chains.d.ts.map