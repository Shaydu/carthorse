-- Carthorse SQLite Export Schema v9 (SQLite Compatible)
-- Enhanced with additional route recommendation fields from gainiac schema
-- This schema adds region support, input tracking, expiration, and usage analytics
-- UPDATED: All JSONB fields changed to TEXT for SQLite compatibility

-- Trails table (geometry as GeoJSON only)
CREATE TABLE IF NOT EXISTS trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_uuid TEXT UNIQUE NOT NULL,
  osm_id TEXT,
  name TEXT NOT NULL,
  source TEXT,
  trail_type TEXT,
  surface TEXT,
  difficulty TEXT,
  geojson TEXT NOT NULL, -- All geometry as GeoJSON (required)
  bbox TEXT,
  source_tags TEXT,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  length_km REAL,
  elevation_gain REAL DEFAULT 0,
  elevation_loss REAL DEFAULT 0,
  max_elevation REAL DEFAULT 0,
  min_elevation REAL DEFAULT 0,
  avg_elevation REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Routing nodes table (no geometry column, just lat/lng)
CREATE TABLE IF NOT EXISTS routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid TEXT UNIQUE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
  connected_trails TEXT, -- JSON array as TEXT
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Routing edges table (geometry as GeoJSON only)
CREATE TABLE IF NOT EXISTS routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id INTEGER,
  to_node_id INTEGER,
  trail_id TEXT,
  trail_name TEXT,
  distance_km REAL,
  elevation_gain REAL DEFAULT 0,
  elevation_loss REAL DEFAULT 0,
  is_bidirectional BOOLEAN DEFAULT 1,
  geojson TEXT NOT NULL, -- All geometry as GeoJSON (required)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Region metadata table
CREATE TABLE IF NOT EXISTS region_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_name TEXT NOT NULL,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  trail_count INTEGER,
  processing_config TEXT, -- JSON configuration for processing options (e.g., useIntersectionNodes)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Schema version table
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Route recommendations table (enhanced v9 with additional fields)
-- UPDATED: All JSONB fields changed to TEXT for SQLite compatibility
-- New fields added for region support, input tracking, expiration, and usage analytics
CREATE TABLE IF NOT EXISTS route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE,
  region TEXT NOT NULL, -- Region identifier for multi-region support
  gpx_distance_km REAL,
  gpx_elevation_gain REAL,
  gpx_name TEXT,
  recommended_distance_km REAL,
  recommended_elevation_gain REAL,
  route_type TEXT,
  route_edges TEXT, -- UPDATED: JSONB -> TEXT (JSON array of trail segments)
  route_path TEXT, -- UPDATED: JSONB -> TEXT (JSON array of coordinate points)
  similarity_score REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Additional fields from gainiac schema for enhanced functionality
  input_distance_km REAL, -- Input distance for recommendations
  input_elevation_gain REAL, -- Input elevation for recommendations
  input_distance_tolerance REAL, -- Distance tolerance
  input_elevation_tolerance REAL, -- Elevation tolerance
  expires_at TIMESTAMP, -- Expiration timestamp
  usage_count INTEGER DEFAULT 0, -- Usage tracking
  complete_route_data TEXT, -- UPDATED: JSONB -> TEXT (Complete route information as JSON)
  trail_connectivity_data TEXT, -- UPDATED: JSONB -> TEXT (Trail connectivity data as JSON)
  request_hash TEXT -- Request hash for deduplication
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_node_uuid ON routing_nodes(node_uuid);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_from_node_id ON routing_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_to_node_id ON routing_edges(to_node_id);

-- Route recommendations indexes (enhanced v9)
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(similarity_score);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
-- Additional indexes from gainiac schema for enhanced query performance
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_created ON route_recommendations(created_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_expires ON route_recommendations(expires_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_request_hash ON route_recommendations(request_hash);

-- Migration notes:
-- This schema is backward compatible with v8. The route_recommendations table
-- can be migrated by adding the new fields as nullable columns initially,
-- then populating them as needed. Existing data will continue to work.
--
-- SQLite Compatibility Notes:
-- - All JSONB fields changed to TEXT (SQLite doesn't support JSONB)
-- - JSON validation should be done at application level
-- - Use JSON functions like json_extract() for querying JSON data in TEXT fields
-- - Boolean fields use INTEGER (0/1) as per SQLite convention 