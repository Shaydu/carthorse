import { Pool } from 'pg';
/**
 * Trail-level bridging: insert short connector trail rows into staging.trails
 * between trail endpoints that are within a given tolerance. This ensures that
 * all downstream structures (ways, nodes/edges, routes) span bridged gaps.
 *
 * ENHANCED: Avoids creating artificial degree-3 vertices by checking if
 * endpoints are already part of continuous trails or would create unnecessary intersections.
 */
export declare function runTrailLevelBridging(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    connectorsInserted: number;
}>;
//# sourceMappingURL=trail-level-bridging.d.ts.map