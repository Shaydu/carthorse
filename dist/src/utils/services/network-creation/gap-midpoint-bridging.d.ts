import { Pool } from 'pg';
/**
 * Minimal gap bridging: detect endpoint gaps within tolerance and create a single
 * direct bridge edge between them, avoiding unnecessary midpoint vertices.
 *
 * Behavior is config-driven (meters), not gated by env flags. Intended to run after
 * ways_noded and ways_noded_vertices_pgr are created and source/target set.
 */
export declare function runGapMidpointBridging(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    bridgesInserted: number;
}>;
//# sourceMappingURL=gap-midpoint-bridging.d.ts.map