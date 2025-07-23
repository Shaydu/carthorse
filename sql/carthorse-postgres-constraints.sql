-- PostgreSQL constraints and validation for Carthorse
-- This file defines constraints, triggers, and validation functions for the master database

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add NOT NULL constraints to critical columns
ALTER TABLE trails 
ALTER COLUMN app_uuid SET NOT NULL,
ALTER COLUMN name SET NOT NULL,
ALTER COLUMN geo2 SET NOT NULL,
ALTER COLUMN length_km SET NOT NULL,
ALTER COLUMN elevation_gain SET NOT NULL,
ALTER COLUMN elevation_loss SET NOT NULL,
ALTER COLUMN bbox_min_lng SET NOT NULL,
ALTER COLUMN bbox_max_lng SET NOT NULL,
ALTER COLUMN bbox_min_lat SET NOT NULL,
ALTER COLUMN bbox_max_lat SET NOT NULL;

-- Add check constraints for data integrity
ALTER TABLE trails 
ADD CONSTRAINT chk_trails_length_positive
CHECK (length_km > 0),

ADD CONSTRAINT chk_trails_elevation_positive
CHECK (elevation_gain >= 0 AND elevation_loss >= 0),

ADD CONSTRAINT chk_trails_bbox_valid
CHECK (bbox_min_lng < bbox_max_lng AND bbox_min_lat < bbox_max_lat),

ADD CONSTRAINT chk_trails_bbox_bounds
CHECK (bbox_min_lng >= -180 AND bbox_max_lng <= 180 AND bbox_min_lat >= -90 AND bbox_max_lat <= 90),

ADD CONSTRAINT chk_trails_geo2_3d
CHECK (
    geo2 IS NULL OR
    (ST_NDims(geo2) = 3 AND ST_GeometryType(geo2) = 'ST_LineString')
),

ADD CONSTRAINT chk_trails_geo2_valid
CHECK (geo2 IS NULL OR ST_IsValid(geo2)),

ADD CONSTRAINT chk_trails_geo2_min_points
CHECK (geo2 IS NULL OR ST_NPoints(geo2) >= 2);

-- Add constraints for routing_nodes table
ALTER TABLE routing_nodes 
ADD CONSTRAINT chk_routing_nodes_lat_bounds
CHECK (lat >= -90 AND lat <= 90),

ADD CONSTRAINT chk_routing_nodes_lng_bounds
CHECK (lng >= -180 AND lng <= 180),

ADD CONSTRAINT chk_routing_nodes_elevation_bounds
CHECK (elevation >= -1000 AND elevation <= 10000),

ADD CONSTRAINT chk_routing_nodes_type_valid
CHECK (node_type IN ('intersection', 'endpoint')),

ADD CONSTRAINT chk_routing_nodes_geo2_valid
CHECK (geo2 IS NULL OR ST_IsValid(geo2)),

ADD CONSTRAINT chk_routing_nodes_geo2_2d
CHECK (geo2 IS NULL OR ST_NDims(geo2) = 2);

-- Add constraints for routing_edges table
ALTER TABLE routing_edges 
ADD CONSTRAINT chk_routing_edges_distance_positive
CHECK (distance_km > 0),

ADD CONSTRAINT chk_routing_edges_elevation_positive
CHECK (elevation_gain >= 0),

ADD CONSTRAINT chk_routing_edges_nodes_different
CHECK (from_node_id != to_node_id),

ADD CONSTRAINT chk_routing_edges_geo2_valid
CHECK (geo2 IS NULL OR ST_IsValid(geo2)),

ADD CONSTRAINT chk_routing_edges_geo2_2d
CHECK (geo2 IS NULL OR ST_NDims(geo2) = 2);

-- Create trigger function to validate trail data before insert/update
CREATE OR REPLACE FUNCTION validate_trail_completeness()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure required fields are present
    IF NEW.app_uuid IS NULL OR NEW.name IS NULL THEN
        RAISE EXCEPTION 'Trails must have app_uuid and name';
    END IF;

    -- Ensure geo2 is valid if present
    IF NEW.geo2 IS NOT NULL AND
       (ST_GeometryType(NEW.geo2) != 'ST_LineString' OR ST_NDims(NEW.geo2) != 3) THEN
        RAISE EXCEPTION 'geo2 must be a 3D LineString';
    END IF;

    -- Ensure 3D geo2 has elevation data
    IF NEW.geo2 IS NOT NULL AND ST_NDims(NEW.geo2) = 3 AND
       (NEW.elevation_gain IS NULL OR NEW.elevation_gain < 0) THEN
        RAISE EXCEPTION '3D geo2 must have valid elevation_gain data';
    END IF;

    -- Ensure bbox is calculated if geo2 exists
    IF NEW.geo2 IS NOT NULL AND
       (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
        NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
        RAISE EXCEPTION 'Trails with geo2 must have calculated bounding box';
    END IF;

    -- Ensure length is calculated if geo2 exists
    IF NEW.geo2 IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
        RAISE EXCEPTION 'Trails with geo2 must have calculated length_km';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-calculate bbox from geo2
CREATE OR REPLACE FUNCTION auto_calculate_bbox()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-calculate bbox if geo2 exists and bbox is missing
    IF NEW.geo2 IS NOT NULL AND
       (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
        NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
        
        NEW.bbox_min_lng := ST_XMin(NEW.geo2);
        NEW.bbox_max_lng := ST_XMax(NEW.geo2);
        NEW.bbox_min_lat := ST_YMin(NEW.geo2);
        NEW.bbox_max_lat := ST_YMax(NEW.geo2);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to auto-calculate length from geo2
CREATE OR REPLACE FUNCTION auto_calculate_length()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-calculate length if geo2 exists and length is missing
    IF NEW.geo2 IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
        NEW.length_km := ST_Length(NEW.geo2, true) / 1000.0; -- Convert meters to kilometers
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_validate_trail_completeness ON trails;
CREATE TRIGGER trigger_validate_trail_completeness
    BEFORE INSERT OR UPDATE ON trails
    FOR EACH ROW EXECUTE FUNCTION validate_trail_completeness();

DROP TRIGGER IF EXISTS trigger_auto_calculate_bbox ON trails;
CREATE TRIGGER trigger_auto_calculate_bbox
    BEFORE INSERT OR UPDATE ON trails
    FOR EACH ROW EXECUTE FUNCTION auto_calculate_bbox();

DROP TRIGGER IF EXISTS trigger_auto_calculate_length ON trails;
CREATE TRIGGER trigger_auto_calculate_length
    BEFORE INSERT OR UPDATE ON trails
    FOR EACH ROW EXECUTE FUNCTION auto_calculate_length();

-- Create spatial indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_trails_geo2_3d
ON trails USING GIST (geo2)
WHERE ST_NDims(geo2) = 3;

CREATE INDEX IF NOT EXISTS idx_trails_bbox_spatial
ON trails USING GIST (ST_MakeEnvelope(bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat));

CREATE INDEX IF NOT EXISTS idx_trails_region_name
ON trails(region, name);

CREATE INDEX IF NOT EXISTS idx_trails_elevation
ON trails(elevation_gain, elevation_loss);

CREATE INDEX IF NOT EXISTS idx_routing_nodes_location
ON routing_nodes USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));

CREATE INDEX IF NOT EXISTS idx_routing_nodes_type
ON routing_nodes(node_type);

-- Create views for data quality monitoring
CREATE OR REPLACE VIEW trails_missing_data AS
SELECT 
    id, app_uuid, name, region,
    CASE 
        WHEN geo2 IS NULL THEN 'Missing geo2'
        WHEN elevation_gain IS NULL THEN 'Missing elevation_gain'
        WHEN length_km IS NULL THEN 'Missing length_km'
        WHEN bbox_min_lng IS NULL THEN 'Missing bbox'
        ELSE 'Other'
    END as missing_field
FROM trails
WHERE geo2 IS NULL
   OR elevation_gain IS NULL
   OR length_km IS NULL
   OR bbox_min_lng IS NULL;

-- View to identify trails with 2D geo2 (should be 3D)
CREATE OR REPLACE VIEW trails_with_2d_geo2 AS
SELECT 
    id, app_uuid, name, region,
    ST_NDims(geo2) as dimensions,
    ST_GeometryType(geo2) as geometry_type
FROM trails
WHERE geo2 IS NOT NULL AND ST_NDims(geo2) = 2;

-- View to identify trails with invalid geo2
CREATE OR REPLACE VIEW trails_with_invalid_geo2 AS
SELECT 
    id, app_uuid, name, region,
    ST_IsValidReason(geo2) as validity_reason
FROM trails
WHERE geo2 IS NOT NULL AND NOT ST_IsValid(geo2);

-- Function to get data quality summary
CREATE OR REPLACE FUNCTION get_data_quality_summary()
RETURNS TABLE (
    issue_type TEXT,
    count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'Trails missing data'::TEXT
    FROM trails_missing_data
    UNION ALL
    SELECT 
        'Trails with 2D geo2 (should be 3D)'::TEXT
    FROM trails_with_2d_geo2
    UNION ALL
    SELECT 
        'Trails with invalid geo2'::TEXT
    FROM trails_with_invalid_geo2;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE trails IS 'Master trails table with 3D geo2 and elevation data';
COMMENT ON COLUMN trails.geo2 IS '3D LineString geo2 with elevation data (SRID: 4326)';
COMMENT ON COLUMN trails.elevation_gain IS 'Total elevation gain in meters';
COMMENT ON COLUMN trails.elevation_loss IS 'Total elevation loss in meters';
COMMENT ON COLUMN trails.length_km IS 'Trail length in kilometers';

COMMENT ON FUNCTION validate_trail_completeness() IS 'Ensures complete trails have all required elevation and geo2 data';
COMMENT ON FUNCTION auto_calculate_bbox() IS 'Automatically calculates bounding box from geo2';
COMMENT ON FUNCTION auto_calculate_length() IS 'Automatically calculates trail length from geo2'; 