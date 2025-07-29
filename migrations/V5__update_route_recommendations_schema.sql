-- UP
-- Migration 5: Update route_recommendations table schema
-- Add missing columns to match SQLite schema

-- Drop the existing table and recreate with proper schema
DROP TABLE IF EXISTS route_recommendations;

CREATE TABLE route_recommendations (
  id SERIAL PRIMARY KEY,
  route_uuid TEXT UNIQUE,
  region TEXT NOT NULL,
  gpx_distance_km REAL CHECK(gpx_distance_km >= 0),
  gpx_elevation_gain REAL CHECK(gpx_elevation_gain >= 0),
  gpx_name TEXT,
  recommended_distance_km REAL CHECK(recommended_distance_km >= 0),
  recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
  route_type TEXT,
  route_edges JSONB,
  route_path JSONB,
  similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  input_distance_km REAL CHECK(input_distance_km >= 0),
  input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
  input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
  input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
  expires_at TIMESTAMP,
  usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
  complete_route_data JSONB,
  trail_connectivity_data JSONB,
  request_hash TEXT
);

-- Create indexes for route_recommendations
CREATE INDEX IF NOT EXISTS idx_route_recommendations_created ON route_recommendations(created_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_route_uuid ON route_recommendations(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_request_hash ON route_recommendations(request_hash);

-- Add check constraints
ALTER TABLE route_recommendations ADD CONSTRAINT chk_route_recommendations_distance_positive 
  CHECK (gpx_distance_km IS NULL OR gpx_distance_km > 0);

ALTER TABLE route_recommendations ADD CONSTRAINT chk_route_recommendations_elevation_gain_non_negative 
  CHECK (gpx_elevation_gain IS NULL OR gpx_elevation_gain >= 0);

ALTER TABLE route_recommendations ADD CONSTRAINT chk_route_recommendations_route_type_valid 
  CHECK (route_type IS NULL OR route_type IN ('exact_match', 'similar_distance', 'similar_elevation', 'similar_profile', 'custom'));

ALTER TABLE route_recommendations ADD CONSTRAINT chk_route_recommendations_similarity_score_range 
  CHECK (similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1));

-- DOWN
-- Rollback for migration 5
-- Revert to original schema

DROP TABLE IF EXISTS route_recommendations;

CREATE TABLE route_recommendations (
  id SERIAL PRIMARY KEY,
  route_uuid TEXT UNIQUE,
  gpx_distance_km REAL,
  gpx_elevation_gain REAL,
  similarity_score REAL,
  route_type TEXT
);