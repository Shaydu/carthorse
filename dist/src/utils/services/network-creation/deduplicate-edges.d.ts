import { Pool } from 'pg';
export interface EdgeDeduplicationResult {
    duplicatesRemoved: number;
    finalEdges: number;
}
/**
 * Remove duplicate edges that connect the same source and target vertices.
 * Keeps the edge with the longest geometry and removes shorter duplicates.
 *
 * @param pgClient Database connection
 * @param stagingSchema Schema containing the ways_noded table
 * @returns Statistics about the deduplication process
 */
export declare function deduplicateEdges(pgClient: Pool, stagingSchema: string): Promise<EdgeDeduplicationResult>;
//# sourceMappingURL=deduplicate-edges.d.ts.map