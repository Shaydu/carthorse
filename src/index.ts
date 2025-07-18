/**
 * CARTHORSE - Comprehensive Geospatial Trail Data Processing Pipeline
 * 
 * A TypeScript library for building 3D trail databases with elevation data
 * from OpenStreetMap, GPX files, and elevation TIFFs.
 */

// Core exports
export { AtomicTrailInserter } from './inserters/AtomicTrailInserter';
export { OSMPostgresLoader } from './loaders/OSMPostgresLoader';
export { ElevationProcessor } from './processors/ElevationProcessor';
export { DataIntegrityValidator } from './validation/DataIntegrityValidator';
export { DatabaseValidator } from './validation/DatabaseValidator';
export { GeometryValidator } from './validation/GeometryValidator';

// Types
export * from './types';

// Database
export { dbConnection, DatabaseConnection } from './database/connection';
export type { DatabaseConfig, EnvironmentConfig } from './database/connection';

// CLI
// Export CLI functions
export { runExport } from './cli/export';
export { runRegionReadiness } from './cli/region-readiness';
export { runValidation } from './cli/validate';

// Constants
export * from './constants'; 