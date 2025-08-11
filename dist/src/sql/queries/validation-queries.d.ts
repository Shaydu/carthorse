export declare const ValidationQueries: {
    checkSchemaVersion: () => string;
    checkRequiredFunctions: (requiredFunctions: string[]) => string;
    checkRequiredTables: (requiredTables: string[]) => string;
    checkDataAvailability: (region: string, bbox?: [number, number, number, number]) => {
        query: string;
        params: any[];
    };
    getAvailableRegions: () => string;
    validateTrailData: (schemaName: string) => string;
    validateBboxData: (schemaName: string) => string;
    validateGeometryData: (schemaName: string) => string;
    validateRoutingNetwork: (schemaName: string) => string;
    checkOrphanedNodes: (schemaName: string) => string;
    checkOrphanedEdges: (schemaName: string) => string;
    getTrailDetailsForDebugging: (schemaName: string, limit?: number) => string;
    checkPostgisExtension: () => string;
    checkSchemaExists: (schemaName: string) => string;
    checkTableExists: (schemaName: string, tableName: string) => string;
};
//# sourceMappingURL=validation-queries.d.ts.map