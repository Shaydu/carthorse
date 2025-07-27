-- PostgreSQL Master Database Schema for Carthorse
-- This file creates the master database schema with PostGIS spatial support

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- TRAILS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trails (
    id SERIAL PRIMARY KEY,
    app_uuid TEXT UNIQUE NOT NULL,
    osm_id TEXT,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    trail_type TEXT,
    surface TEXT,
    difficulty TEXT,
    source_tags JSONB,
    bbox_min_lng REAL,
    bbox_max_lng REAL,
    bbox_min_lat REAL,
    bbox_max_lat REAL,
    length_km REAL,
    elevation_gain REAL DEFAULT 0,
    elevation_loss REAL DEFAULT 0,
    max_elevation REAL,
    min_elevation REAL,
    avg_elevation REAL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geo2 GEOMETRY(LINESTRINGZ, 4326)
);

-- ============================================================================
-- ELEVATION POINTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS elevation_points (
    id SERIAL PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation REAL NOT NULL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROUTING NODES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS routing_nodes (
    id SERIAL PRIMARY KEY,
    node_uuid TEXT UNIQUE,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation REAL,
    node_type TEXT CHECK(node_type IN ('intersection', 'endpoint')) NOT NULL,
    connected_trails TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geo2 GEOMETRY(POINT, 4326)
);

-- ============================================================================
-- ROUTING EDGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS routing_edges (
    id SERIAL PRIMARY KEY,
    from_node_id INTEGER NOT NULL,
    to_node_id INTEGER NOT NULL,
    trail_id TEXT NOT NULL,
    trail_name TEXT NOT NULL,
    distance_km REAL NOT NULL,
    elevation_gain REAL NOT NULL DEFAULT 0,
    elevation_loss REAL NOT NULL DEFAULT 0,
    is_bidirectional BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geo2 GEOMETRY(LINESTRING, 4326),
    FOREIGN KEY (from_node_id) REFERENCES routing_nodes(id),
    FOREIGN KEY (to_node_id) REFERENCES routing_nodes(id)
);

-- ============================================================================
-- REGION METADATA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS region_metadata (
    id SERIAL PRIMARY KEY,
    region_name TEXT NOT NULL,
    bbox_min_lng REAL,
    bbox_max_lng REAL,
    bbox_min_lat REAL,
    bbox_max_lat REAL,
    trail_count INTEGER,
    processing_config JSONB, -- JSON configuration for processing options (e.g., useIntersectionNodes)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROUTE RECOMMENDATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_recommendations (
    id SERIAL PRIMARY KEY,
    route_uuid TEXT UNIQUE,
    region TEXT NOT NULL, -- Region identifier for multi-region support
    gpx_distance_km REAL,
    gpx_elevation_gain REAL,
    gpx_name TEXT,
    recommended_distance_km REAL,
    recommended_elevation_gain REAL,
    route_type TEXT,
    route_edges JSONB, -- JSON array of trail segments
    route_path JSONB, -- JSON array of coordinate points
    similarity_score REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Additional fields from gainiac schema for enhanced functionality
    input_distance_km REAL, -- Input distance for recommendations
    input_elevation_gain REAL, -- Input elevation for recommendations
    input_distance_tolerance REAL, -- Distance tolerance
    input_elevation_tolerance REAL, -- Elevation tolerance
    expires_at TIMESTAMP, -- Expiration timestamp
    usage_count INTEGER DEFAULT 0, -- Usage tracking
    complete_route_data JSONB, -- Complete route information as JSON
    trail_connectivity_data JSONB, -- Trail connectivity data as JSON
    request_hash TEXT -- Request hash for deduplication
);

-- ============================================================================
-- SPATIAL INDEXES
-- ============================================================================

-- Enhanced spatial indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails USING GIST (ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat));
CREATE INDEX IF NOT EXISTS idx_trails_geo2 ON trails USING GIST (geo2);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_surface ON trails(surface);
CREATE INDEX IF NOT EXISTS idx_trails_type ON trails(trail_type);

-- Optimized spatial indexes for bounding box queries
CREATE INDEX IF NOT EXISTS idx_trails_bbox_spatial ON trails USING GIST (ST_Envelope(geo2));
CREATE INDEX IF NOT EXISTS idx_trails_bbox_coords ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_trails_region_elevation ON trails(region, elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_region_length ON trails(region, length_km);
CREATE INDEX IF NOT EXISTS idx_trails_region_surface ON trails(region, surface);
CREATE INDEX IF NOT EXISTS idx_trails_region_type ON trails(region, trail_type);

-- Elevation points spatial index
CREATE INDEX IF NOT EXISTS idx_elevation_points_location ON elevation_points USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));

-- Routing nodes spatial index
CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);

-- Routing edges indexes
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_nodes ON routing_edges(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(distance_km);

-- Route recommendations indexes
CREATE INDEX IF NOT EXISTS idx_route_recommendations_distance ON route_recommendations(gpx_distance_km, recommended_distance_km);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_elevation ON route_recommendations(gpx_elevation_gain, recommended_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_uuid ON route_recommendations(route_uuid);
-- Additional indexes from gainiac schema for enhanced query performance
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region ON route_recommendations(region);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_input ON route_recommendations(input_distance_km, input_elevation_gain);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_created ON route_recommendations(created_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_expires ON route_recommendations(expires_at);
CREATE INDEX IF NOT EXISTS idx_route_recommendations_request_hash ON route_recommendations(request_hash);

-- NEW: Performance indices from gainiac schema-v9-with-optimizations.md (purely additive optimizations)

-- Enhanced Route Recommendations Indices (NEW)
CREATE INDEX IF NOT EXISTS idx_route_recommendations_region_hash ON route_recommendations(region, request_hash);

-- Routing Indices (NEW - Most Critical for Performance)
CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_nodes_elevation ON routing_nodes(elevation) WHERE elevation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_nodes_route_finding ON routing_nodes(id, lat, lng, elevation);
CREATE INDEX IF NOT EXISTS idx_routing_edges_from_node ON routing_edges(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail_distance ON routing_edges(trail_id, distance_km);
CREATE INDEX IF NOT EXISTS idx_routing_edges_elevation ON routing_edges(elevation_gain, elevation_loss);
CREATE INDEX IF NOT EXISTS idx_routing_edges_route_finding ON routing_edges(from_node_id, to_node_id, trail_id, distance_km, elevation_gain);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at on trails table
CREATE TRIGGER update_trails_updated_at 
    BEFORE UPDATE ON trails 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE trails IS 'Master trails table with 3D geo2 and elevation data';
COMMENT ON COLUMN trails.geo2 IS '3D LineString geo2 with elevation data (SRID: 4326)';
COMMENT ON COLUMN trails.elevation_gain IS 'Total elevation gain in meters';
COMMENT ON COLUMN trails.elevation_loss IS 'Total elevation loss in meters';
COMMENT ON COLUMN trails.length_km IS 'Trail length in kilometers';

COMMENT ON TABLE elevation_points IS 'Elevation data points from TIFF files';
COMMENT ON TABLE routing_nodes IS 'Intersection and endpoint nodes for routing';
COMMENT ON TABLE routing_edges IS 'Trail segments connecting routing nodes';
COMMENT ON TABLE route_recommendations IS 'GPX-based route recommendations'; 