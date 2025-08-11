import { Pool, Client } from 'pg';
export interface GeometryPreprocessingConfig {
    schemaName: string;
    tableName?: string;
    region?: string;
    bbox?: [number, number, number, number];
    maxPasses?: number;
    minLengthMeters?: number;
    tolerance?: number;
}
export interface GeometryPreprocessingResult {
    success: boolean;
    initialCount: number;
    finalCount: number;
    droppedCount: number;
    passes: number;
    errors: string[];
    summary: {
        invalidGeometries: number;
        nonSimpleGeometries: number;
        emptyGeometries: number;
        tooShortGeometries: number;
        duplicateGeometries: number;
        complexGeometries: number;
    };
}
export declare class GeometryPreprocessor {
    private pgClient;
    constructor(pgClient: Pool | Client);
    /**
     * Preprocess trail geometries to ensure they are simple, valid, and non-duplicated.
     * This function can be called repeatedly until no more changes occur.
     */
    preprocessTrailGeometries(config: GeometryPreprocessingConfig): Promise<GeometryPreprocessingResult>;
    /**
     * Perform a single pass of geometry cleanup
     */
    private performGeometryCleanupPass;
    /**
     * Validate that all geometries in a table are clean and ready for routing
     */
    validateGeometryCleanliness(schemaName: string, tableName?: string): Promise<{
        isValid: boolean;
        issues: string[];
        summary: {
            total: number;
            valid: number;
            simple: number;
            nonEmpty: number;
            lineStrings: number;
            reasonableLength: number;
        };
    }>;
}
/**
 * Create a GeometryPreprocessor instance
 */
export declare function createGeometryPreprocessor(pgClient: Pool | Client): GeometryPreprocessor;
//# sourceMappingURL=geometry-preprocessing.d.ts.map