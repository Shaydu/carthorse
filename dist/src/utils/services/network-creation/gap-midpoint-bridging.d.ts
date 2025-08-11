import { Pool } from 'pg';
/**
 * Default gap bridging: detect endpoint gaps within tolerance, create a midpoint vertex,
 * and add short connector edges from each endpoint to the midpoint so routes can traverse.
 *
 * Behavior is config-driven (meters), not gated by env flags. Intended to run after
 * ways_noded and ways_noded_vertices_pgr are created and source/target set.
 */
export declare function runGapMidpointBridging(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    midpointsInserted: number;
    edgesInserted: number;
}>;
//# sourceMappingURL=gap-midpoint-bridging.d.ts.map