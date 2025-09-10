import { Pool } from 'pg';
export interface EdgeDeduplicationResult {
    duplicatesRemoved: number;
    finalEdges: number;
}
/**
 * Remove duplicate edges that connect the exact same nodes.
 * Handles two types of duplicates:
 * 1. Exact duplicates: Same source and target (A→B and A→B)
 * 2. Bidirectional duplicates: Same nodes but opposite directions (A→B and B→A)
 *
 * Keeps the edge with the shortest geometry and removes longer duplicates.
 *
 * @param pgClient Database connection
 * @param stagingSchema Schema containing the ways_noded table
 * @returns Statistics about the deduplication process
 */
export declare function deduplicateEdges(pgClient: Pool, stagingSchema: string): Promise<EdgeDeduplicationResult>;
//# sourceMappingURL=deduplicate-edges.d.ts.map