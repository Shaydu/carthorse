-- Copy all functions from production database to test database
-- This script should be run after creating the test database structure

-- Copy the copy_and_split_trails_to_staging_native function (our fixed version)
CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native(staging_schema text, source_table text, region_filter text, bbox_min_lng real DEFAULT NULL::real, bbox_min_lat real DEFAULT NULL::real, bbox_max_lng real DEFAULT NULL::real, bbox_max_lat real DEFAULT NULL::real, trail_limit integer DEFAULT NULL::integer, tolerance_meters real DEFAULT get_intersection_tolerance()) RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    -- Add limit
    source_query := source_query || limit_clause;
    
    -- Step 1: Copy and split trails using native PostGIS ST_Split
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, 
            geometry, geometry_text, geometry_hash, created_at, updated_at
        )
        WITH trail_intersections AS (
            -- Find all intersection points between trails using 3D coordinates
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            -- Get all source trails (explicitly select only columns that exist in production)
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            -- Get trails that don't have intersections (keep original)
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            -- Combine both sets
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for all segments
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            -- Keep original elevation data
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            ST_AsText(split_geometry) as geometry_text,
            md5(ST_AsText(split_geometry)) as geometry_hash,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)  -- Only include valid geometries
          AND pt.app_uuid IS NOT NULL    -- Ensure app_uuid is not null
    $f$, staging_schema, source_query, source_query, source_query);
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, tolerance_meters);
    
    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;
    
    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    -- This ensures all UUID references are consistent after splitting
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);
    
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
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$_$;

-- Copy other essential functions from production
-- We'll need to get the actual function definitions from the production database
-- For now, let's create the basic ones we know we need

CREATE OR REPLACE FUNCTION public.get_intersection_tolerance() RETURNS real
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN 0.0001; -- Default tolerance in degrees
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_trail_intersections(staging_schema text, tolerance_meters real DEFAULT get_intersection_tolerance()) RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
    intersection_count integer := 0;
BEGIN
    -- Clear existing intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Detect intersections between trails
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            intersection_point as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(t1.geometry, t2.geometry))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5  -- Reduced from 10 to 5 meters
              AND ST_Length(t2.geometry::geography) > 5  -- Reduced from 10 to 5 meters
        ) intersections
        JOIN %I.trails t1 ON t1.app_uuid = intersections.t1_uuid
        JOIN %I.trails t2 ON t2.app_uuid = intersections.t2_uuid
        WHERE ST_Length(intersection_point::geography) = 0  -- Point intersections only
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersection points', intersection_count;
END;
$_$;

-- Add more functions as needed from production database 