export declare const GLOBAL_CONFIG: {
    readonly elevation: {
        readonly precision: number;
        readonly defaultPrecision: 2;
        readonly maxPrecision: 6;
        readonly minPrecision: 0;
    };
    readonly distance: {
        readonly precision: number;
        readonly defaultPrecision: 3;
        readonly maxPrecision: 6;
        readonly minPrecision: 1;
    };
    readonly coordinates: {
        readonly precision: number;
        readonly defaultPrecision: 6;
        readonly maxPrecision: 8;
        readonly minPrecision: 4;
    };
    readonly spatial: {
        readonly intersectionTolerance: number;
        readonly edgeTolerance: number;
        readonly simplifyTolerance: 0;
    };
    readonly database: {
        readonly defaultSchema: "public";
        readonly stagingSchemaPrefix: "staging_";
        readonly maxStagingSchemasToKeep: 2;
    };
    readonly processing: {
        readonly batchSize: number;
        readonly timeoutMs: number;
        readonly logLevel: string;
        readonly verbose: boolean;
    };
    readonly export: {
        readonly maxSqliteDbSizeMB: 400;
        readonly defaultSimplifyTolerance: 0.001;
        readonly defaultIntersectionTolerance: 2;
    };
    readonly validation: {
        readonly skipIncompleteTrails: true;
        readonly skipValidation: false;
        readonly skipBboxValidation: false;
        readonly skipGeometryValidation: false;
        readonly skipTrailValidation: false;
    };
    readonly cleanup: {
        readonly aggressiveCleanup: true;
        readonly cleanupOldStagingSchemas: true;
        readonly cleanupTempFiles: true;
        readonly cleanupDatabaseLogs: false;
        readonly cleanupOnError: false;
    };
};
export declare const configHelpers: {
    /**
     * Get elevation precision with validation
     */
    getElevationPrecision(): number;
    /**
     * Round elevation value to configured precision
     */
    roundElevation(elevation: number): number;
    /**
     * Get distance precision with validation
     */
    getDistancePrecision(): number;
    /**
     * Round distance/length value to configured precision
     */
    roundDistance(distance: number): number;
    /**
     * Get coordinate precision with validation
     */
    getCoordinatePrecision(): number;
    /**
     * Round coordinate value to configured precision
     */
    roundCoordinate(coordinate: number): number;
    /**
     * Format elevation value with proper precision
     */
    formatElevation(elevation: number): string;
    /**
     * Get spatial tolerance with validation
     */
    getSpatialTolerance(type: "intersection" | "edge"): number;
    /**
     * Check if verbose logging is enabled
     */
    isVerbose(): boolean;
    /**
     * Get processing batch size
     */
    getBatchSize(): number;
    /**
     * Get processing timeout
     */
    getTimeoutMs(): number;
};
export interface GlobalConfig {
    elevation: {
        precision: number;
        defaultPrecision: number;
        maxPrecision: number;
        minPrecision: number;
    };
    distance: {
        precision: number;
        defaultPrecision: number;
        maxPrecision: number;
        minPrecision: number;
    };
    coordinates: {
        precision: number;
        defaultPrecision: number;
        maxPrecision: number;
        minPrecision: number;
    };
    spatial: {
        intersectionTolerance: number;
        edgeTolerance: number;
        simplifyTolerance: number;
    };
    database: {
        defaultSchema: string;
        stagingSchemaPrefix: string;
        maxStagingSchemasToKeep: number;
    };
    processing: {
        batchSize: number;
        timeoutMs: number;
        logLevel: string;
        verbose: boolean;
    };
    export: {
        maxSqliteDbSizeMB: number;
        defaultSimplifyTolerance: number;
        defaultIntersectionTolerance: number;
    };
    validation: {
        skipIncompleteTrails: boolean;
        skipValidation: boolean;
        skipBboxValidation: boolean;
        skipGeometryValidation: boolean;
        skipTrailValidation: boolean;
    };
    cleanup: {
        aggressiveCleanup: boolean;
        cleanupOldStagingSchemas: boolean;
        cleanupTempFiles: boolean;
        cleanupDatabaseLogs: boolean;
        cleanupOnError: boolean;
    };
}
//# sourceMappingURL=carthorse.global.config.d.ts.map