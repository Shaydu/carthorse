export interface RecommendationTolerance {
    distance: number;
    elevation: number;
    quality: number;
}
export interface RecommendationTolerances {
    strict: RecommendationTolerance;
    medium: RecommendationTolerance;
    wide: RecommendationTolerance;
    custom: RecommendationTolerance;
}
export interface TrailheadLocation {
    name: string;
    lat: number;
    lng: number;
    tolerance_meters?: number;
}
export interface RouteDiscoveryConfig {
    enabled: boolean;
    routing: {
        intersectionTolerance: number;
        edgeTolerance: number;
        defaultTolerance: number;
        minTrailLengthMeters: number;
        minDistanceBetweenRoutes: number;
        kspKValue: number;
    };
    discovery: {
        maxRoutesPerBin: number;
        minRouteScore: number;
        minRouteDistanceKm: number;
        minElevationGainMeters: number;
        maxRouteDistanceKm: number;
        maxElevationGainMeters: number;
    };
    scoring: {
        distanceWeight: number;
        elevationWeight: number;
        qualityWeight: number;
    };
    recommendationTolerances: RecommendationTolerances;
    trailheads: {
        enabled: boolean;
        maxTrailheads: number;
        selectionStrategy: string;
        locations?: TrailheadLocation[];
        validation: {
            minTrailheads: number;
            maxDistanceBetweenTrailheads: number;
            requireParkingAccess: boolean;
        };
    };
    routeGeneration?: {
        ksp: {
            targetRoutesPerPattern: number;
            maxStartingNodes: number;
            accumulateAcrossPatterns: boolean;
        };
        loops: {
            targetRoutesPerPattern: number;
            useHawickCircuits: boolean;
        };
        general: {
            enableScoring: boolean;
            defaultRouteScore: number;
            enableDuplicateFiltering: boolean;
        };
    };
}
export declare class RouteDiscoveryConfigLoader {
    private static instance;
    private config;
    private constructor();
    static getInstance(): RouteDiscoveryConfigLoader;
    /**
     * Load route discovery configuration from YAML file
     */
    loadConfig(configPath?: string): RouteDiscoveryConfig;
    /**
     * Get recommendation tolerance levels from config
     */
    getRecommendationTolerances(): RecommendationTolerances;
    /**
     * Get specific tolerance level
     */
    getToleranceLevel(level: 'strict' | 'medium' | 'wide' | 'custom'): RecommendationTolerance;
    /**
     * Reset configuration (useful for testing)
     */
    reset(): void;
}
//# sourceMappingURL=route-discovery-config-loader.d.ts.map