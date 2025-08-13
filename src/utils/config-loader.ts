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
  export?: {
    geojson?: {
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

  const configPath = path.join(process.cwd(), 'configs/route-discovery.config.yaml');
  
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
  const bridging = (config as any).constants?.bridging;
  if (!bridging) {
    throw new Error('Missing required configuration: constants.bridging');
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
  return config.postgis?.processing?.pgrouting || {
    intersectionDetectionTolerance: 0.0005,    // ~50 meters
    edgeToVertexTolerance: 0.0005,             // ~50 meters  
    graphAnalysisTolerance: 0.0005,            // ~50 meters
    trueLoopTolerance: 10.0,                   // 10 meters
    minTrailLengthMeters: 0.1,                 // 0.1 meters
    maxTrailLengthMeters: 100000               // 100km
  };
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
 * Get export configuration from carthorse config
 */
export function getExportConfig() {
  const config = loadConfig();
  return config.export || {
    geojson: {
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