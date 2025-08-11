export interface BBox {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
}
export type BBoxOrNull = BBox | null;
export declare const StagingQueries: {
    createSchema: (schemaName: string) => string;
    copyTrails: (sourceSchema: string, targetSchema: string, region: string, bbox?: BBoxOrNull) => string;
    validateStagingData: (schemaName: string) => string;
    validateTrailsForRouting: (schemaName: string) => string;
    checkSchemaExists: (schemaName: string) => string;
    getTrailCount: (schemaName: string) => string;
    getNodeCount: (schemaName: string) => string;
    getEdgeCount: (schemaName: string) => string;
    getIntersectionPointCount: (schemaName: string) => string;
    cleanupSchema: (schemaName: string) => string;
    getTrailDetails: (schemaName: string, limit?: number) => string;
};
//# sourceMappingURL=staging-queries.d.ts.map