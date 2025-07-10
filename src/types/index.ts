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
  geometry: string; // WKT format
  coordinates: Coordinate3D[];
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