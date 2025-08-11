export declare const CleanupQueries: {
    cleanupStagingSchema: (schemaName: string) => string;
    findAllStagingSchemas: () => string;
    cleanupAllStagingSchemas: () => string;
    cleanupOrphanedNodes: (schemaName: string) => string;
    cleanupOrphanedEdges: (schemaName: string) => string;
    clearRoutingNodes: (schemaName: string) => string;
    clearRoutingEdges: (schemaName: string) => string;
    clearIntersectionPoints: (schemaName: string) => string;
    clearTrailHashes: (schemaName: string) => string;
    clearRouteRecommendations: (schemaName: string) => string;
    clearAllStagingData: (schemaName: string) => string;
    findTestDatabases: () => string;
    dropTestDatabase: (databaseName: string) => string;
    findSqliteTestFiles: () => string;
};
//# sourceMappingURL=cleanup-queries.d.ts.map