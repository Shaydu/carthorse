import { Pool } from 'pg';
/**
 * Enhanced gap bridging: detect endpoint gaps within tolerance and create bridge edges
 * between degree-1 vertices and nearby degree-2 vertices, creating degree-3 intersections.
 *
 * This enables degree-2 chain merging by ensuring chains can end at proper intersections.
 */
export declare function runGapMidpointBridging(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    bridgesInserted: number;
}>;
//# sourceMappingURL=gap-midpoint-bridging.d.ts.map