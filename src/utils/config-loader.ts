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
  };
  postgis: any;
  sqlite: any;
  validation: any;
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

export function getTolerances() {
  const routeConfig = loadRouteDiscoveryConfig();
  const tolerances = routeConfig.routing;
  
  // Allow environment variable overrides
  return {
    intersectionTolerance: process.env.INTERSECTION_TOLERANCE ? 
      parseFloat(process.env.INTERSECTION_TOLERANCE) : tolerances.intersectionTolerance,
    edgeTolerance: process.env.EDGE_TOLERANCE ? 
      parseFloat(process.env.EDGE_TOLERANCE) : tolerances.edgeTolerance,
    minTrailLengthMeters: process.env.MIN_TRAIL_LENGTH_METERS ? 
      parseFloat(process.env.MIN_TRAIL_LENGTH_METERS) : tolerances.minTrailLengthMeters
  };
}

export function getExportSettings() {
  return getConstants().exportSettings;
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