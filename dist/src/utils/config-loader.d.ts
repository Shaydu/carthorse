export interface CarthorseConfig {
    version: string;
    cliVersion: string;
    database: {
        connection: {
            host: string;
            port: number;
            user: string;
            password: string;
            database: string;
        };
        environments: {
            development: {
                host: string;
                port: number;
                user: string;
                password: string;
                database: string;
            };
            test: {
                host: string;
                port: number;
                user: string;
                password: string;
                database: string;
            };
            production: {
                host: string;
                port: number;
                user: string;
                password: string;
                database: string;
            };
        };
        pool: {
            max: number;
            idleTimeoutMillis: number;
            connectionTimeoutMillis: number;
        };
        timeouts: {
            connectionTimeout: number;
            queryTimeout: number;
        };
    };
    constants: {
        carthorseVersion: string;
        supportedRegions: string[];
        supportedEnvironments: string[];
        databaseSchemas: {
            master: string;
            stagingPrefix: string;
            osmPrefix: string;
        };
        validationThresholds: {
            minTrailLengthKm: number;
            maxTrailLengthKm: number;
            minElevationM: number;
            maxElevationM: number;
            minCoordinatePoints: number;
            maxCoordinatePoints: number;
        };
        exportSettings: {
            defaultSimplifyTolerance: number;
            defaultMaxDbSizeMb: number;
            defaultTargetSizeMb: number;
        };
        gapFixing?: {
            enabled: boolean;
            minGapDistanceMeters: number;
            maxGapDistanceMeters: number;
        };
    };
    postgis: any;
    sqlite: any;
    validation: any;
    export?: {
        geojson?: {
            layers?: {
                trails?: boolean;
                edges?: boolean;
                endpoints?: boolean;
                routes?: boolean;
            };
            styling?: {
                trails?: {
                    color?: string;
                    stroke?: string;
                    strokeWidth?: number;
                    fillOpacity?: number;
                };
                edges?: {
                    color?: string;
                    stroke?: string;
                    strokeWidth?: number;
                    fillOpacity?: number;
                };
                endpoints?: {
                    color?: string;
                    stroke?: string;
                    strokeWidth?: number;
                    fillOpacity?: number;
                    radius?: number;
                };
                routes?: {
                    color?: string;
                    stroke?: string;
                    strokeWidth?: number;
                    fillOpacity?: number;
                };
            };
        };
    };
}
export interface RouteDiscoveryConfig {
    enabled: boolean;
    routing: {
        intersectionTolerance: number;
        edgeTolerance: number;
        defaultTolerance: number;
        minTrailLengthMeters: number;
    };
    binConfiguration: any;
    discovery: any;
    scoring: any;
    costWeighting: any;
}
/**
 * Load the Carthorse configuration from YAML file
 */
export declare function loadConfig(): CarthorseConfig;
/**
 * Load the route discovery configuration from YAML file
 */
export declare function loadRouteDiscoveryConfig(): RouteDiscoveryConfig;
/**
 * Get constants from the configuration
 */
export declare function getConstants(): {
    carthorseVersion: string;
    supportedRegions: string[];
    supportedEnvironments: string[];
    databaseSchemas: {
        master: string;
        stagingPrefix: string;
        osmPrefix: string;
    };
    validationThresholds: {
        minTrailLengthKm: number;
        maxTrailLengthKm: number;
        minElevationM: number;
        maxElevationM: number;
        minCoordinatePoints: number;
        maxCoordinatePoints: number;
    };
    exportSettings: {
        defaultSimplifyTolerance: number;
        defaultMaxDbSizeMb: number;
        defaultTargetSizeMb: number;
    };
    gapFixing?: {
        enabled: boolean;
        minGapDistanceMeters: number;
        maxGapDistanceMeters: number;
    };
};
/**
 * Get specific constant values
 */
export declare function getSupportedRegions(): string[];
export declare function getSupportedEnvironments(): string[];
export declare function getDatabaseSchemas(): {
    master: string;
    stagingPrefix: string;
    osmPrefix: string;
};
export declare function getValidationThresholds(): {
    minTrailLengthKm: number;
    maxTrailLengthKm: number;
    minElevationM: number;
    maxElevationM: number;
    minCoordinatePoints: number;
    maxCoordinatePoints: number;
};
export declare function getTolerances(): {
    intersectionTolerance: number;
    edgeTolerance: number;
    minTrailLengthMeters: number;
};
export declare function getExportSettings(): {
    defaultSimplifyTolerance: number;
    defaultMaxDbSizeMb: number;
    defaultTargetSizeMb: number;
};
/**
 * Get pgRouting tolerance settings from config
 */
export declare function getPgRoutingTolerances(): any;
/**
 * Bridging configuration defaults used by network creation pipeline.
 * Env vars override YAML; YAML overrides hard defaults.
 */
export declare function getBridgingConfig(): {
    trailBridgingEnabled: boolean;
    edgeBridgingEnabled: boolean;
    trailBridgingToleranceMeters: number;
    edgeSnapToleranceMeters: number;
    shortConnectorMaxLengthMeters: number;
    geometrySimplification: {
        simplificationToleranceDegrees: number;
        minPointsForSimplification: number;
    };
};
/**
 * Route generation feature flags defaults.
 * Env vars override YAML; YAML overrides hard defaults.
 */
export declare function getRouteGenerationFlags(): {
    dedupExactOnly: any;
    coalesceSameNameEdges: any;
};
/**
 * Get database configuration with environment variable overrides
 */
export declare function getDatabaseConfig(environment?: string): {
    host: any;
    port: number;
    user: any;
    password: any;
    database: any;
    pool: {
        max: number;
        idleTimeoutMillis: number;
        connectionTimeoutMillis: number;
    };
    timeouts: {
        connectionTimeout: number;
        queryTimeout: number;
    };
};
/**
 * Get database connection string
 */
export declare function getDatabaseConnectionString(environment?: string): string;
/**
 * Get pool configuration for database connections
 */
export declare function getDatabasePoolConfig(environment?: string): {
    host: any;
    port: number;
    user: any;
    password: any;
    database: any;
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
};
/**
 * Get export configuration from carthorse config
 */
export declare function getExportConfig(): {
    geojson?: {
        layers?: {
            trails?: boolean;
            edges?: boolean;
            endpoints?: boolean;
            routes?: boolean;
        };
        styling?: {
            trails?: {
                color?: string;
                stroke?: string;
                strokeWidth?: number;
                fillOpacity?: number;
            };
            edges?: {
                color?: string;
                stroke?: string;
                strokeWidth?: number;
                fillOpacity?: number;
            };
            endpoints?: {
                color?: string;
                stroke?: string;
                strokeWidth?: number;
                fillOpacity?: number;
                radius?: number;
            };
            routes?: {
                color?: string;
                stroke?: string;
                strokeWidth?: number;
                fillOpacity?: number;
            };
        };
    };
};
//# sourceMappingURL=config-loader.d.ts.map