import { Pool } from 'pg';
/**
 * Weld near-coincident vertex pairs at connector endpoints by remapping all edges
 * to a single canonical vertex within tolerance. This guarantees that edges on
 * both sides of a connector share the same vertex ID and traverse.
 */
export declare function runConnectorEndpointWeld(pgClient: Pool, stagingSchema: string, toleranceMeters: number): Promise<{
    weldedPairs: number;
    remappedEdges: number;
}>;
//# sourceMappingURL=connector-endpoint-weld.d.ts.map