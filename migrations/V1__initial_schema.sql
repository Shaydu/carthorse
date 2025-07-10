-- UP
-- Migration 1: Initial PostgreSQL/PostGIS schema
-- Create the base schema for trail mapping application

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create trails table
CREATE TABLE IF NOT EXISTS trails (
  id SERIAL PRIMARY KEY,
  app_uuid TEXT NOT NULL UNIQUE,
  osm_id TEXT,
  source TEXT DEFAULT 'osm',
  name TEXT,
  trail_type TEXT,
  surface TEXT,
  difficulty TEXT,
  elevation_gain REAL,
  elevation_loss REAL,
  max_elevation REAL,
  min_elevation REAL,
  avg_elevation REAL,
  length_km REAL,
  source_tags JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  geom GEOMETRY(LINESTRINGZ, 4326),
  region TEXT
);

-- Create elevation_points table
CREATE TABLE IF NOT EXISTS elevation_points (
  id SERIAL PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL NOT NULL
);

-- Create routing_nodes table
CREATE TABLE IF NOT EXISTS routing_nodes (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  node_type TEXT,
  geometry GEOMETRY(POINT, 4326)
);

-- Create routing_edges table
CREATE TABLE IF NOT EXISTS routing_edges (
  id SERIAL PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  trail_id TEXT NOT NULL,
  trail_name TEXT NOT NULL,
  distance_km REAL NOT NULL,
  elevation_gain REAL,
  elevation_loss REAL,
  geometry GEOMETRY(LINESTRING, 4326)
);

-- Create route_recommendations table
CREATE TABLE IF NOT EXISTS route_recommendations (
  id SERIAL PRIMARY KEY,
  gpx_distance_km REAL,
  gpx_elevation_gain REAL,
  similarity_score REAL,
  route_type TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_surface ON trails(surface);
CREATE INDEX IF NOT EXISTS idx_trails_type ON trails(trail_type);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_geom ON trails USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails USING GIST(ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat));

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_trails_updated_at 
  BEFORE UPDATE ON trails 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- DOWN
-- Rollback for migration 1
-- Drop all tables and extensions

DROP TRIGGER IF EXISTS update_trails_updated_at ON trails;
DROP FUNCTION IF EXISTS update_updated_at_column();

DROP TABLE IF EXISTS route_recommendations;
DROP TABLE IF EXISTS routing_edges;
DROP TABLE IF EXISTS routing_nodes;
DROP TABLE IF EXISTS elevation_points;
DROP TABLE IF EXISTS trails;

DROP EXTENSION IF EXISTS postgis; 