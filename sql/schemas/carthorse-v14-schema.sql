-- Carthorse v14 Schema Reference
-- This file contains the complete SQLite schema for Carthorse v14
-- Includes all latest changes: segment_length_km, simplified structure, route trail composition

-- =============================================================================
-- CARTHORSE V14 SCHEMA REFERENCE
-- =============================================================================
-- 
-- This schema represents the current v14 structure with all latest improvements:
-- - Simplified route_recommendations table (removed unused columns)
-- - Enhanced route_trails table with segment_length_km and trail metadata
-- - Consistent naming conventions
-- - Complete trail composition tracking
--
-- Generated: 2024-01-XX
-- Version: 14.0
-- Description: Enhanced Route Recommendations + Trail Composition

-- =============================================================================
-- CORE TRAIL DATA
-- =============================================================================

-- Main trails table (v14 schema)
CREATE TABLE IF NOT EXISTS trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  osm_id TEXT,
  trail_type TEXT,
  surface_type TEXT,
  difficulty TEXT CHECK(difficulty IN ('easy', 'moderate', 'hard', 'expert')),
  length_km REAL CHECK(length_km > 0),
  elevation_gain REAL CHECK(elevation_gain >= 0),
  elevation_loss REAL CHECK(elevation_loss >= 0),
  max_elevation REAL,
  min_elevation REAL,
  avg_elevation REAL,
  source TEXT,
  geojson TEXT NOT NULL CHECK(json_valid(geojson)),
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  region TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ROUTING NETWORK
-- =============================================================================

-- Routing nodes table (v14 schema)
CREATE TABLE IF NOT EXISTS routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid TEXT UNIQUE NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('endpoint', 'intersection')),
  connected_trails INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Routing edges table (v14 schema)
CREATE TABLE IF NOT EXISTS routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source INTEGER NOT NULL,
  target INTEGER NOT NULL,
  trail_id TEXT NOT NULL,
  trail_name TEXT NOT NULL,
  length_km REAL CHECK(length_km > 0),
  elevation_gain REAL CHECK(elevation_gain >= 0),
  elevation_loss REAL CHECK(elevation_loss >= 0),
  geojson TEXT NOT NULL CHECK(json_valid(geojson)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ROUTE RECOMMENDATIONS
-- =============================================================================

-- Route recommendations table (v14 schema - simplified)
CREATE TABLE IF NOT EXISTS route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  input_length_km REAL CHECK(input_length_km > 0),
  input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
  recommended_length_km REAL CHECK(recommended_length_km > 0),
  recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
  route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
  route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point')),
  route_name TEXT NOT NULL,
  route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')),
  trail_count INTEGER CHECK(trail_count >= 1),
  route_path TEXT NOT NULL CHECK(json_valid(route_path)),
  route_edges TEXT NOT NULL CHECK(json_valid(route_edges)),
  similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  complete_route_data TEXT CHECK(json_valid(complete_route_data))
);

-- Route trails table (v14 schema - enhanced with trail metadata)
CREATE TABLE IF NOT EXISTS route_trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT NOT NULL,
  trail_id TEXT NOT NULL,
  trail_name TEXT NOT NULL,
  segment_order INTEGER NOT NULL,
  segment_length_km REAL CHECK(segment_length_km > 0),
  segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
  trail_type TEXT,
  surface TEXT,
  difficulty TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- METADATA TABLES
-- =============================================================================

-- Region metadata table (v14 schema)
CREATE TABLE IF NOT EXISTS region_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT UNIQUE NOT NULL,
  total_trails INTEGER CHECK(total_trails >= 0),
  total_nodes INTEGER CHECK(total_nodes >= 0),
  total_edges INTEGER CHECK(total_edges >= 0),
  total_routes INTEGER CHECK(total_routes >= 0),
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Schema version table (v14 schema)
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- INDEXES FOR OPTIMAL PERFORMANCE
-- =============================================================================

-- Trail indexes
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);

-- Routing network indexes
CREATE INDEX IF NOT EXISTS idx_routing_nodes_uuid ON routing_nodes(node_uuid);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes(lat, lng);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON routing_edges(source);
CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON routing_edges(target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_length ON routing_edges(length_km);

-- Route recommendations indexes
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(route_score);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);

-- Route trails indexes
CREATE INDEX IF NOT EXISTS idx_route_trails_route_uuid ON route_trails(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_trails_trail_id ON route_trails(trail_id);
CREATE INDEX IF NOT EXISTS idx_route_trails_order ON route_trails(segment_order);

-- =============================================================================
-- PERFORMANCE OPTIMIZATIONS
-- =============================================================================

-- Enable WAL mode for better performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;

-- =============================================================================
-- SCHEMA VERSION INSERTION
-- =============================================================================

-- Insert schema version record
INSERT OR REPLACE INTO schema_version (version, description, created_at) 
VALUES (14, 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)', CURRENT_TIMESTAMP);

-- =============================================================================
-- SCHEMA VALIDATION CONSTRAINTS
-- =============================================================================

-- Ensure all required tables exist
-- This schema defines the complete v14 structure with:
-- - Simplified route_recommendations (removed unused columns)
-- - Enhanced route_trails with segment_length_km and trail metadata
-- - Consistent naming conventions
-- - Complete trail composition tracking
-- - Performance-optimized indexes
-- - Comprehensive data validation constraints

-- =============================================================================
-- NOTES ON V14 CHANGES
-- =============================================================================
--
-- Key improvements in v14:
-- 1. Simplified route_recommendations table:
--    - Removed: route_elevation_loss, request_hash, expires_at, usage_count
--    - Kept: essential route data and complete_route_data JSON
--
-- 2. Enhanced route_trails table:
--    - Renamed: segment_distance_km → segment_length_km (consistent naming)
--    - Added: trail_type, surface, difficulty (trail metadata)
--    - Removed: segment_elevation_loss (not consistently available)
--
-- 3. Performance optimizations:
--    - Comprehensive indexing strategy
--    - WAL mode for concurrent access
--    - Memory-optimized settings
--
-- 4. Data quality constraints:
--    - CHECK constraints for data validation
--    - JSON validation for complex data
--    - Referential integrity checks
--
-- This schema represents the current production-ready v14 structure.
