import { Pool, PoolClient } from 'pg';
export interface MergeDegree2ChainsResult {
    chainsMerged: number;
    edgesRemoved: number;
    bridgeEdgesMerged: number;
    bridgeEdgesRemoved: number;
    finalEdges: number;
}
/**
 * Geometry-based degree-2 chain merging.
 * This creates continuous edges by merging chains with geometrically continuous endpoints,
 * regardless of trail names, to better reflect the actual trail network topology.
 *
 * @param pgClient - PostgreSQL client (Pool or PoolClient)
 * @param stagingSchema - Staging schema name
 * @returns Promise<MergeDegree2ChainsResult>
 */
export declare function mergeDegree2Chains(pgClient: Pool | PoolClient, stagingSchema: string): Promise<MergeDegree2ChainsResult>;
//# sourceMappingURL=merge-degree2-chains.d.ts.map