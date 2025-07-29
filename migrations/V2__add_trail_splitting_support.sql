-- Migration V2: Add Trail Splitting Support
-- Upgrades schema from v1 to v2 to support trail splitting functionality
-- Adds split_trails table, enhanced intersection_points table, and related indexes

-- =====================================================
-- ADD SPLIT_TRAILS TABLE
-- =====================================================
CREATE TABLE split_trails (
    id SERIAL PRIMARY KEY,
    original_trail_id INTEGER NOT NULL,
    segment_number INTEGER NOT NULL,
    app_uuid TEXT UNIQUE NOT NULL,
    name TEXT,
    trail_type TEXT,
    surface TEXT,
    difficulty TEXT,
    source_tags JSONB,
    osm_id TEXT,
    elevation_gain REAL,
    elevation_loss REAL,
    max_elevation REAL,
    min_elevation REAL,
    avg_elevation REAL,
    length_km REAL,
    source TEXT,
    geometry GEOMETRY(LINESTRINGZ, 4326),
    bbox_min_lng REAL,
    bbox_max_lng REAL,
    bbox_min_lat REAL,
    bbox_max_lat REAL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ADD INTERSECTION_POINTS TABLE
-- =====================================================
CREATE TABLE intersection_points (
    id SERIAL PRIMARY KEY,
    point GEOMETRY(POINT, 4326),
    point_3d GEOMETRY(POINTZ, 4326),
    connected_trail_ids TEXT[],
    connected_trail_names TEXT[],
    node_type TEXT,
    distance_meters REAL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ADD TRAIL_HASHES TABLE (for caching)
-- =====================================================
CREATE TABLE trail_hashes (
    id SERIAL PRIMARY KEY,
    app_uuid TEXT NOT NULL,
    geometry_hash TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ADD INDEXES FOR NEW TABLES
-- =====================================================

-- Split trails indexes
CREATE INDEX idx_split_trails_original_trail_id ON split_trails(original_trail_id);
CREATE INDEX idx_split_trails_segment_number ON split_trails(segment_number);
CREATE INDEX idx_split_trails_app_uuid ON split_trails(app_uuid);
CREATE INDEX idx_split_trails_geometry ON split_trails USING GIST(geometry);
CREATE INDEX idx_split_trails_bbox ON split_trails USING GIST(ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat));

-- Intersection points indexes
CREATE INDEX idx_intersection_points_point ON intersection_points USING GIST(point);
CREATE INDEX idx_intersection_points_point_3d ON intersection_points USING GIST(point_3d);
CREATE INDEX idx_intersection_points_node_type ON intersection_points(node_type);

-- Trail hashes indexes
CREATE INDEX idx_trail_hashes_app_uuid ON trail_hashes(app_uuid);
CREATE INDEX idx_trail_hashes_geometry_hash ON trail_hashes(geometry_hash);

-- =====================================================
-- ADD FOREIGN KEY CONSTRAINTS
-- =====================================================

-- Link split_trails to original trails
ALTER TABLE split_trails ADD CONSTRAINT fk_split_trails_original_trail 
    FOREIGN KEY (original_trail_id) REFERENCES trails(id) ON DELETE CASCADE;

-- =====================================================
-- ADD CHECK CONSTRAINTS FOR NEW TABLES
-- =====================================================

-- Split trails constraints
ALTER TABLE split_trails ADD CONSTRAINT chk_split_trails_segment_number_positive CHECK (segment_number > 0);
ALTER TABLE split_trails ADD CONSTRAINT chk_split_trails_elevation_gain_non_negative CHECK (elevation_gain >= 0);
ALTER TABLE split_trails ADD CONSTRAINT chk_split_trails_elevation_loss_non_negative CHECK (elevation_loss >= 0);
ALTER TABLE split_trails ADD CONSTRAINT chk_split_trails_elevation_order CHECK (max_elevation >= min_elevation);
ALTER TABLE split_trails ADD CONSTRAINT chk_split_trails_valid_geometry CHECK (ST_IsValid(geometry));
ALTER TABLE split_trails ADD CONSTRAINT chk_split_trails_min_points CHECK (ST_NPoints(geometry) >= 2);

-- Intersection points constraints
ALTER TABLE intersection_points ADD CONSTRAINT chk_intersection_points_valid_point CHECK (ST_IsValid(point));
ALTER TABLE intersection_points ADD CONSTRAINT chk_intersection_points_valid_point_3d CHECK (point_3d IS NULL OR ST_IsValid(point_3d));
ALTER TABLE intersection_points ADD CONSTRAINT chk_intersection_points_node_type_valid CHECK (node_type IS NULL OR node_type IN ('intersection', 'endpoint', 'trailhead'));
ALTER TABLE intersection_points ADD CONSTRAINT chk_intersection_points_distance_positive CHECK (distance_meters IS NULL OR distance_meters >= 0);

-- Trail hashes constraints
ALTER TABLE trail_hashes ADD CONSTRAINT chk_trail_hashes_hash_not_empty CHECK (geometry_hash != '');

-- =====================================================
-- UPDATE SCHEMA VERSION
-- =====================================================
INSERT INTO schema_version (version) VALUES ('v2');

-- =====================================================
-- ADD COMMENTS FOR DOCUMENTATION
-- =====================================================
COMMENT ON TABLE split_trails IS 'Stores individual trail segments created by splitting trails at intersections';
COMMENT ON COLUMN split_trails.original_trail_id IS 'Reference to the original unsplit trail';
COMMENT ON COLUMN split_trails.segment_number IS 'Sequential segment number (1, 2, 3...) within the original trail';

COMMENT ON TABLE intersection_points IS 'Stores intersection points between trails for routing and analysis';
COMMENT ON COLUMN intersection_points.connected_trail_ids IS 'Array of trail IDs that connect at this intersection';
COMMENT ON COLUMN intersection_points.connected_trail_names IS 'Array of trail names that connect at this intersection';

COMMENT ON TABLE trail_hashes IS 'Cache table for trail geometry hashes to avoid duplicate processing';
COMMENT ON COLUMN trail_hashes.geometry_hash IS 'Hash of trail geometry for duplicate detection'; 