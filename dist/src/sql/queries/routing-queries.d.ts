export declare const RoutingQueries: {
    detectIntersections: (schemaName: string, tolerance: number) => string;
    generateNodes: (schemaName: string, tolerance: number) => string;
    generateEdges: (schemaName: string, tolerance: number) => string;
    validateNetwork: (schemaName: string) => string;
    cleanupOrphanedNodes: (schemaName: string) => string;
    cleanupOrphanedEdges: (schemaName: string) => string;
    getNodeTypeBreakdown: (schemaName: string) => string;
    checkIsolatedNodes: (schemaName: string) => string;
    checkOrphanedEdges: (schemaName: string) => string;
};
//# sourceMappingURL=routing-queries.d.ts.map