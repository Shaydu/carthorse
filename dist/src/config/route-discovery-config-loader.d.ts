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
        spatialTolerance: number;
        degree2MergeTolerance: number;
        enableOverlapDeduplication: boolean;
        enableDegree2Merging: boolean;
        minTrailLengthMeters: number;
        minDistanceBetweenRoutes: number;
        kspKValue: number;
    };
    trailGapFilling: {
        toleranceMeters: number;
        maxConnectors: number;
        minConnectorLengthMeters: number;
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
        autoCreateEndpoints: boolean;
        maxTrailheads: number;
        locations?: TrailheadLocation[];
        validation: {
            minTrailheads: number;
            maxDistanceBetweenTrailheads: number;
            requireParkingAccess: boolean;
        };
    };
    routeGeneration?: {
        enabled?: {
            outAndBack: boolean;
            loops: boolean;
            pointToPoint: boolean;
        };
        unifiedNetwork?: {
            enabled: boolean;
            elevationGainRateWeight: number;
            distanceWeight: number;
            maxLoopSearchDistance: number;
        };
        ksp: {
            targetRoutesPerPattern: number;
            maxStartingNodes: number;
        };
        loops: {
            targetRoutesPerPattern: number;
            useHawickCircuits: boolean;
            hawickMaxRows?: number;
        };
    };
    costWeighting?: {
        steepnessWeight: number;
        distanceWeight: number;
        enhancedCostRouting?: {
            enabled: boolean;
            priorityWeights: {
                elevation: number;
                distance: number;
                shape: number;
            };
            elevationCost: {
                deviationWeight: number;
                deviationExponent: number;
            };
            distanceCost: {
                deviationWeight: number;
                deviationExponent: number;
            };
        };
        routingModes?: {
            standard?: {
                enabled: boolean;
                orderDirection: string;
                steepnessWeight: number;
                distanceWeight: number;
            };
            elevationFocused?: {
                enabled: boolean;
                orderDirection: string;
                steepnessWeight: number;
                distanceWeight: number;
            };
            distanceFocused?: {
                enabled: boolean;
                orderDirection: string;
                steepnessWeight: number;
                distanceWeight: number;
            };
            balanced?: {
                enabled: boolean;
                orderDirection: string;
                steepnessWeight: number;
                distanceWeight: number;
            };
            enhancedPreference?: {
                enabled: boolean;
                orderDirection: string;
                useEnhancedPreferenceCalculation: boolean;
                priorityWeights: {
                    elevation: number;
                    distance: number;
                    shape: number;
                };
            };
            userPreferenceMatching?: {
                enabled: boolean;
                orderDirection: string;
                usePreferenceMatching: boolean;
                dynamicWeights: {
                    elevationGainRate: number;
                    distance: number;
                    routeShape: number;
                };
            };
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