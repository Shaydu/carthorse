import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

export interface CarthorseConfig {
  version: string;
  cliVersion: string;
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
    tolerances: {
      intersectionTolerance: number;
      edgeTolerance: number;
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

let configCache: CarthorseConfig | null = null;

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
  const tolerances = getConstants().tolerances;
  
  // Allow environment variable overrides
  return {
    intersectionTolerance: process.env.INTERSECTION_TOLERANCE ? 
      parseFloat(process.env.INTERSECTION_TOLERANCE) : tolerances.intersectionTolerance,
    edgeTolerance: process.env.EDGE_TOLERANCE ? 
      parseFloat(process.env.EDGE_TOLERANCE) : tolerances.edgeTolerance
  };
}

export function getExportSettings() {
  return getConstants().exportSettings;
} 