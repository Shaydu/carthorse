/**
 * CARTHORSE - Comprehensive Geospatial Trail Data Processing Pipeline
 * 
 * A TypeScript library for building 3D trail databases with elevation data
 * from OpenStreetMap, GPX files, and elevation TIFFs.
 */

// Core exports
export { EnhancedPostgresOrchestrator } from './orchestrator/EnhancedPostgresOrchestrator';
export { AtomicTrailInserter } from './inserters/AtomicTrailInserter';
export { OSMPostgresLoader } from './loaders/OSMPostgresLoader';
export { DataIntegrityValidator } from './validation/DataIntegrityValidator';

// Types
export type {
  Coordinate3D,
  Coordinate2D,
  BoundingBox,
  GeoJSONCoordinate,
  LeafletCoordinate,
  TrailInsertData,
  CompleteTrailRecord,
  OrchestratorConfig
} from './types';

// CLI
export { runOrchestrator } from './cli/orchestrator';
export { runRegionReadiness } from './cli/region-readiness';
export { runValidation } from './cli/validate';

// Utilities
export { ElevationProcessor } from './processors/ElevationProcessor';
export { GeometryValidator } from './validation/GeometryValidator';
export { DatabaseValidator } from './validation/DatabaseValidator';

// Constants
export { CARTHORSE_VERSION } from './constants'; 