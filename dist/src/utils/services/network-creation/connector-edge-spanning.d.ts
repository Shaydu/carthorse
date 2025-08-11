import { Pool } from 'pg';
/**
 * Ensure an explicit routing edge spans each trail-level connector.
 * - Finds nearest vertices to each connector endpoint within tolerance
 * - Inserts a single edge in ways_noded following the connector geometry
 * - Skips if an edge already connects those two vertices
 * - Refreshes vertex degree counts
 */
export declare function runConnectorEdgeSpanning(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    inserted: number;
    matched: number;
}>;
//# sourceMappingURL=connector-edge-spanning.d.ts.map