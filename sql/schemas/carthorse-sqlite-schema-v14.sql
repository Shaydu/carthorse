-- =============================================================================
-- CARTHORSE SQLITE SCHEMA v14
-- =============================================================================
-- 
-- Enhanced route recommendations with trail composition tracking
-- 
-- Changes from v13:
-- - Added route_trails junction table for detailed trail composition
-- - Updated route_recommendations with better constraint handling
-- - Dynamic region support (no longer hardcoded)
-- - Enhanced parametric search fields
-- - Better fallback values for constraint violations
-- =============================================================================

-- Trails table (v14 - unchanged from v13)
CREATE TABLE IF NOT EXISTS trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  osm_id TEXT,
  osm_type TEXT,
  length_km REAL CHECK(length_km > 0) NOT NULL,
  elevation_gain REAL CHECK(elevation_gain >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
  elevation_loss REAL CHECK(elevation_loss >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
  max_elevation REAL CHECK(max_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
  min_elevation REAL CHECK(min_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
  avg_elevation REAL CHECK(avg_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
  difficulty TEXT CHECK(difficulty IN ('easy', 'moderate', 'hard', 'expert', 'unknown')),
  surface_type TEXT,
  trail_type TEXT,
  geojson TEXT NOT NULL, -- Geometry as GeoJSON (required)
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Routing nodes table (v14 schema - API service compatible)
CREATE TABLE IF NOT EXISTS routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid TEXT UNIQUE NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
  connected_trails TEXT, -- Comma-separated trail IDs
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  -- NOTE: API service validation requires NO geojson or geometry columns
);

-- Routing edges table (v12 schema with source/target)
CREATE TABLE IF NOT EXISTS routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source INTEGER NOT NULL, -- pgRouting source node ID
  target INTEGER NOT NULL, -- pgRouting target node ID
  trail_id TEXT, -- Reference to original trail
  trail_name TEXT NOT NULL, -- Trail name (required)
  length_km REAL CHECK(length_km > 0) NOT NULL, -- Trail segment length in km (required)
  elevation_gain REAL CHECK(elevation_gain >= 0),
  elevation_loss REAL CHECK(elevation_loss >= 0),
  geojson TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Route recommendations table (enhanced v14 with classification fields)
CREATE TABLE IF NOT EXISTS route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  input_length_km REAL CHECK(input_length_km > 0),
  input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
  recommended_length_km REAL CHECK(recommended_length_km > 0),
  recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
  route_elevation_loss REAL CHECK(route_elevation_loss >= 0),
  route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
  
  -- ROUTE CLASSIFICATION FIELDS
  route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point', 'unknown')) NOT NULL,
  route_name TEXT, -- Generated route name according to Gainiac requirements
  route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
  trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
  
  -- ROUTE DATA
  route_path TEXT NOT NULL,
  route_edges TEXT NOT NULL,
  similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Additional fields from gainiac schema for enhanced functionality
  request_hash TEXT, -- Request hash for deduplication
  expires_at DATETIME, -- Expiration timestamp
  usage_count INTEGER DEFAULT 0, -- Usage tracking
  
  -- Calculated fields for enhanced filtering
  route_gain_rate REAL, -- Elevation gain per km
  route_trail_count INTEGER, -- Number of unique trails in route
  route_max_elevation REAL, -- Maximum elevation in route
  route_min_elevation REAL, -- Minimum elevation in route
  route_avg_elevation REAL, -- Average elevation in route
  route_difficulty TEXT CHECK(route_difficulty IN ('easy', 'moderate', 'hard', 'expert')),
  route_estimated_time_hours REAL, -- Estimated hiking time
  route_connectivity_score REAL -- Trail connectivity quality score
);

-- Route trails junction table for detailed trail composition
CREATE TABLE IF NOT EXISTS route_trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT NOT NULL,
  trail_id TEXT NOT NULL,
  trail_name TEXT NOT NULL,
  segment_order INTEGER NOT NULL, -- Order in the route
  segment_distance_km REAL CHECK(segment_distance_km > 0),
  segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
  segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (route_uuid) REFERENCES route_recommendations(route_uuid) ON DELETE CASCADE
);

-- Region metadata table
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

-- Schema version table
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert current schema version
INSERT INTO schema_version (version, description) VALUES (14, 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)');

-- Enhanced spatial indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
CREATE INDEX IF NOT EXISTS idx_trails_elevation_gain ON trails(elevation_gain);

-- Routing nodes indexes
CREATE INDEX IF NOT EXISTS idx_routing_nodes_uuid ON routing_nodes(node_uuid);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes(lat, lng);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);

-- Routing edges indexes
CREATE INDEX IF NOT EXISTS idx_routing_edges_source ON routing_edges(source);
CREATE INDEX IF NOT EXISTS idx_routing_edges_target ON routing_edges(target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_id ON routing_edges(trail_id);

-- Route recommendations indexes
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(route_score);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_similarity ON route_recommendations(similarity_score);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_length ON route_recommendations(recommended_length_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(recommended_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape ON route_recommendations(route_shape);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(trail_count);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_gain_rate ON route_recommendations(route_gain_rate);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_difficulty ON route_recommendations(route_difficulty);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_usage ON route_recommendations(usage_count);

-- Route trails indexes
CREATE INDEX IF NOT EXISTS idx_route_trails_route_uuid ON route_trails(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_trails_trail_id ON route_trails(trail_id);
CREATE INDEX IF NOT EXISTS idx_route_trails_segment_order ON route_trails(segment_order);
CREATE INDEX IF NOT EXISTS idx_route_trails_composite ON route_trails(route_uuid, segment_order);

-- Region metadata indexes
CREATE INDEX IF NOT EXISTS idx_region_metadata_region ON region_metadata(region);
CREATE INDEX IF NOT EXISTS idx_region_metadata_bbox ON region_metadata(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);

-- Route statistics view (optional - not currently used by API service)
CREATE VIEW route_stats AS
SELECT 
  COUNT(*) as total_routes,
  AVG(recommended_length_km) as avg_length_km,
  AVG(recommended_elevation_gain) as avg_elevation_gain,
  COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
  COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
  COUNT(CASE WHEN route_shape = 'lollipop' THEN 1 END) as lollipop_routes,
  COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes,
  COUNT(CASE WHEN trail_count = 1 THEN 1 END) as single_trail_routes,
  COUNT(CASE WHEN trail_count > 1 THEN 1 END) as multi_trail_routes
FROM route_recommendations;

-- Route trail composition view (optional - not currently used by API service)
CREATE VIEW route_trail_composition AS
SELECT 
  rr.route_uuid,
  rr.route_name,
  rr.route_shape,
  rr.recommended_length_km,
  rr.recommended_elevation_gain,
  rt.trail_id,
  rt.trail_name,
  rt.segment_order,
  rt.segment_distance_km,
  rt.segment_elevation_gain,
  rt.segment_elevation_loss
FROM route_recommendations rr
JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
ORDER BY rr.route_uuid, rt.segment_order;

-- Enable WAL mode for better concurrent access and performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000; -- 64MB cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456; -- 256MB memory mapping

-- =============================================================================
-- CONTRACT VERIFICATION
-- =============================================================================
-- 
-- To verify this contract is being followed:
-- 1. Run export code to create SQLite database
-- 2. Use sqlite3 CLI: .schema > actual_schema.sql
-- 3. Compare actual_schema.sql with this file
-- 4. All differences must be resolved before deployment
-- 
-- EXPECTED SCHEMA COMPONENTS:
-- - 7 Tables: trails, routing_nodes, routing_edges, route_recommendations, route_trails, region_metadata, schema_version
-- - 20+ Indexes: Performance and filtering indexes
-- - 2 Views: route_stats, route_trail_composition
-- - 5 PRAGMA settings: WAL mode, memory optimizations
-- 
-- ============================================================================= 