-- Carthorse SQLite Export Schema v13 (Route Type & Shape Enforcement)
-- Enhanced with proper data type enforcement for recommendation engine filtering
-- ADDS: trail_count for route cardinality filtering
-- ADDS: route_shape column for route shape classification
-- MAINTAINS: All v12 optimizations and deduplication
-- ENFORCES: Data validation for recommendation engine filtering

/*
 * FIELD SEMANTIC MEANINGS
 * =======================
 * 
 * route_type (TEXT, unconstrained):
 *   - PURPOSE: Describes how the recommendation algorithm matched the route
 *   - USAGE: PostGIS recommendation engine algorithm classification
 *   - VALUES: 'exact_match', 'similar_distance', 'similar_elevation', 'similar_profile', 'custom'
 *   - EXAMPLE: 'exact_match' = perfect distance/elevation match to input GPX
 *   - EXAMPLE: 'similar_distance' = close distance match to input GPX
 *   - EXAMPLE: 'custom' = custom algorithm match
 * 
 * route_shape (TEXT, constrained):
 *   - PURPOSE: Describes the geometric shape/pattern of the route
 *   - USAGE: Route shape classification for filtering and statistics
 *   - VALUES: 'loop', 'out-and-back', 'lollipop', 'point-to-point'
 *   - EXAMPLE: 'loop' = route starts and ends at same point
 *   - EXAMPLE: 'out-and-back' = route goes out and returns on same path
 *   - EXAMPLE: 'lollipop' = out-and-back with loop at end
 *   - EXAMPLE: 'point-to-point' = route goes from A to B (different endpoints)
 * 
 * trail_count (INTEGER, constrained):
 *   - PURPOSE: Number of unique trails used in the route
 *   - USAGE: Route cardinality filtering (single vs multi-trail routes)
 *   - VALUES: 1 = single trail, 2+ = multi-trail
 *   - CONSTRAINT: CHECK(trail_count >= 1)
 *   - EXAMPLE: 1 = route uses only one trail
 *   - EXAMPLE: 3 = route combines three different trails
 * 
 * RELATIONSHIPS:
 * - route_type: Algorithm classification (how route was found)
 * - route_shape: Geometric classification (what route looks like)
 * - trail_count: Cardinality classification (how many trails used)
 * 
 * FILTERING EXAMPLES:
 * - Single trail loops: WHERE trail_count = 1 AND route_shape = 'loop'
 * - Multi-trail point-to-point: WHERE trail_count > 1 AND route_shape = 'point-to-point'
 * - Exact match out-and-back: WHERE route_type = 'exact_match' AND route_shape = 'out-and-back'
 */

-- Trails table (optimized with deduplication)
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
  source_tags TEXT,
  length_km REAL CHECK(length_km > 0),
        elevation_gain REAL CHECK(elevation_gain >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
      elevation_loss REAL CHECK(elevation_loss >= 0) NOT NULL, -- REQUIRED: Can be 0 for flat trails
      max_elevation REAL CHECK(max_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      min_elevation REAL CHECK(min_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
      avg_elevation REAL CHECK(avg_elevation > 0) NOT NULL, -- REQUIRED: Must be > 0 for mobile app quality
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

-- Route recommendations table (enhanced with filtering fields)
CREATE TABLE IF NOT EXISTS route_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_uuid TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  input_distance_km REAL CHECK(input_distance_km > 0),
  input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
  recommended_distance_km REAL CHECK(recommended_distance_km > 0),
  recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
  recommended_elevation_loss REAL CHECK(recommended_elevation_loss >= 0),
  route_score REAL CHECK(route_score >= 0 AND route_score <= 100),
  
  -- ROUTE CLASSIFICATION FIELDS
  route_type TEXT, -- Algorithm classification (unconstrained for future PostGIS types)
  route_shape TEXT CHECK(route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point')) NOT NULL,
  trail_count INTEGER CHECK(trail_count >= 1) NOT NULL,
  
  -- ROUTE DATA
  route_path TEXT NOT NULL, -- GeoJSON route path
  route_edges TEXT NOT NULL, -- JSON array of trail segments
  request_hash TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

-- Performance indexes (optimized for filtering)
CREATE INDEX IF NOT EXISTS idx_trails_name ON trails(name);
CREATE INDEX IF NOT EXISTS idx_trails_length ON trails(length_km);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_source ON trails(source);

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

-- COMPOSITE INDEXES FOR COMMON FILTERS
CREATE INDEX IF NOT EXISTS idx_route_recommendations_shape_count ON route_recommendations(route_shape, trail_count);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_shape ON route_recommendations(region, route_shape);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_count ON route_recommendations(region, trail_count);

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

-- Enable WAL mode for better concurrent access and performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000; -- 64MB cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456; -- 256MB memory mapping 