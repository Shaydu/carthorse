import { Pool } from 'pg';
/**
 * Collapse connector edges by extending a neighboring non-connector edge over the
 * connector geometry and removing the standalone connector edge. This guarantees
 * traversal without introducing extra edge complexity.
 */
export declare function runConnectorEdgeCollapse(pgClient: Pool, stagingSchema: string): Promise<{
    collapsed: number;
    deletedConnectors: number;
}>;
//# sourceMappingURL=connector-edge-collapse.d.ts.map