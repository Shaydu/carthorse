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

    const configFile = configPath || path.join(process.cwd(), 'configs', 'route-discovery.config.yaml');
    
    try {
      const fileContents = fs.readFileSync(configFile, 'utf8');
      const yamlConfig = yaml.load(fileContents) as any;
      
      this.config = {
        enabled: yamlConfig.enabled || false,
        routing: {
          intersectionTolerance: yamlConfig.routing?.intersectionTolerance || 1.0,
          edgeTolerance: yamlConfig.routing?.edgeTolerance || 1.0,
          defaultTolerance: yamlConfig.routing?.defaultTolerance || 1.0,
          minTrailLengthMeters: yamlConfig.routing?.minTrailLengthMeters || 0.0,
          minDistanceBetweenRoutes: yamlConfig.routing?.minDistanceBetweenRoutes || 1000, // Default to 1000 meters
          kspKValue: yamlConfig.routing?.kspKValue || 1.0
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
        }
      };

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