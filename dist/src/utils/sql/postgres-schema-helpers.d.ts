import { Client } from 'pg';
/**
 * Build the master database using SQL/PostGIS and OSM loader.
 * @returns {Promise<void>}
 */
export declare function buildMasterDatabase(): Promise<void>;
/**
 * Calculate adaptive tolerance for geometry simplification using SQL/PostGIS.
 * @param trails
 * @param targetSizeMB
 * @returns {Promise<number>}
 */
export declare function calculateAdaptiveTolerance(trails: any[], targetSizeMB: number): Promise<number>;
/**
 * Estimate database size using SQL/PostGIS.
 * @param trails
 * @returns {Promise<number>}
 */
export declare function estimateDatabaseSize(trails: any[]): Promise<number>;
/**
 * Simplify geometry and return point counts using SQL/PostGIS.
 * @param wkt
 * @param tolerance
 * @returns {Promise<{ simplified: string; originalPoints: number; simplifiedPoints: number }>}
 */
export declare function simplifyGeometryWithCounts(wkt: string, tolerance: number): Promise<{
    simplified: string;
    originalPoints: number;
    simplifiedPoints: number;
}>;
/**
 * Calculate distance between two coordinates using SQL/PostGIS (ST_Distance).
 * @param coord1
 * @param coord2
 * @returns {Promise<number>}
 */
export declare function calculateDistance(coord1: [number, number], coord2: [number, number]): Promise<number>;
/**
 * Create the canonical routing_edges table in the given schema with all required columns and constraints.
 */
export declare function createCanonicalRoutingEdgesTable(pgClient: any, schemaName: string): Promise<void>;
export declare function cleanupStaging(pgClient: Client, stagingSchema: string): Promise<void>;
export declare function logSchemaTableState(pgClient: Client, stagingSchema: string, context: string): Promise<void>;
//# sourceMappingURL=postgres-schema-helpers.d.ts.map