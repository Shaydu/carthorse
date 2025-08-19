/**
 * Route Generation Type Definitions
 */

export interface RoutePattern {
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: 'out-and-back' | 'loop' | 'lollipop';
}

export interface RouteRecommendation {
  route_uuid: string;
  route_name: string;
  route_type: string;
  route_shape: string;
  input_length_km: number;
  input_elevation_gain: number;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_path: any;
  route_edges: any[];
  trail_count: number;
  route_score: number;
  similarity_score: number;
  region: string;
  route_geometry?: any; // Optional PostGIS geometry
}

export interface ToleranceLevel {
  distance: number; // Percentage tolerance for distance
  elevation: number; // Percentage tolerance for elevation
  quality: number; // Quality score multiplier
}

export interface UsedArea {
  area_id: string;
  route_count: number;
  last_used: Date;
}
