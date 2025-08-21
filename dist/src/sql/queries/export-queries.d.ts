export declare const ExportQueries: {
    createExportReadyTables: (schemaName: string) => string;
    createExportTrailVerticesTable: (schemaName: string) => string;
    createExportEdgesTable: (schemaName: string, includeCompositionData?: boolean) => string;
    getExportNodes: (schemaName: string) => string;
    getExportTrailVertices: (schemaName: string) => string;
    getExportEdges: (schemaName: string) => string;
    getExportRoutes: (schemaName: string) => string;
    getTrailsForExport: (schemaName: string) => string;
    exportRoutingNodesForGeoJSON: (schemaName: string) => string;
    exportRoutingNodesForSQLite: (schemaName: string) => string;
    exportTrailVerticesForGeoJSON: (schemaName: string) => string;
    getRoutingEdgesForExport: (schemaName: string) => string;
    getRouteRecommendationsForExport: (schemaName: string) => string;
    getRoutingNodesForExportWithFallbacks: (schemaName: string) => string;
    getRoutingEdgesForExportWithDistance: (schemaName: string) => string;
    checkRouteRecommendationsExist: (schemaName: string) => string;
    getExportStats: (schemaName: string) => string;
    getNetworkStatistics: (schemaName: string) => string;
};
//# sourceMappingURL=export-queries.d.ts.map