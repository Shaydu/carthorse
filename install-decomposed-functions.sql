-- Install the two new decomposed functions
-- Function 1: Copy trails to staging (decomposed from v16)
CREATE OR REPLACE FUNCTION public.copy_trails_to_staging_v1(
    staging_schema text, 
    source_table text, 
    region_filter text, 
    bbox_min_lng numeric DEFAULT NULL::numeric, 
    bbox_min_lat numeric DEFAULT NULL::numeric, 
    bbox_max_lng numeric DEFAULT NULL::numeric, 
    bbox_max_lat numeric DEFAULT NULL::numeric, 
    trail_limit integer DEFAULT NULL::integer
)
RETURNS TABLE(
    original_count integer, 
    copied_count integer, 
    success boolean, 
    message text
)
LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    copied_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    RAISE NOTICE 'COPY V1: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  source_table: %', source_table;
    RAISE NOTICE '  region_filter: %', region_filter;
    RAISE NOTICE '  bbox_min_lng: %', bbox_min_lng;
    RAISE NOTICE '  bbox_min_lat: %', bbox_min_lat;
    RAISE NOTICE '  bbox_max_lng: %', bbox_max_lng;
    RAISE NOTICE '  bbox_max_lat: %', bbox_max_lat;
    RAISE NOTICE '  trail_limit: %', trail_limit;

    -- Ensure staging schema exists
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', staging_schema);
    
    -- Ensure staging tables exist (create if they don't)
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.trails (
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
        elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
        elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    $f$, staging_schema);

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

    source_query := source_query || limit_clause;

    RAISE NOTICE 'COPY V1: source_query: %', source_query;

    -- Copy trails to staging (without splitting)
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        SELECT
            app_uuid,
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM (%s) t 
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry)
          AND t.app_uuid IS NOT NULL
    $f$, staging_schema, source_query);

    GET DIAGNOSTICS copied_count_var = ROW_COUNT;

    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;

    -- Create basic indexes for performance
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);

    -- Return results
    RETURN QUERY SELECT
        original_count_var,
        copied_count_var,
        true as success,
        format('Successfully copied %s trails to staging (from %s original)',
               copied_count_var, original_count_var) as message;

    RAISE NOTICE 'COPY V1: Copied %s trails to staging (from %s original)',
        copied_count_var, original_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, 0, false,
        format('Error during copy to staging: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during copy to staging: %', SQLERRM;
END;
$function$;

-- Function 2: Split trails in staging (decomposed from v16)
CREATE OR REPLACE FUNCTION public.split_trails_in_staging_v1(
    staging_schema text, 
    tolerance_meters numeric DEFAULT 1.0
)
RETURNS TABLE(
    original_count integer, 
    split_count integer, 
    intersection_count integer, 
    success boolean, 
    message text
)
LANGUAGE plpgsql
AS $function$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
BEGIN
    RAISE NOTICE 'SPLIT V1: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  tolerance_meters: %', tolerance_meters;

    -- Get original count before splitting
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO original_count_var;

    -- Clear intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);

    -- Step 1: Split trails at intersection points using native PostGIS ST_Split
    EXECUTE format($f$
        WITH trail_intersections AS (
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        trails_with_intersections AS (
            SELECT
                t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
                t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
                t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
                t.source, t.created_at, t.updated_at, t.geometry,
                (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
            FROM %I.trails t
            JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            SELECT
                t.id, t.app_uuid, t.osm_id, t.name, t.region, t.trail_type, t.surface, t.difficulty, t.source_tags,
                t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
                t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
                t.source, t.created_at, t.updated_at, t.geometry,
                t.geometry as split_geometry,
                1 as segment_order
            FROM %I.trails t
            WHERE t.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        -- Replace existing trails with split versions
        DELETE FROM %I.trails;
        
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        SELECT
            gen_random_uuid() as app_uuid,
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
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)
          AND pt.app_uuid IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);

    GET DIAGNOSTICS split_count_var = ROW_COUNT;

    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, 'trails', tolerance_meters);

    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Recreate optimized spatial indexes
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
        format('Successfully split %s trails into %s segments with %s intersections',
               original_count_var, split_count_var, intersection_count_var) as message;

    RAISE NOTICE 'SPLIT V1: Split %s trails into %s segments with %s intersections',
        original_count_var, split_count_var, intersection_count_var;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT
        0, 0, 0, false,
        format('Error during split in staging: %s', SQLERRM) as message;

    RAISE NOTICE 'Error during split in staging: %', SQLERRM;
END;
$function$; 