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
     * Export trail data for GeoJSON
     */
    exportTrailsForGeoJSON(): Promise<any[]>;
    /**
     * Export routing nodes for GeoJSON
     */
    exportRoutingNodesForGeoJSON(): Promise<any[]>;
    /**
     * Export routing edges for GeoJSON (reads directly from ways_noded - single source of truth)
     */
    exportRoutingEdgesForGeoJSON(): Promise<any[]>;
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