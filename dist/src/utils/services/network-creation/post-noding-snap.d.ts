import { Pool } from 'pg';
export declare function runPostNodingSnap(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    snappedStart: number;
    snappedEnd: number;
}>;
//# sourceMappingURL=post-noding-snap.d.ts.map