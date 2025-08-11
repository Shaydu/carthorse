import { Pool } from 'pg';
/**
 * Merge isolated connector endpoints into neighboring edges.
 * This specifically targets the issue where connector nodes appear as isolated endpoints
 * instead of being merged into continuous trails.
 */
export declare function mergeIsolatedConnectors(pgClient: Pool, stagingSchema: string): Promise<{
    merged: number;
    deleted: number;
}>;
//# sourceMappingURL=merge-isolated-connectors.d.ts.map