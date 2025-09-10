import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

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
  layer1_trails?: any;
  layer2_edges?: any;
  layer3_routing?: {
    pgrouting?: {
      intersectionDetectionTolerance: number;
      edgeToVertexTolerance: number;
      graphAnalysisTolerance: number;
      trueLoopTolerance: number;
      minTrailLengthMeters: number;
      maxTrailLengthMeters: number;
    };
    routeGeneration?: {
      enabled?: {
        outAndBack: boolean;
        loops: boolean;
        pointToPoint: boolean;
        lollipops: boolean;
      };
      lollipops?: {
        targetDistance: number;
        maxAnchorNodes: number;
        maxReachableNodes: number;
        maxDestinationExploration: number;
        distanceRangeMin: number;
        distanceRangeMax: number;
        edgeOverlapThreshold: number;
        kspPaths: number;
        minOutboundDistance: number;
      };
    };
  };
  export?: {
    geojson?: {
      combinedLayerExport?: boolean;  // Create combined file with all layers
      layers?: {
        trails?: boolean;
        edges?: boolean;
        edgeNetworkVertices?: boolean;
        trailVertices?: boolean;
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
        edgeNetworkVertices?: {
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
    spatialTolerance: number;
    degree2MergeTolerance: number;
    minTrailLengthMeters: number;
  };
  binConfiguration: any;
  discovery: any;
  scoring: any;
  costWeighting: any;
}

let configCache: CarthorseConfig | null = null;
let routeConfigCache: RouteDiscoveryConfig | null = null;

/**
 * Load the Carthorse configuration from YAML file
 */
export function loadConfig(): CarthorseConfig {
  if (configCache) {
    return configCache;
  }

  const configPath = path.join(process.cwd(), 'configs/carthorse.config.yaml');
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent) as CarthorseConfig;
    
    // Load and merge layer-specific configurations
    const layer1ConfigPath = path.join(process.cwd(), 'configs/layer1-trail.config.yaml');
    const layer2ConfigPath = path.join(process.cwd(), 'configs/layer2-node-edge.config.yaml');
    const layer3ConfigPath = path.join(process.cwd(), 'configs/layer3-routing.config.yaml');
    
    // Load Layer 1 config
    if (fs.existsSync(layer1ConfigPath)) {
      const layer1File = fs.readFileSync(layer1ConfigPath, 'utf8');
      const layer1Config = yaml.load(layer1File) as any;
      if (layer1Config?.layer1_trails) {
        (config as any).layer1_trails = layer1Config.layer1_trails;
      }
    }
    
    // Load Layer 2 config
    if (fs.existsSync(layer2ConfigPath)) {
      const layer2File = fs.readFileSync(layer2ConfigPath, 'utf8');
      const layer2Config = yaml.load(layer2File) as any;
      if (layer2Config?.layer2_edges) {
        (config as any).layer2_edges = layer2Config.layer2_edges;
      }
    }
    
    // Load Layer 3 config
    if (fs.existsSync(layer3ConfigPath)) {
      const layer3File = fs.readFileSync(layer3ConfigPath, 'utf8');
      const layer3Config = yaml.load(layer3File) as any;
      if (layer3Config?.routing) {
        config.layer3_routing = {
          pgrouting: {
            intersectionDetectionTolerance: layer3Config.routing.spatialTolerance,
            edgeToVertexTolerance: layer3Config.routing.spatialTolerance,
            graphAnalysisTolerance: layer3Config.routing.spatialTolerance * 0.25, // 25% of spatial tolerance
            trueLoopTolerance: 10.0,
            minTrailLengthMeters: 0.1,
            maxTrailLengthMeters: 100000
          }
        };
      }
      if (layer3Config?.routeGeneration) {
        config.layer3_routing = {
          ...config.layer3_routing,
          routeGeneration: layer3Config.routeGeneration
        };
      }
    }
    
    configCache = config;
    return config;
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error}`);
  }
}

/**
 * Load the route discovery configuration from YAML file
 */
export function loadRouteDiscoveryConfig(): RouteDiscoveryConfig {
  if (routeConfigCache) {
    return routeConfigCache;
  }

  const configPath = path.join(process.cwd(), 'configs/layer3-routing.config.yaml');
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Route discovery configuration file not found: ${configPath}`);
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent) as RouteDiscoveryConfig;
    routeConfigCache = config;
    return config;
  } catch (error) {
    throw new Error(`Failed to load route discovery configuration: ${error}`);
  }
}

/**
 * Get constants from the configuration
 */
export function getConstants() {
  const config = loadConfig();
  return config.constants;
}

/**
 * Get specific constant values
 */
export function getSupportedRegions(): string[] {
  return getConstants().supportedRegions;
}

export function getSupportedEnvironments(): string[] {
  return getConstants().supportedEnvironments;
}

export function getDatabaseSchemas() {
  return getConstants().databaseSchemas;
}

export function getValidationThresholds() {
  return getConstants().validationThresholds;
}

/**
 * Bridging configuration defaults used by network creation pipeline.
 * Env vars override YAML; YAML overrides hard defaults.
 */
export function getBridgingConfig() {
  const config = loadConfig();
  const bridging = (config as any).layer2_edges?.bridging;
  if (!bridging) {
    throw new Error('Missing required configuration: layer2_edges.bridging');
  }
  const requiredKeys = ['trailBridgingEnabled', 'edgeBridgingEnabled', 'trailBridgingToleranceMeters', 'edgeBridgingToleranceMeters', 'edgeSnapToleranceMeters', 'shortConnectorMaxLengthMeters'];
  for (const key of requiredKeys) {
    if (!(key in bridging)) {
      throw new Error(`Missing required configuration: constants.bridging.${key}`);
    }
  }

  // Env overrides (optional)
  const trailTolEnv = process.env.BRIDGE_TOL_METERS ? parseFloat(process.env.BRIDGE_TOL_METERS) : undefined;
  const edgeTolEnv = process.env.EDGE_SNAP_TOL_METERS ? parseFloat(process.env.EDGE_SNAP_TOL_METERS) : undefined;
  const shortConnEnv = process.env.SHORT_CONNECTOR_MAX_M ? parseFloat(process.env.SHORT_CONNECTOR_MAX_M) : undefined;
  const trailEnabledEnv = process.env.PRE_BRIDGE_TRAILS;
  const edgeEnabledEnv = process.env.SNAP_TRAIL_ENDPOINTS;

  return {
    trailBridgingEnabled: trailEnabledEnv ? trailEnabledEnv === '1' : Boolean(bridging.trailBridgingEnabled),
    edgeBridgingEnabled: edgeEnabledEnv ? edgeEnabledEnv === '1' : Boolean(bridging.edgeBridgingEnabled),
    trailBridgingToleranceMeters: trailTolEnv ?? Number(bridging.trailBridgingToleranceMeters),
    edgeBridgingToleranceMeters: trailTolEnv ?? Number(bridging.edgeBridgingToleranceMeters),
    edgeSnapToleranceMeters: edgeTolEnv ?? Number(bridging.edgeSnapToleranceMeters),
    shortConnectorMaxLengthMeters: shortConnEnv ?? Number(bridging.shortConnectorMaxLengthMeters),
    geometrySimplification: bridging.geometrySimplification || {
      simplificationToleranceDegrees: 0.00001,
      minPointsForSimplification: 10
    }
  } as {
    trailBridgingEnabled: boolean;
    edgeBridgingEnabled: boolean;
    trailBridgingToleranceMeters: number;
    edgeBridgingToleranceMeters: number;
    edgeSnapToleranceMeters: number;
    shortConnectorMaxLengthMeters: number;
    geometrySimplification: {
      simplificationToleranceDegrees: number;
      minPointsForSimplification: number;
    };
  };
}

/**
 * Get consolidated tolerance configuration.
 * Env vars override YAML; YAML overrides hard defaults.
 */
export function getTolerances() {
  const { RouteDiscoveryConfigLoader } = require('../config/route-discovery-config-loader');
  const routeConfig = RouteDiscoveryConfigLoader.getInstance().loadConfig();
  const tolerances = routeConfig.routing;
  const globalConfig = loadConfig();
  
  // Allow environment variable overrides
  return {
    spatialTolerance: process.env.SPATIAL_TOLERANCE ? 
      parseFloat(process.env.SPATIAL_TOLERANCE) : tolerances.spatialTolerance,
    degree2MergeTolerance: process.env.DEGREE2_MERGE_TOLERANCE ? 
      parseFloat(process.env.DEGREE2_MERGE_TOLERANCE) : (tolerances.degree2MergeTolerance || 2.0),
    minTrailLengthMeters: process.env.MIN_TRAIL_LENGTH_METERS ? 
      parseFloat(process.env.MIN_TRAIL_LENGTH_METERS) : tolerances.minTrailLengthMeters
  };
}

export function getExportSettings() {
  const config = loadConfig();
  return config.constants.exportSettings;
}

/**
 * Get pgRouting tolerance settings from config
 */
export function getPgRoutingTolerances() {
  const config = loadConfig();
  
  if (!config.layer3_routing?.pgrouting) {
    throw new Error('❌ CRITICAL: pgRouting configuration is missing from carthorse.config.yaml. Please ensure layer3_routing.pgrouting section exists with all required tolerance values.');
  }
  
  const pgrouting = config.layer3_routing.pgrouting;
  
  // Validate that all required tolerance values are present
  const requiredFields = [
    'intersectionDetectionTolerance',
    'edgeToVertexTolerance', 
    'graphAnalysisTolerance',
    'trueLoopTolerance',
    'minTrailLengthMeters',
    'maxTrailLengthMeters'
  ];
  
  const missingFields = requiredFields.filter(field => {
    const value = (pgrouting as any)[field];
    return value === undefined || value === null;
  });
  
  if (missingFields.length > 0) {
    throw new Error(`❌ CRITICAL: Missing required pgRouting tolerance values in carthorse.config.yaml: ${missingFields.join(', ')}. Please ensure all tolerance values are explicitly configured.`);
  }
  
  return pgrouting;
}

/**
 * Route generation feature flags defaults.
 * Env vars override YAML; YAML overrides hard defaults.
 */
export function getRouteGenerationFlags() {
  const config = loadConfig();
  const flags = (config as any).generation?.flags || (config as any).constants?.generationFlags || {};
  return {
    dedupExactOnly: process.env.DEDUP_EXACT_ONLY ? process.env.DEDUP_EXACT_ONLY === '1' : (flags.dedupExactOnly ?? true),
    coalesceSameNameEdges: process.env.COALESCE_SAME_NAME_EDGES ? process.env.COALESCE_SAME_NAME_EDGES === '1' : (flags.coalesceSameNameEdges ?? true)
  };
}

/**
 * Get database configuration with environment variable overrides
 */
export function getDatabaseConfig(environment: string = 'development') {
  const config = loadConfig();
  const dbConfig = config.database;
  
  // Get environment-specific config with proper typing
  const envConfig = (dbConfig.environments as any)[environment] || dbConfig.connection;
  
  // Environment variables take precedence
  return {
    host: process.env.PGHOST || envConfig.host,
    port: parseInt(process.env.PGPORT || envConfig.port.toString()),
    user: process.env.PGUSER || envConfig.user,
    password: process.env.PGPASSWORD || envConfig.password,
    database: process.env.PGDATABASE || envConfig.database,
    pool: dbConfig.pool,
    timeouts: dbConfig.timeouts
  };
}

/**
 * Get database connection string
 */
export function getDatabaseConnectionString(environment: string = 'development') {
  const dbConfig = getDatabaseConfig(environment);
  
  if (dbConfig.password) {
    return `postgresql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
  } else {
    return `postgresql://${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
  }
}

/**
 * Get pool configuration for database connections
 */
export function getDatabasePoolConfig(environment: string = 'development') {
  const dbConfig = getDatabaseConfig(environment);
  
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    max: dbConfig.pool.max,
    idleTimeoutMillis: dbConfig.pool.idleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.pool.connectionTimeoutMillis
  };
}

/**
 * Get layer processing timeout values from configuration
 */
export function getLayerTimeouts() {
  const config = loadConfig();
  
  // Read Layer 1 timeout from layer1-trail.config.yaml
  const layer1Config = (config as any).layer1_trails || {};
  const layer1Timeout = layer1Config.timeout?.processingTimeoutMs || 300000;
  
  // Read Layer 2 timeout from layer2-node-edge.config.yaml
  const layer2Config = (config as any).layer2_edges || {};
  const layer2Timeout = layer2Config.timeout?.processingTimeoutMs || 180000;
  
  // Read Layer 3 timeout from layer3-routing.config.yaml
  const layer3Config = loadRouteDiscoveryConfig();
  const layer3Timeout = layer3Config.discovery?.timeout?.processingTimeoutMs || 300000;
  
  return {
    layer1Timeout,
    layer2Timeout,
    layer3Timeout
  };
}

/**
 * Get consumer-configurable timeout values with environment variable support
 */
export function getConsumerTimeouts() {
  return {
    // CLI export timeout - can be overridden with CARTHORSE_EXPORT_TIMEOUT_MS
    cliExportTimeoutMs: parseInt(process.env.CARTHORSE_EXPORT_TIMEOUT_MS || '600000'),
    
    // PostgreSQL statement timeout - can be overridden with CARTHORSE_POSTGRES_STATEMENT_TIMEOUT
    postgresStatementTimeout: parseInt(process.env.CARTHORSE_POSTGRES_STATEMENT_TIMEOUT || '600'),
    
    // Database connection timeout - can be overridden with CARTHORSE_DB_CONNECTION_TIMEOUT_MS
    databaseConnectionTimeout: parseInt(process.env.CARTHORSE_DB_CONNECTION_TIMEOUT_MS || '10000'),
    
    // Database query timeout - can be overridden with CARTHORSE_DB_QUERY_TIMEOUT_MS
    databaseQueryTimeout: parseInt(process.env.CARTHORSE_DB_QUERY_TIMEOUT_MS || '60000'),
  };
}

/**
 * Get Layer 1 service configuration from layer1-trail.config.yaml
 */
export function getLayer1ServiceConfig() {
  const config = loadConfig();
  const layer1Config = (config as any).layer1_trails || {};
  const services = layer1Config.services || {};
  
  return {
    // Service enable/disable flags
    runEndpointSnapping: services.runEndpointSnapping ?? true,
    runProximitySnappingSplitting: services.runProximitySnappingSplitting ?? true,
    runTrueCrossingSplitting: services.runTrueCrossingSplitting ?? true,
    runMultipointIntersectionSplitting: services.runMultipointIntersectionSplitting ?? true,
    runEnhancedIntersectionSplitting: services.runEnhancedIntersectionSplitting ?? true,
    runTIntersectionSplitting: services.runTIntersectionSplitting ?? true,
    runShortTrailSplitting: services.runShortTrailSplitting ?? false,
    runIntersectionBasedTrailSplitter: services.runIntersectionBasedTrailSplitter ?? true,
    runYIntersectionSnapping: services.runYIntersectionSnapping ?? true,
    runVertexBasedSplitting: services.runVertexBasedSplitting ?? false,
    runMissedIntersectionDetection: services.runMissedIntersectionDetection ?? true,
    runStandaloneTrailSplitting: services.runStandaloneTrailSplitting ?? true,
    
    // Service parameters
    toleranceMeters: services.toleranceMeters ?? 5.0,
    tIntersectionToleranceMeters: services.tIntersectionToleranceMeters ?? 3.0,
    yIntersectionToleranceMeters: services.yIntersectionToleranceMeters ?? 10.0,
    shortTrailMaxLengthKm: services.shortTrailMaxLengthKm ?? 0.5,
    minSegmentLengthMeters: services.minSegmentLengthMeters
  };
}

/**
 * Get export configuration from carthorse config
 */
export function getExportConfig() {
  const config = loadConfig();
  return config.export || {
    geojson: {
      combinedLayerExport: true, // Default to true for backward compatibility
      layers: {
        trails: true,
        edges: true,
        edgeNetworkVertices: true,
        trailVertices: false,
        routes: true
      },
      styling: {
        trails: {
          color: "#228B22",
          stroke: "#228B22",
          strokeWidth: 2,
          fillOpacity: 0.6
        },
        edges: {
          color: "#4169E1",
          stroke: "#4169E1",
          strokeWidth: 1,
          fillOpacity: 0.4
        },
        edgeNetworkVertices: {
          color: "#FF0000",
          stroke: "#FF0000",
          strokeWidth: 2,
          fillOpacity: 0.8,
          radius: 5
        },
        trailVertices: {
          color: "#FFD700",
          stroke: "#FFD700",
          strokeWidth: 1,
          fillOpacity: 0.6,
          radius: 3
        },
        routes: {
          color: "#FF8C00",
          stroke: "#FF8C00",
          strokeWidth: 3,
          fillOpacity: 0.8
        }
      }
    }
  };
} 