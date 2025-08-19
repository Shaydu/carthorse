// Global configuration constants for Carthorse
// This file contains centralized configuration that can be used throughout the codebase

export const GLOBAL_CONFIG = {
  // Elevation precision configuration
  elevation: {
    precision: parseInt(process.env.CARTHORSE_ELEVATION_PRECISION || '2'), // Decimal places for elevation values
    defaultPrecision: 2, // Fallback if env var not set
    maxPrecision: 6, // Maximum allowed precision
    minPrecision: 0, // Minimum allowed precision
  },

  // Distance/length precision configuration
  distance: {
    precision: parseInt(process.env.CARTHORSE_DISTANCE_PRECISION || '3'), // Decimal places for distance/length values
    defaultPrecision: 3, // Fallback if env var not set
    maxPrecision: 6, // Maximum allowed precision
    minPrecision: 1, // Minimum allowed precision
  },

  // Coordinate precision configuration
  coordinates: {
    precision: parseInt(process.env.CARTHORSE_COORDINATE_PRECISION || '6'), // Decimal places for lat/lng coordinates
    defaultPrecision: 6, // Fallback if env var not set
    maxPrecision: 8, // Maximum allowed precision
    minPrecision: 4, // Minimum allowed precision
  },

  // Spatial operation tolerances (in meters)
  spatial: {
    intersectionTolerance: parseFloat(process.env.INTERSECTION_TOLERANCE || '1'),
    edgeTolerance: parseFloat(process.env.EDGE_TOLERANCE || '1'),
    simplifyTolerance: 0.0, // DISABLED: Preserve maximum proximity for splitting and route generation
  },

  // Database configuration
  database: {
    defaultSchema: 'public',
    stagingSchemaPrefix: 'staging_',
    maxStagingSchemasToKeep: 2,
  },

  // Processing configuration
  processing: {
    batchSize: parseInt(process.env.CARTHORSE_BATCH_SIZE || '1000'),
    timeoutMs: parseInt(process.env.CARTHORSE_TIMEOUT_MS || '30000'),
    logLevel: process.env.CARTHORSE_LOG_LEVEL || 'info',
    verbose: process.env.CARTHORSE_VERBOSE === 'true',
  },

  // Export configuration
  export: {
    maxSqliteDbSizeMB: 400,
    defaultSimplifyTolerance: 0.0, // DISABLED: Preserve maximum proximity for splitting and route generation
    defaultIntersectionTolerance: 2.0,
  },

  // Validation configuration
  validation: {
    skipIncompleteTrails: true,
    skipValidation: false,
    skipBboxValidation: false,
    skipGeometryValidation: false,
    skipTrailValidation: false,
  },

  // Cleanup configuration
  cleanup: {
    aggressiveCleanup: true,
    cleanupOldStagingSchemas: true,
    cleanupTempFiles: true,
    cleanupDatabaseLogs: false,
    cleanupOnError: false,
  },


} as const;

// Helper functions for configuration
export const configHelpers = {
  /**
   * Get elevation precision with validation
   */
  getElevationPrecision(): number {
    const precision = GLOBAL_CONFIG.elevation.precision;
    if (precision < GLOBAL_CONFIG.elevation.minPrecision || precision > GLOBAL_CONFIG.elevation.maxPrecision) {
      console.warn(`⚠️  Invalid elevation precision: ${precision}. Using default: ${GLOBAL_CONFIG.elevation.defaultPrecision}`);
      return GLOBAL_CONFIG.elevation.defaultPrecision;
    }
    return precision;
  },

  /**
   * Round elevation value to configured precision
   */
  roundElevation(elevation: number): number {
    const precision = configHelpers.getElevationPrecision();
    return Math.round(elevation * Math.pow(10, precision)) / Math.pow(10, precision);
  },

  /**
   * Get distance precision with validation
   */
  getDistancePrecision(): number {
    const precision = GLOBAL_CONFIG.distance.precision;
    if (precision < GLOBAL_CONFIG.distance.minPrecision || precision > GLOBAL_CONFIG.distance.maxPrecision) {
      console.warn(`⚠️  Invalid distance precision: ${precision}. Using default: ${GLOBAL_CONFIG.distance.defaultPrecision}`);
      return GLOBAL_CONFIG.distance.defaultPrecision;
    }
    return precision;
  },

  /**
   * Round distance/length value to configured precision
   */
  roundDistance(distance: number): number {
    const precision = configHelpers.getDistancePrecision();
    return Math.round(distance * Math.pow(10, precision)) / Math.pow(10, precision);
  },

  /**
   * Get coordinate precision with validation
   */
  getCoordinatePrecision(): number {
    const precision = GLOBAL_CONFIG.coordinates.precision;
    if (precision < GLOBAL_CONFIG.coordinates.minPrecision || precision > GLOBAL_CONFIG.coordinates.maxPrecision) {
      console.warn(`⚠️  Invalid coordinate precision: ${precision}. Using default: ${GLOBAL_CONFIG.coordinates.defaultPrecision}`);
      return GLOBAL_CONFIG.coordinates.defaultPrecision;
    }
    return precision;
  },

  /**
   * Round coordinate value to configured precision
   */
  roundCoordinate(coordinate: number): number {
    const precision = configHelpers.getCoordinatePrecision();
    return Math.round(coordinate * Math.pow(10, precision)) / Math.pow(10, precision);
  },

  /**
   * Format elevation value with proper precision
   */
  formatElevation(elevation: number): string {
    const precision = configHelpers.getElevationPrecision();
    return elevation.toFixed(precision);
  },

  /**
   * Get spatial tolerance with validation
   */
  getSpatialTolerance(type: 'intersection' | 'edge'): number {
    switch (type) {
      case 'intersection':
        return GLOBAL_CONFIG.spatial.intersectionTolerance;
      case 'edge':
        return GLOBAL_CONFIG.spatial.edgeTolerance;
      default:
        return GLOBAL_CONFIG.spatial.intersectionTolerance;
    }
  },

  /**
   * Check if verbose logging is enabled
   */
  isVerbose(): boolean {
    return GLOBAL_CONFIG.processing.verbose;
  },

  /**
   * Get processing batch size
   */
  getBatchSize(): number {
    return GLOBAL_CONFIG.processing.batchSize;
  },

  /**
   * Get processing timeout
   */
  getTimeoutMs(): number {
    return GLOBAL_CONFIG.processing.timeoutMs;
  },


};

// Type definitions for configuration
export interface GlobalConfig {
  elevation: {
    precision: number;
    defaultPrecision: number;
    maxPrecision: number;
    minPrecision: number;
  };
  distance: {
    precision: number;
    defaultPrecision: number;
    maxPrecision: number;
    minPrecision: number;
  };
  coordinates: {
    precision: number;
    defaultPrecision: number;
    maxPrecision: number;
    minPrecision: number;
  };
  spatial: {
    intersectionTolerance: number;
    edgeTolerance: number;
    simplifyTolerance: number;
  };
  database: {
    defaultSchema: string;
    stagingSchemaPrefix: string;
    maxStagingSchemasToKeep: number;
  };
  processing: {
    batchSize: number;
    timeoutMs: number;
    logLevel: string;
    verbose: boolean;
  };
  export: {
    maxSqliteDbSizeMB: number;
    defaultSimplifyTolerance: number;
    defaultIntersectionTolerance: number;
  };
  validation: {
    skipIncompleteTrails: boolean;
    skipValidation: boolean;
    skipBboxValidation: boolean;
    skipGeometryValidation: boolean;
    skipTrailValidation: boolean;
  };
  cleanup: {
    aggressiveCleanup: boolean;
    cleanupOldStagingSchemas: boolean;
    cleanupTempFiles: boolean;
    cleanupDatabaseLogs: boolean;
    cleanupOnError: boolean;
  };

} 