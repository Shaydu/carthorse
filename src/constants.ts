/**
 * CARTHORSE Constants
 */

export const CARTHORSE_VERSION = '1.0.0';

export const SUPPORTED_REGIONS = [
  'boulder',
  'seattle',
  'denver',
  'portland',
  'san-francisco'
] as const;

export const SUPPORTED_ENVIRONMENTS = [
  'default',
  'bbox-phase2',
  'test'
] as const;

export const DATABASE_SCHEMAS = {
  MASTER: 'public',
  STAGING_PREFIX: 'staging_',
  OSM_PREFIX: 'osm_'
} as const;

export const VALIDATION_THRESHOLDS = {
  MIN_TRAIL_LENGTH_KM: 0.001,
  MAX_TRAIL_LENGTH_KM: 1000,
  MIN_ELEVATION_M: -1000,
  MAX_ELEVATION_M: 9000,
  MIN_COORDINATE_POINTS: 2,
  MAX_COORDINATE_POINTS: 10000
} as const;

export const INTERSECTION_TOLERANCE = process.env.INTERSECTION_TOLERANCE ? parseFloat(process.env.INTERSECTION_TOLERANCE) : 50;
export const EDGE_TOLERANCE = process.env.EDGE_TOLERANCE ? parseFloat(process.env.EDGE_TOLERANCE) : 20;

export const EXPORT_SETTINGS = {
  DEFAULT_SIMPLIFY_TOLERANCE: 0.001,
  DEFAULT_MAX_DB_SIZE_MB: 400,
  DEFAULT_TARGET_SIZE_MB: 100
} as const; 