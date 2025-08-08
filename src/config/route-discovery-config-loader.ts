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

export type CorridorMode = 'bbox' | 'polyline-buffer';

export interface CorridorConfig {
  enabled: boolean;
  mode?: CorridorMode;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  polyline?: Array<[number, number]>; // [[lng, lat], ...]
  bufferMeters?: number; // for polyline-buffer
}

export interface BridgingConfig {}

export interface RouteDiscoveryConfig {
  enabled: boolean;
  routing: {
    intersectionTolerance: number;
    edgeTolerance: number;
    defaultTolerance: number;
    minTrailLengthMeters: number;
    minDistanceBetweenRoutes: number;
    statementTimeoutMs?: number;
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
  corridor?: CorridorConfig;
  bridging?: BridgingConfig;
  algorithms?: {
    ksp?: { enabled?: boolean; k?: number };
    dijkstra?: { enabled?: boolean };
    bdAstar?: { enabled?: boolean; heuristic?: string };
    drivingDistance?: { enabled?: boolean; maxMeters?: number };
  };
  parallelism?: { algorithmWorkers?: number; pairWorkers?: number };
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
          statementTimeoutMs: yamlConfig.routing?.statementTimeoutMs || yamlConfig.discovery?.routeTimeoutMs || 30000
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
        },
        corridor: {
          enabled: Boolean(yamlConfig.corridor?.enabled) || false,
          mode: (yamlConfig.corridor?.mode as CorridorMode) || 'bbox',
          bbox: yamlConfig.corridor?.bbox,
          polyline: yamlConfig.corridor?.polyline,
          bufferMeters: yamlConfig.corridor?.bufferMeters || 200
        },
        bridging: {},
        algorithms: {
          ksp: { enabled: yamlConfig.algorithms?.ksp?.enabled !== false, k: yamlConfig.algorithms?.ksp?.k || 3 },
          dijkstra: { enabled: yamlConfig.algorithms?.dijkstra?.enabled !== false },
          bdAstar: { enabled: yamlConfig.algorithms?.bdAstar?.enabled === true, heuristic: yamlConfig.algorithms?.bdAstar?.heuristic || 'euclidean' },
          drivingDistance: { enabled: yamlConfig.algorithms?.drivingDistance?.enabled === true, maxMeters: yamlConfig.algorithms?.drivingDistance?.maxMeters || 8000 }
        },
        parallelism: {
          algorithmWorkers: yamlConfig.parallelism?.algorithmWorkers || 3,
          pairWorkers: yamlConfig.parallelism?.pairWorkers || 4
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