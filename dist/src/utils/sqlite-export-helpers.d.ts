import Database from 'better-sqlite3';
export declare const CARTHORSE_SCHEMA_VERSION: number;
/**
 * Create SQLite tables with v12 schema (pgRouting optimized + deduplication).
 */
export declare function createSqliteTables(db: Database.Database, dbPath?: string): void;
/**
 * Insert trails data into SQLite table.
 * Elevation data should be pre-calculated in PostgreSQL staging before export.
 */
export declare function insertTrails(db: Database.Database, trails: any[], dbPath?: string): void;
/**
 * Insert routing nodes data into SQLite table (v12 schema).
 * @param db SQLite database instance
 * @param nodes Array of routing node objects
 * @param dbPath Optional database path for logging
 */
export declare function insertRoutingNodes(db: Database.Database, nodes: any[], dbPath?: string): void;
/**
 * Insert routing edges data into SQLite table (v12 schema).
 * @param db SQLite database instance
 * @param edges Array of routing edge objects
 * @param dbPath Optional database path for logging
 */
export declare function insertRoutingEdges(db: Database.Database, edges: any[], dbPath?: string): void;
/**
 * Insert region metadata into SQLite table.
 */
export declare function insertRegionMetadata(db: Database.Database, metadata: any, dbPath?: string): void;
/**
 * Build region metadata object from trails data.
 */
export declare function buildRegionMeta(trails: any[], regionName: string, bbox?: any): any;
/**
 * Insert schema version into SQLite table.
 */
export declare function insertSchemaVersion(db: Database.Database, version: number, description?: string, dbPath?: string): void;
/**
 * Get the actual schema version from the database.
 */
export declare function getSchemaVersionFromDatabase(db: Database.Database): number | null;
export declare function insertRouteRecommendations(db: Database.Database, recommendations: any[]): void;
export declare function insertRouteTrails(db: Database.Database, routeTrails: any[]): void;
//# sourceMappingURL=sqlite-export-helpers.d.ts.map