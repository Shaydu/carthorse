-- PostgreSQL Master Database Schema for Trail Data
-- This schema supports concurrent access and spatial operations

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create schema version table
CREATE TABLE IF NOT EXISTS schema_version (
    id SERIAL PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial schema version
INSERT INTO schema_version (version) VALUES (7) ON CONFLICT DO NOTHING;

-- Main trails table with PostGIS geometry
CREATE TABLE IF NOT EXISTS trails (
    id SERIAL PRIMARY KEY,
    app_uuid TEXT UNIQUE NOT NULL,
    osm_id TEXT,
    source TEXT DEFAULT 'osm',
    name TEXT,
    trail_type TEXT,
    surface TEXT,
    difficulty TEXT,
    elevation_gain REAL,
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
    geometry geometry(LineStringZ,4326) NOT NULL,
    elevation_loss REAL,
    region TEXT -- Track which region this trail belongs to
);

-- Elevation points table
CREATE TABLE IF NOT EXISTS elevation_points (
    id SERIAL PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation INTEGER NOT NULL,
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lat, lng)
);

-- Routing nodes table
CREATE TABLE IF NOT EXISTS routing_nodes (
    id SERIAL PRIMARY KEY,
    node_id TEXT UNIQUE NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    elevation REAL,
    node_type TEXT DEFAULT 'intersection',
    geometry GEOMETRY(POINT, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Routing edges table
CREATE TABLE IF NOT EXISTS routing_edges (
    id SERIAL PRIMARY KEY,
    from_node_id INTEGER NOT NULL,
    to_node_id INTEGER NOT NULL,
    trail_id TEXT NOT NULL,
    trail_name TEXT NOT NULL,
    distance_km REAL NOT NULL,
    elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
    elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
    is_bidirectional BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    geometry GEOMETRY(LINESTRING, 4326),
    FOREIGN KEY (from_node_id) REFERENCES routing_nodes(id),
    FOREIGN KEY (to_node_id) REFERENCES routing_nodes(id)
);

-- Route recommendations table (enhanced v9 with additional fields)
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

-- Enhanced spatial indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
CREATE INDEX IF NOT EXISTS idx_trails_osm_id ON trails(osm_id);
CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails USING GIST (ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat));
CREATE INDEX IF NOT EXISTS idx_trails_geom ON trails USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_trails_elevation ON trails(elevation_gain);
CREATE INDEX IF NOT EXISTS idx_trails_surface ON trails(surface);
CREATE INDEX IF NOT EXISTS idx_trails_type ON trails(trail_type);

-- Optimized spatial indexes for bounding box queries
CREATE INDEX IF NOT EXISTS idx_trails_bbox_spatial ON trails USING GIST (ST_Envelope(geometry));
CREATE INDEX IF NOT EXISTS idx_trails_bbox_coords ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_trails_region_bbox ON trails(region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_trails_region_elevation ON trails(region, elevation_gain);

CREATE INDEX IF NOT EXISTS idx_elevation_points_location ON elevation_points(lat, lng);
CREATE INDEX IF NOT EXISTS idx_elevation_points_elevation ON elevation_points(elevation);
CREATE INDEX IF NOT EXISTS idx_elevation_points_spatial ON elevation_points USING GIST (ST_SetSRID(ST_Point(lng, lat), 4326));

-- Enhanced routing node indexes
CREATE INDEX IF NOT EXISTS idx_routing_nodes_location ON routing_nodes USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_type ON routing_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_coords ON routing_nodes(lat, lng);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_spatial ON routing_nodes USING GIST (ST_SetSRID(ST_Point(lng, lat), 4326));

-- Enhanced routing edge indexes
CREATE INDEX IF NOT EXISTS idx_routing_edges_trail ON routing_edges(trail_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_nodes ON routing_edges(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_routing_edges_geometry ON routing_edges USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_routing_edges_distance ON routing_edges(distance_km);
CREATE INDEX IF NOT EXISTS idx_routing_edges_elevation ON routing_edges(elevation_gain);

-- Route recommendations indexes (enhanced v9)
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

-- Spatial indexes for PostGIS (optimized)
CREATE INDEX IF NOT EXISTS idx_trails_geom_spatial ON trails USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_geometry_spatial ON routing_nodes USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_routing_edges_geometry_spatial ON routing_edges USING GIST (geometry);

-- Ensure GIST indexes for all geometry columns
CREATE INDEX IF NOT EXISTS idx_trails_geometry_gist ON trails USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_routing_nodes_geometry_gist ON routing_nodes USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_routing_edges_geometry_gist ON routing_edges USING GIST (geometry);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_trails_updated_at BEFORE UPDATE ON trails
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate trail statistics
CREATE OR REPLACE FUNCTION calculate_trail_stats()
RETURNS TABLE (
    total_trails BIGINT,
    total_length_km DOUBLE PRECISION,
    avg_elevation_gain DOUBLE PRECISION,
    regions_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_trails,
        COALESCE(SUM(length_km), 0) as total_length_km,
        COALESCE(AVG(elevation_gain), 0) as avg_elevation_gain,
        COUNT(DISTINCT region) as regions_count
    FROM trails;
END;
$$ LANGUAGE plpgsql; 