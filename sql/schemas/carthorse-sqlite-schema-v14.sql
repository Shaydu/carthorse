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
  difficulty TEXT CHECK(difficulty IN ('easy', 'moderate', 'hard', 'expert')),
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

-- Routing nodes table (pgRouting optimized)
CREATE TABLE IF NOT EXISTS routing_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_uuid TEXT UNIQUE NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
  connected_trails TEXT, -- Comma-separated trail IDs
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Routing edges table (pgRouting optimized with v12 schema)
CREATE TABLE IF NOT EXISTS routing_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source INTEGER NOT NULL, -- pgRouting source node ID (v12 schema)
  target INTEGER NOT NULL, -- pgRouting target node ID (v12 schema)
  trail_id TEXT, -- Reference to original trail
  trail_name TEXT,
  distance_km REAL CHECK(distance_km > 0),
  elevation_gain REAL CHECK(elevation_gain >= 0),
  elevation_loss REAL CHECK(elevation_loss >= 0),
  geojson TEXT NOT NULL, -- Geometry as GeoJSON (required)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Route recommendations table (v14 - enhanced with better constraint handling)
CREATE TABLE IF NOT EXISTS route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  input_distance_km REAL CHECK(input_distance_km > 0),
  input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
  recommended_distance_km REAL CHECK(recommended_distance_km > 0),
  recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
  route_elevation_loss REAL CHECK(route_elevation_loss >= 0), -- Calculated from route edges
  route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
  route_type TEXT CHECK(route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point')) NOT NULL,
  route_name TEXT, -- Generated route name according to Gainiac requirements
  route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
  trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
  route_path TEXT NOT NULL, -- GeoJSON of the complete route
  route_edges TEXT NOT NULL, -- JSON array of trail segments
  similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Additional fields from gainiac schema for enhanced functionality
  input_distance_tolerance REAL CHECK(input_distance_tolerance >= 0),
  input_elevation_tolerance REAL CHECK(input_elevation_tolerance >= 0),
  expires_at DATETIME,
  usage_count INTEGER DEFAULT 0 CHECK(usage_count >= 0),
  complete_route_data TEXT, -- Complete route information as JSON
  trail_connectivity_data TEXT, -- Trail connectivity data as JSON
  request_hash TEXT, -- Request hash for deduplication
  
  -- NEW: Parametric search fields (calculated from route data)
  route_gain_rate REAL CHECK(route_gain_rate >= 0), -- meters per kilometer (calculated)
  route_trail_count INTEGER CHECK(route_trail_count > 0), -- number of unique trails in route (same as trail_count)
  route_max_elevation REAL CHECK(route_max_elevation > 0), -- highest point on route (calculated from route_path)
  route_min_elevation REAL CHECK(route_min_elevation > 0), -- lowest point on route (calculated from route_path)
  route_avg_elevation REAL CHECK(route_avg_elevation > 0), -- average elevation of route (calculated from route_path)
  route_difficulty TEXT CHECK(route_difficulty IN ('easy', 'moderate', 'hard', 'expert')), -- calculated from gain rate
  route_estimated_time_hours REAL CHECK(route_estimated_time_hours > 0), -- estimated hiking time
  route_connectivity_score REAL CHECK(route_connectivity_score >= 0 AND route_connectivity_score <= 1) -- how well trails connect
);

-- NEW: Route trails junction table for detailed trail composition
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

-- Schema version table
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert current schema version
INSERT INTO schema_version (version, description) VALUES (14, 'Carthorse SQLite Export v14.0 (Enhanced Route Recommendations + Trail Composition)');

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

-- Performance indexes (optimized for filtering)
CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
-- Note: v14 schema doesn't have a 'source' column, so we skip this index

CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);

CREATE INDEX IF NOT EXISTS idx_routing_edges_source_target ON routing_edges(source, target);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(distance_km);

-- ROUTE FILTERING INDEXES (NEW)
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape ON route_recommendations(route_shape);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(trail_count);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(route_score);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(recommended_elevation_gain);

-- Indexes for route recommendations (optimized for parametric search)
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(recommended_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_gain_rate ON route_recommendations(route_gain_rate);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_trail_count ON route_recommendations(route_trail_count);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_difficulty ON route_recommendations(route_difficulty);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation_range ON route_recommendations(route_min_elevation, route_max_elevation);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_type ON route_recommendations(route_type);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_score ON route_recommendations(similarity_score);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);

-- Composite indexes for common parametric search combinations
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance_gain_rate ON route_recommendations(recommended_distance_km, route_gain_rate);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_difficulty_distance ON route_recommendations(route_difficulty, recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation_range_difficulty ON route_recommendations(route_min_elevation, route_max_elevation, route_difficulty);

-- COMPOSITE INDEXES FOR COMMON FILTERS
CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape_count ON route_recommendations(route_shape, trail_count);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_shape ON route_recommendations(region, route_shape);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_count ON route_recommendations(region, trail_count);

-- NEW: Indexes for route_trails junction table
CREATE INDEX IF NOT EXISTS idx_route_trails_route_uuid ON route_trails(route_uuid);
CREATE INDEX IF NOT EXISTS idx_route_trails_trail_id ON route_trails(trail_id);
CREATE INDEX IF NOT EXISTS idx_route_trails_segment_order ON route_trails(segment_order);
CREATE INDEX IF NOT EXISTS idx_route_trails_composite ON route_trails(route_uuid, segment_order);

-- Route statistics view (updated to use route_shape)
CREATE VIEW route_stats AS
SELECT 
  COUNT(*) as total_routes,
  AVG(recommended_distance_km) as avg_distance_km,
  AVG(recommended_elevation_gain) as avg_elevation_gain,
  COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loop_routes,
  COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back_routes,
  COUNT(CASE WHEN route_shape = 'lollipop' THEN 1 END) as lollipop_routes,
  COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point_routes,
  COUNT(CASE WHEN trail_count = 1 THEN 1 END) as single_trail_routes,
  COUNT(CASE WHEN trail_count > 1 THEN 1 END) as multi_trail_routes
FROM route_recommendations;

-- NEW: Route trail composition view
CREATE VIEW route_trail_composition AS
SELECT 
  rr.route_uuid,
  rr.route_name,
  rr.route_shape,
  rr.recommended_distance_km,
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
-- - 6 Tables: trails, routing_nodes, routing_edges, route_recommendations, route_trails, region_metadata
-- - 25 Indexes: Performance and filtering indexes
-- - 2 Views: route_stats, route_trail_composition
-- - 5 PRAGMA settings: WAL mode, memory optimizations
-- 
-- ============================================================================= 