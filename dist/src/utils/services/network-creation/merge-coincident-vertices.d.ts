import { Pool } from 'pg';
export interface MergeCoincidentVerticesResult {
    verticesMerged: number;
    edgesMerged: number;
    finalVertices: number;
    finalEdges: number;
}
/**
 * Merge vertices that are geometrically coincident (within tolerance) but have different IDs.
 * This is a prerequisite for proper degree-2 chain merging.
 *
 * @param pgClient - PostgreSQL client
 * @param stagingSchema - Staging schema name
 * @param toleranceMeters - Tolerance in meters for merging vertices (default: 5m)
 */
export declare function mergeCoincidentVertices(pgClient: Pool, stagingSchema: string, toleranceMeters?: number): Promise<MergeCoincidentVerticesResult>;
//# sourceMappingURL=merge-coincident-vertices.d.ts.map