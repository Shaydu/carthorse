/**
 * CARTHORSE Type Definitions
 */

// Coordinate types
export type Coordinate3D = [number, number, number]; // [lng, lat, elevation]
export type Coordinate2D = [number, number]; // [lng, lat]
export type GeoJSONCoordinate = Coordinate2D | Coordinate3D;
export type LeafletCoordinate = [number, number]; // [lat, lng]

// Bounding box
export interface BoundingBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

// Trail data types
export interface TrailInsertData {
  osm_id: string;
  name: string;
  trail_type: string;
  coordinates: Coordinate3D[];
  source_tags: Record<string, string>;
  region: string;
}

export interface CompleteTrailRecord {
  app_uuid: string;
  osm_id: string;
  name: string;
  trail_type: string;
  geojson: string;
  source_tags: Record<string, string>;
  region: string;
  created_at: Date;
  updated_at: Date;
}

// Configuration types
export interface OrchestratorConfig {
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  region: string;
  dataPath: string;
  elevationPath: string;
  osmPath: string;
}

// Validation types
export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  summary: ValidationSummary;
}

export interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  count?: number;
  details?: any;
}

export interface ValidationSummary {
  totalTrails: number;
  validTrails: number;
  invalidTrails: number;
  missingElevation: number;
  missingGeometry: number;
  invalidGeometry: number;
  not3DGeometry: number;
  zeroElevation: number;
}

// Routing/graph types
export interface RoutingNode {
  id: number;
  nodeUuid: string;
  lat: number;
  lng: number;
  elevation: number;
  nodeType: string;
  connectedTrails: string;
}

export interface RoutingEdge {
  fromNodeId: number;
  toNodeId: number;
  trailId: string;
  trailName: string;
  distanceKm: number;
  elevationGain: number;
}

export interface IntersectionPoint {
  coordinate: GeoJSONCoordinate; // [lng, lat, elevation?]
  idx: number;
  distance: number;
  visitorTrailId: string; // Changed from number to string for UUID support
  visitorTrailName: string;
}

// Validation types (moved from DataIntegrityValidator.ts)
export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  summary: ValidationSummary;
}

export interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  count?: number;
  details?: any;
}

export interface ValidationSummary {
  totalTrails: number;
  validTrails: number;
  invalidTrails: number;
  missingElevation: number;
  missingGeometry: number;
  invalidGeometry: number;
  not3DGeometry: number;
  zeroElevation: number;
  spatialContainmentIssues: number;
}

// API types (moved from enhanced-routing-endpoints.ts)
export interface RoutingNode {
  id: number;
  node_uuid: string;
  lat: number;
  lng: number;
  elevation: number;
  node_type: 'intersection' | 'endpoint';
  connected_trails: string;
}

export interface RoutingEdge {
  id: number;
  source: number;
  target: number;
  trail_id: string;
  trail_name: string;
  distance_km: number;
  elevation_gain: number;
}

export interface BBoxQuery {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

// Database configuration types (moved from connection.ts)
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface EnvironmentConfig {
  name: string;
  database: DatabaseConfig;
  dataPaths: {
    sourceDataDir: string;
    elevationTiffDir: string;
    osmDataPath: string;
  };
  processing: {
    batchSize: number;
    timeoutMs: number;
    logLevel: string;
    verbose: boolean;
  };
}

// Orchestrator configuration types (moved from EnhancedPostgresOrchestrator.ts)
export interface EnhancedOrchestratorConfig {
  region: string;
  outputPath: string;
  simplifyTolerance: number;
  intersectionTolerance: number;
  replace: boolean;
  validate: boolean;
  verbose: boolean;
  skipBackup: boolean;
  buildMaster: boolean;
  targetSizeMB: number | null;
  maxSqliteDbSizeMB: number;
  skipIncompleteTrails: boolean;
  bbox?: [number, number, number, number];
  skipCleanup?: boolean; // If true, never clean up staging schema
  cleanupOnError?: boolean; // If true, clean up staging schema on error (default: false)
  edgeTolerance?: number; // <-- add this
  testCleanup?: boolean; // Always drop staging schema after run (for test/debug)
  useSqlite?: boolean; // If true, use regular SQLite for export
  useIntersectionNodes?: boolean; // If true, create intersection nodes; if false, use only endpoints
  useSplitTrails?: boolean; // If true, export split trail segments; if false, export original trails
  // New cleanup options for disk space management
  aggressiveCleanup?: boolean; // If true, clean up old staging schemas and temp files (default: true)
  cleanupOldStagingSchemas?: boolean; // If true, drop old staging schemas for this region (default: true)
  cleanupTempFiles?: boolean; // If true, clean up temporary files and logs (default: true)
  maxStagingSchemasToKeep?: number; // Maximum number of staging schemas to keep per region (default: 2)
  cleanupDatabaseLogs?: boolean; // If true, clean up database log files (default: false)
  // Elevation processing options
  skipElevationProcessing?: boolean; // If true, skip elevation data processing (default: false)
  // Validation options
  skipValidation?: boolean; // If true, skip all validation checks (default: false)
  skipBboxValidation?: boolean; // If true, skip bbox validation checks (default: false)
  skipGeometryValidation?: boolean; // If true, skip geometry validation checks (default: false)
  skipTrailValidation?: boolean; // If true, skip trail data validation checks (default: false)
}

// Schema verification types (moved from schema-verifier.ts)
export interface SchemaColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface SchemaTable {
  table_name: string;
  columns: SchemaColumn[];
}

export interface SchemaComparison {
  missingTables: string[];
  extraTables: string[];
  columnDifferences: Record<string, { missing: string[]; extra: string[]; typeMismatches: string[] }>;
}

// Schema version types (moved from schema-version-checker.ts)
export interface SchemaVersion {
  version: number;
  description: string;
  applied_at: Date;
}

// Routing graph types (moved from routing.ts)
export interface RoutingGraphResult {
  nodes: any[];
  edges: any[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    intersectionNodes: number;
    endpointNodes: number;
    nodeToTrailRatio: number;
  };
}

export interface TrailSegment {
  originalTrailId: number;
  segmentNumber: number;
  appUuid: string;
  name: string;
  trailType: string;
  surface: string;
  difficulty: string;
  sourceTags: string;
  osmId: string;
  elevationGain: number;
  elevationLoss: number;
  maxElevation: number;
  minElevation: number;
  avgElevation: number;
  lengthKm: number;
  source: string;
  geometry: string;
  bboxMinLng: number;
  bboxMaxLng: number;
  bboxMinLat: number;
  bboxMaxLat: number;
} 