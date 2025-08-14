"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteDiscoveryConfigLoader = void 0;
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
const path = __importStar(require("path"));
class RouteDiscoveryConfigLoader {
    constructor() {
        this.config = null;
    }
    static getInstance() {
        if (!RouteDiscoveryConfigLoader.instance) {
            RouteDiscoveryConfigLoader.instance = new RouteDiscoveryConfigLoader();
        }
        return RouteDiscoveryConfigLoader.instance;
    }
    /**
     * Load route discovery configuration from YAML file
     */
    loadConfig(configPath) {
        if (this.config) {
            return this.config;
        }
        const configFile = configPath || path.join(process.cwd(), 'configs', 'route-discovery.config.yaml');
        try {
            const fileContents = fs.readFileSync(configFile, 'utf8');
            const yamlConfig = yaml.load(fileContents);
            this.config = {
                enabled: yamlConfig.enabled || false,
                routing: {
                    spatialTolerance: yamlConfig.routing?.spatialTolerance || 1.0,
                    degree2MergeTolerance: yamlConfig.routing?.degree2MergeTolerance || 2.0,
                    enableOverlapDeduplication: yamlConfig.routing?.enableOverlapDeduplication !== false,
                    enableDegree2Merging: yamlConfig.routing?.enableDegree2Merging !== false,
                    minTrailLengthMeters: yamlConfig.routing?.minTrailLengthMeters || 0.0,
                    minDistanceBetweenRoutes: yamlConfig.routing?.minDistanceBetweenRoutes || 1000, // Default to 1000 meters
                    kspKValue: yamlConfig.routing?.kspKValue || 1.0
                },
                trailGapFilling: {
                    toleranceMeters: yamlConfig.trailGapFilling?.toleranceMeters || 5.0,
                    maxConnectors: yamlConfig.trailGapFilling?.maxConnectors || 100,
                    minConnectorLengthMeters: yamlConfig.trailGapFilling?.minConnectorLengthMeters || 1.0
                },
                discovery: {
                    maxRoutesPerBin: yamlConfig.discovery?.maxRoutesPerBin || 10,
                    minRouteScore: yamlConfig.discovery?.minRouteScore || 0.3,
                    minRouteDistanceKm: yamlConfig.discovery?.minRouteDistanceKm || 1.0,
                    minElevationGainMeters: yamlConfig.discovery?.minElevationGainMeters || 10,
                    maxRouteDistanceKm: yamlConfig.discovery?.maxRouteDistanceKm || 20.0,
                    maxElevationGainMeters: yamlConfig.discovery?.maxElevationGainMeters || 5000
                },
                scoring: {
                    distanceWeight: yamlConfig.scoring?.distanceWeight || 0.4,
                    elevationWeight: yamlConfig.scoring?.elevationWeight || 0.3,
                    qualityWeight: yamlConfig.scoring?.qualityWeight || 0.3
                },
                recommendationTolerances: {
                    strict: {
                        distance: yamlConfig.recommendationTolerances?.strict?.distance || 20,
                        elevation: yamlConfig.recommendationTolerances?.strict?.elevation || 20,
                        quality: yamlConfig.recommendationTolerances?.strict?.quality || 1.0
                    },
                    medium: {
                        distance: yamlConfig.recommendationTolerances?.medium?.distance || 50,
                        elevation: yamlConfig.recommendationTolerances?.medium?.elevation || 50,
                        quality: yamlConfig.recommendationTolerances?.medium?.quality || 0.8
                    },
                    wide: {
                        distance: yamlConfig.recommendationTolerances?.wide?.distance || 100,
                        elevation: yamlConfig.recommendationTolerances?.wide?.elevation || 100,
                        quality: yamlConfig.recommendationTolerances?.wide?.quality || 0.6
                    },
                    custom: {
                        distance: yamlConfig.recommendationTolerances?.custom?.distance || 30,
                        elevation: yamlConfig.recommendationTolerances?.custom?.elevation || 40,
                        quality: yamlConfig.recommendationTolerances?.custom?.quality || 0.9
                    }
                },
                trailheads: {
                    enabled: yamlConfig.trailheads?.enabled || false,
                    maxTrailheads: yamlConfig.trailheads?.maxTrailheads || 50,
                    selectionStrategy: yamlConfig.trailheads?.selectionStrategy || 'coordinates',
                    locations: yamlConfig.trailheads?.locations || [],
                    validation: {
                        minTrailheads: yamlConfig.trailheads?.validation?.minTrailheads || 1,
                        maxDistanceBetweenTrailheads: yamlConfig.trailheads?.validation?.maxDistanceBetweenTrailheads || 10.0,
                        requireParkingAccess: yamlConfig.trailheads?.validation?.requireParkingAccess || false
                    }
                },
                routeGeneration: {
                    ksp: {
                        targetRoutesPerPattern: yamlConfig.routeGeneration?.ksp?.targetRoutesPerPattern || 100,
                        maxStartingNodes: yamlConfig.routeGeneration?.ksp?.maxStartingNodes || -1,
                        accumulateAcrossPatterns: yamlConfig.routeGeneration?.ksp?.accumulateAcrossPatterns !== false
                    },
                    loops: {
                        targetRoutesPerPattern: yamlConfig.routeGeneration?.loops?.targetRoutesPerPattern || 50,
                        useHawickCircuits: yamlConfig.routeGeneration?.loops?.useHawickCircuits !== false
                    },
                    general: {
                        enableScoring: yamlConfig.routeGeneration?.general?.enableScoring !== false,
                        defaultRouteScore: yamlConfig.routeGeneration?.general?.defaultRouteScore || 100,
                        enableDuplicateFiltering: yamlConfig.routeGeneration?.general?.enableDuplicateFiltering === true
                    }
                }
            };
            console.log(`🔍 DEBUG: Loaded trailhead config:`, {
                enabled: this.config.trailheads.enabled,
                maxTrailheads: this.config.trailheads.maxTrailheads,
                selectionStrategy: this.config.trailheads.selectionStrategy,
                locationsCount: this.config.trailheads.locations?.length || 0,
                locations: this.config.trailheads.locations
            });
            console.log('✅ Route discovery configuration loaded successfully');
            console.log(`📁 Config file: ${configFile}`);
            console.log(`🎯 Recommendation tolerances: strict(${this.config.recommendationTolerances.strict.distance}%), medium(${this.config.recommendationTolerances.medium.distance}%), wide(${this.config.recommendationTolerances.wide.distance}%)`);
            return this.config;
        }
        catch (error) {
            console.error(`❌ Failed to load route discovery config from ${configFile}:`, error);
            throw new Error(`Failed to load route discovery configuration: ${error}`);
        }
    }
    /**
     * Get recommendation tolerance levels from config
     */
    getRecommendationTolerances() {
        const config = this.loadConfig();
        return config.recommendationTolerances;
    }
    /**
     * Get specific tolerance level
     */
    getToleranceLevel(level) {
        const tolerances = this.getRecommendationTolerances();
        return tolerances[level];
    }
    /**
     * Reset configuration (useful for testing)
     */
    reset() {
        this.config = null;
    }
}
exports.RouteDiscoveryConfigLoader = RouteDiscoveryConfigLoader;
//# sourceMappingURL=route-discovery-config-loader.js.map