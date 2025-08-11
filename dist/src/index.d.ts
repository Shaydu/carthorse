/**
 * CARTHORSE - Comprehensive Geospatial Trail Data Processing Pipeline
 *
 * A TypeScript library for building 3D trail databases with elevation data
 * from OpenStreetMap, GPX files, and elevation TIFFs.
 */
export { AtomicTrailInserter } from './inserters/AtomicTrailInserter';
export { OSMPostgresLoader } from './loaders/OSMPostgresLoader';
export { DataIntegrityValidator } from './validation/DataIntegrityValidator';
export { DatabaseValidator } from './validation/DatabaseValidator';
export * from './types';
export { dbConnection, DatabaseConnection } from './database/connection';
export { runExport } from './cli/export';
export { runRegionReadiness } from './cli/region-readiness';
export { runValidation } from './cli/validate';
export * from './utils/config-loader';
//# sourceMappingURL=index.d.ts.map