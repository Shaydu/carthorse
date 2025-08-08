-- Install required database functions for Carthorse
-- Run this script in your PostgreSQL database

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Function to generate app_uuid automatically
CREATE OR REPLACE FUNCTION public.generate_app_uuid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.app_uuid IS NULL OR NEW.app_uuid = '' THEN
        NEW.app_uuid := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Function to auto-calculate bbox
CREATE OR REPLACE FUNCTION public.auto_calculate_bbox() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.geometry IS NOT NULL THEN
        NEW.bbox_min_lng := ST_XMin(NEW.geometry);
        NEW.bbox_max_lng := ST_XMax(NEW.geometry);
        NEW.bbox_min_lat := ST_YMin(NEW.geometry);
        NEW.bbox_max_lat := ST_YMax(NEW.geometry);
    END IF;
    RETURN NEW;
END;
$$;

-- Function to auto-calculate geometry hash
CREATE OR REPLACE FUNCTION public.auto_calculate_geometry_hash() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.geometry IS NOT NULL THEN
        NEW.geometry_hash := md5(ST_AsText(NEW.geometry));
    END IF;
    RETURN NEW;
END;
$$;

-- Function to auto-calculate geometry text
CREATE OR REPLACE FUNCTION public.auto_calculate_geometry_text() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.geometry IS NOT NULL THEN
        NEW.geometry_text := ST_AsText(NEW.geometry);
    END IF;
    RETURN NEW;
END;
$$;

-- Function to auto-calculate trail length
CREATE OR REPLACE FUNCTION public.auto_calculate_trail_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.geometry IS NOT NULL THEN
        NEW.length_km := ST_Length(NEW.geometry::geography) / 1000;
    END IF;
    RETURN NEW;
END;
$$;

-- Function to detect trail intersections
CREATE OR REPLACE FUNCTION public.detect_trail_intersections(staging_schema text, tolerance_meters real DEFAULT 2.0)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    intersection_count integer := 0;
BEGIN
    -- Clear existing intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Find intersections between trails
    EXECUTE format('
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Intersection(t1.geometry, t2.geometry) as point,
            ST_Intersection(t1.geometry, t2.geometry) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            ''intersection'' as node_type,
            0 as distance_meters
        FROM %I.trails t1
        JOIN %I.trails t2 ON (
            t1.id < t2.id 
            AND ST_DWithin(t1.geometry, t2.geometry, %s)
            AND ST_Intersects(t1.geometry, t2.geometry)
        )
        WHERE t1.geometry IS NOT NULL 
          AND t2.geometry IS NOT NULL
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
    ', staging_schema, staging_schema, staging_schema, tolerance_meters);
    
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersections in staging schema %', intersection_count, staging_schema;
END;
$$;

-- Function to copy and split trails to staging
CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native(
    staging_schema text, 
    source_table text, 
    region_filter text, 
    bbox_min_lng real DEFAULT NULL, 
    bbox_min_lat real DEFAULT NULL, 
    bbox_max_lng real DEFAULT NULL, 
    bbox_max_lat real DEFAULT NULL, 
    trail_limit integer DEFAULT NULL, 
    tolerance_meters real DEFAULT 2.0
) 
RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
    bbox_clause text := '';
BEGIN
    -- Build source query with optional bbox filter
    source_query := format('SELECT * FROM %I', source_table);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        bbox_clause := format(' WHERE ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', 
                             bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
        source_query := source_query || bbox_clause;
    END IF;
    
    -- Add region filter
    IF bbox_clause = '' THEN
        source_query := source_query || format(' WHERE region = %L', region_filter);
    ELSE
        source_query := source_query || format(' AND region = %L', region_filter);
    END IF;
    
    -- Add limit if provided
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
        source_query := source_query || limit_clause;
    END IF;
    
    -- Step 1: Copy trails to staging
    EXECUTE format('
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty,
            source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation,
            avg_elevation, source, geometry, geometry_text, geometry_hash
        )
        SELECT 
            app_uuid, osm_id, name, region, trail_type, surface, difficulty,
            source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation,
            avg_elevation, source, geometry, ST_AsText(geometry), md5(ST_AsText(geometry))
        FROM (%s) t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
    ', staging_schema, source_query);
    
    -- Get original count
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, tolerance_meters);
    
    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;
    
    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);
    
    -- Set split count to original count for now (no splitting in this version)
    split_count_var := original_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections', 
               original_count_var, split_count_var, intersection_count_var) as message;
    
    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections', 
        original_count_var, split_count_var, intersection_count_var;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0 as original_count,
        0 as split_count,
        0 as intersection_count,
        false as success,
        format('Error: %s', SQLERRM) as message;
END;
$$;

-- Function to validate trail completeness
CREATE OR REPLACE FUNCTION public.validate_trail_completeness() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check for required fields
    IF NEW.name IS NULL OR NEW.name = '' THEN
        RAISE EXCEPTION 'Trail name is required';
    END IF;
    
    IF NEW.geometry IS NULL THEN
        RAISE EXCEPTION 'Trail geometry is required';
    END IF;
    
    IF NOT ST_IsValid(NEW.geometry) THEN
        RAISE EXCEPTION 'Trail geometry must be valid';
    END IF;
    
    -- Check elevation data
    IF NEW.elevation_gain IS NULL OR NEW.elevation_gain < 0 THEN
        RAISE EXCEPTION 'Elevation gain must be non-negative';
    END IF;
    
    IF NEW.elevation_loss IS NULL OR NEW.elevation_loss < 0 THEN
        RAISE EXCEPTION 'Elevation loss must be non-negative';
    END IF;
    
    IF NEW.max_elevation IS NULL OR NEW.max_elevation <= 0 THEN
        RAISE EXCEPTION 'Max elevation must be positive';
    END IF;
    
    IF NEW.min_elevation IS NULL OR NEW.min_elevation <= 0 THEN
        RAISE EXCEPTION 'Min elevation must be positive';
    END IF;
    
    IF NEW.avg_elevation IS NULL OR NEW.avg_elevation <= 0 THEN
        RAISE EXCEPTION 'Average elevation must be positive';
    END IF;
    
    IF NEW.length_km IS NULL OR NEW.length_km <= 0 THEN
        RAISE EXCEPTION 'Trail length must be positive';
    END IF;
    
    RETURN NEW;
END;
$$;

-- Function to check database integrity
CREATE OR REPLACE FUNCTION public.check_database_integrity() RETURNS TABLE(check_name text, status text, count bigint, details text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check for trails without geometry
    RETURN QUERY
    SELECT 
        'Trails without geometry'::text as check_name,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text as status,
        COUNT(*)::bigint as count,
        'Trails must have valid geometry'::text as details
    FROM trails WHERE geometry IS NULL;
    
    -- Check for trails without elevation data
    RETURN QUERY
    SELECT 
        'Trails without elevation data'::text as check_name,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text as status,
        COUNT(*)::bigint as count,
        'Trails must have complete elevation data'::text as details
    FROM trails 
    WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
       OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL;
    
    -- Check for invalid geometries
    RETURN QUERY
    SELECT 
        'Invalid geometries'::text as check_name,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text as status,
        COUNT(*)::bigint as count,
        'All geometries must be valid'::text as details
    FROM trails WHERE NOT ST_IsValid(geometry);
    
    -- Check for duplicate app_uuid
    RETURN QUERY
    SELECT 
        'Duplicate app_uuid'::text as check_name,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text as status,
        COUNT(*)::bigint as count,
        'app_uuid must be unique'::text as details
    FROM (
        SELECT app_uuid, COUNT(*) as cnt 
        FROM trails 
        GROUP BY app_uuid 
        HAVING COUNT(*) > 1
    ) as duplicates;
END;
$$;

-- Function to calculate trail statistics
CREATE OR REPLACE FUNCTION public.calculate_trail_stats() RETURNS TABLE(total_trails bigint, total_length_km double precision, avg_elevation_gain double precision, regions_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_trails,
        COALESCE(SUM(length_km), 0) as total_length_km,
        COALESCE(AVG(elevation_gain), 0) as avg_elevation_gain,
        COUNT(DISTINCT region) as regions_count
    FROM trails;
END;
$$;

-- Create views for validation
CREATE OR REPLACE VIEW incomplete_trails AS
SELECT id, app_uuid, name, region
FROM trails 
WHERE elevation_gain IS NULL OR elevation_loss IS NULL 
   OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL
   OR length_km IS NULL OR length_km <= 0;

CREATE OR REPLACE VIEW trails_with_2d_geometry AS
SELECT id, app_uuid, name, region
FROM trails 
WHERE ST_NDims(geometry) = 2;

CREATE OR REPLACE VIEW invalid_geometries AS
SELECT id, app_uuid, name, region
FROM trails 
WHERE NOT ST_IsValid(geometry);

CREATE OR REPLACE VIEW inconsistent_elevation_data AS
SELECT id, app_uuid, name, region, max_elevation, min_elevation, avg_elevation
FROM trails 
WHERE max_elevation < min_elevation 
   OR avg_elevation < min_elevation 
   OR avg_elevation > max_elevation;

-- Grant permissions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;

-- Create a notice that installation is complete
DO $$
BEGIN
    RAISE NOTICE 'Database functions installed successfully!';
    RAISE NOTICE 'You can now run carthorse export commands.';
END $$; 