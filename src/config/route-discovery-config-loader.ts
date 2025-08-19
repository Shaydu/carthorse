import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

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
    unifiedNetwork?: {
      enabled: boolean;
      elevationGainRateWeight: number;
      distanceWeight: number;
      maxLoopSearchDistance: number;
    };
    ksp: {
      enabled: boolean;
      targetRoutesPerPattern: number;
      maxStartingNodes: number;
      accumulateAcrossPatterns: boolean;
      dedupeThreshold: number;
    };
    loops: {
      enabled: boolean;
      targetRoutesPerPattern: number;
      useHawickCircuits: boolean;
      hawickMaxRows?: number;
      dedupeThreshold: number;
    };
    lollipops: {
      enabled: boolean;
      targetRoutesPerPattern: number;
      minLollipopDistance: number;
      maxLollipopDistance: number;
      dedupeThreshold: number;
    };
    general: {
      enableScoring: boolean;
      defaultRouteScore: number;
      enableDuplicateFiltering: boolean;
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

export class RouteDiscoveryConfigLoader {
  private static instance: RouteDiscoveryConfigLoader;
  private config: RouteDiscoveryConfig | null = null;

  private constructor() {}

  static getInstance(): RouteDiscoveryConfigLoader {
    if (!RouteDiscoveryConfigLoader.instance) {
      RouteDiscoveryConfigLoader.instance = new RouteDiscoveryConfigLoader();
    }
    return RouteDiscoveryConfigLoader.instance;
  }

  /**
   * Load route discovery configuration from YAML file
   */
  loadConfig(configPath?: string): RouteDiscoveryConfig {
    if (this.config) {
      return this.config;
    }

    const configFile = configPath || path.join(process.cwd(), 'configs', 'layer3-routing.config.yaml');
    
    try {
      const fileContents = fs.readFileSync(configFile, 'utf8');
      const yamlConfig = yaml.load(fileContents) as any;
      
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
            enabled: yamlConfig.routeGeneration?.ksp?.enabled !== false,
            targetRoutesPerPattern: yamlConfig.routeGeneration?.ksp?.targetRoutesPerPattern || 100,
            maxStartingNodes: yamlConfig.routeGeneration?.ksp?.maxStartingNodes || -1,
            accumulateAcrossPatterns: yamlConfig.routeGeneration?.ksp?.accumulateAcrossPatterns !== false,
            dedupeThreshold: yamlConfig.routeGeneration?.ksp?.dedupeThreshold
          },
          loops: {
            enabled: yamlConfig.routeGeneration?.loops?.enabled !== false,
            targetRoutesPerPattern: yamlConfig.routeGeneration?.loops?.targetRoutesPerPattern || 50,
            useHawickCircuits: yamlConfig.routeGeneration?.loops?.useHawickCircuits !== false,
            dedupeThreshold: yamlConfig.routeGeneration?.loops?.dedupeThreshold
          },
          lollipops: {
            enabled: yamlConfig.routeGeneration?.lollipops?.enabled !== false,
            targetRoutesPerPattern: yamlConfig.routeGeneration?.lollipops?.targetRoutesPerPattern || 20,
            minLollipopDistance: yamlConfig.routeGeneration?.lollipops?.minLollipopDistance || 3.0,
            maxLollipopDistance: yamlConfig.routeGeneration?.lollipops?.maxLollipopDistance || 20.0,
            dedupeThreshold: yamlConfig.routeGeneration?.lollipops?.dedupeThreshold
          },
          general: {
            enableScoring: yamlConfig.routeGeneration?.general?.enableScoring !== false,
            defaultRouteScore: yamlConfig.routeGeneration?.general?.defaultRouteScore || 100,
            enableDuplicateFiltering: yamlConfig.routeGeneration?.general?.enableDuplicateFiltering === true
          }
        },

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
    } catch (error) {
      console.error(`❌ Failed to load route discovery config from ${configFile}:`, error);
      throw new Error(`Failed to load route discovery configuration: ${error}`);
    }
  }

  /**
   * Get recommendation tolerance levels from config
   */
  getRecommendationTolerances(): RecommendationTolerances {
    const config = this.loadConfig();
    return config.recommendationTolerances;
  }

  /**
   * Get specific tolerance level
   */
  getToleranceLevel(level: 'strict' | 'medium' | 'wide' | 'custom'): RecommendationTolerance {
    const tolerances = this.getRecommendationTolerances();
    return tolerances[level];
  }

  /**
   * Reset configuration (useful for testing)
   */
  reset(): void {
    this.config = null;
  }
} 