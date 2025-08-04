-- Fix bbox calculation for trails with missing bbox data
-- This addresses the issue where trails in staging don't have bbox values calculated from geometry

-- Function to calculate bbox from geometry for trails with missing bbox data
CREATE OR REPLACE FUNCTION calculate_bbox_from_geometry(staging_schema text) RETURNS integer AS $$
DECLARE
    updated_count integer := 0;
BEGIN
    -- Calculate bbox from geometry for trails with missing bbox values
    EXECUTE format('
        UPDATE %I.trails 
        SET 
            bbox_min_lng = ST_XMin(geometry),
            bbox_max_lng = ST_XMax(geometry),
            bbox_min_lat = ST_YMin(geometry),
            bbox_max_lat = ST_YMax(geometry)
        WHERE geometry IS NOT NULL 
          AND (bbox_min_lng IS NULL OR bbox_max_lng IS NULL OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL)
    ', staging_schema);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % trails with bbox calculated from geometry', updated_count;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to validate bbox data after calculation
CREATE OR REPLACE FUNCTION validate_bbox_data(staging_schema text) RETURNS TABLE(
    total_trails bigint,
    missing_bbox bigint,
    invalid_bbox bigint,
    valid_bbox bigint
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            COUNT(*) as total_trails,
            COUNT(*) FILTER (WHERE bbox_min_lng IS NULL OR bbox_max_lng IS NULL OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL) as missing_bbox,
            COUNT(*) FILTER (WHERE bbox_min_lng > bbox_max_lng OR bbox_min_lat > bbox_max_lat) as invalid_bbox,
            COUNT(*) FILTER (WHERE bbox_min_lng IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lat IS NOT NULL 
                               AND bbox_min_lng <= bbox_max_lng AND bbox_min_lat <= bbox_max_lat) as valid_bbox
        FROM %I.trails
    ', staging_schema);
END;
$$ LANGUAGE plpgsql; 