import { Pool } from 'pg';
export interface EdgeCompactionResult {
    chainsCreated: number;
    edgesCompacted: number;
    edgesRemaining: number;
    finalEdges: number;
}
/**
 * Merge degree-2 chains into single edges.
 * This function looks for pairs of edges connected through degree-2 vertices
 * and merges them into single continuous edges.
 */
export declare function runEdgeCompaction(pgClient: Pool, stagingSchema: string): Promise<EdgeCompactionResult>;
//# sourceMappingURL=edge-compaction.d.ts.map