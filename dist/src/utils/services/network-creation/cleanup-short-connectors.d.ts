/**
 * Cleanup Short Connectors
 *
 * Removes very short connector edges that lead to dead-end nodes, which can
 * artificially create degree-3 vertices and prevent proper degree-2 chain merging.
 *
 * This addresses cases where:
 * - A connector edge is very short (< threshold meters)
 * - The connector leads to a degree-1 (dead-end) node
 * - This creates an artificial intersection that prevents merging
 *
 * Example:
 *   Edge A: 13 → 10 (2934m, main trail)
 *   Edge B: 10 → 24 (105m, main trail)
 *   Edge C: 10 → 23 (23m, connector to dead-end)
 *
 * Without cleanup: Node 10 appears degree-3, no merging possible
 * With cleanup: Edge C removed, Node 10 becomes degree-2, Edges A+B can merge
 */
import { Pool, PoolClient } from 'pg';
export interface ShortConnectorCleanupResult {
    connectorsRemoved: number;
    deadEndNodesRemoved: number;
    finalEdges: number;
}
/**
 * Remove short connector edges that lead to dead-end nodes
 */
export declare function cleanupShortConnectors(pgClient: Pool | PoolClient, stagingSchema: string, maxConnectorLengthMeters?: number): Promise<ShortConnectorCleanupResult>;
//# sourceMappingURL=cleanup-short-connectors.d.ts.map