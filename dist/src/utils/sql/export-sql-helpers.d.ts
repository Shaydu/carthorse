import { Pool } from 'pg';
export interface ExportData {
    trails: any[];
    nodes: any[];
    edges: any[];
}
export declare class ExportSqlHelpers {
    private pgClient;
    private stagingSchema;
    constructor(pgClient: Pool, stagingSchema: string);
    /**
     * Create export-ready tables in staging schema
     */
    createExportTables(): Promise<void>;
    /**
     * Export trail data for GeoJSON
     */
    exportTrailsForGeoJSON(): Promise<any[]>;
    /**
     * Export routing nodes for GeoJSON from export-ready table
     */
    exportRoutingNodesForGeoJSON(): Promise<any[]>;
    /**
     * Export original trail vertices for GeoJSON from export-ready table
     */
    exportTrailVerticesForGeoJSON(): Promise<any[]>;
    /**
     * Export routing edges for GeoJSON from export-ready table
     */
    exportRoutingEdgesForGeoJSON(): Promise<any[]>;
    /**
     * Export route recommendations for GeoJSON from export-ready table
     */
    exportRouteRecommendationsForGeoJSON(): Promise<any[]>;
    /**
     * Export all data for GeoJSON
     */
    exportAllDataForGeoJSON(): Promise<ExportData>;
    /**
     * Export trail segments only (for trails-only export)
     */
    exportTrailSegmentsOnly(): Promise<any[]>;
    /**
     * Export route recommendations for both GeoJSON and SQLite strategies
     */
    exportRouteRecommendations(): Promise<any[]>;
}
//# sourceMappingURL=export-sql-helpers.d.ts.map