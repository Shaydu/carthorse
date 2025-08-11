import { Pool } from 'pg';
/**
 * Validate and repair connector trail edges so every connector has a traversable
 * routing edge across its endpoints, and edge endpoints coincide exactly with
 * vertex coordinates. Operates across the entire staging schema.
 */
export declare function runConnectorIntegrity(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    totalConnectors: number;
    insertedEdges: number;
    normalizedEdges: number;
    weldedPairs: number;
}>;
//# sourceMappingURL=connector-integrity.d.ts.map