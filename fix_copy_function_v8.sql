-- Fixed copy function that properly implements Option B - V8
-- Copy all original trails, then replace intersecting trails with split segments
CREATE OR REPLACE FUNCTION copy_and_split_trails_to_staging_native_v8(
    staging_schema text, 
    source_table text, 
    region_filter text, 
    bbox_min_lng real DEFAULT NULL::real, 
    bbox_min_lat real DEFAULT NULL::real, 
    bbox_max_lng real DEFAULT NULL::real, 
    bbox_max_lat real DEFAULT NULL::real, 
    trail_limit integer DEFAULT NULL::integer, 
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text) AS $$
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

    source_query := source_query || limit_clause;

    -- Step 1: Copy ALL original trails to staging first
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        SELECT
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM (%s) AS source_trails
        WHERE ST_IsValid(geometry)
          AND app_uuid IS NOT NULL
    $f$, staging_schema, source_query);

    GET DIAGNOSTICS original_count_var = ROW_COUNT;

    -- Step 2: Find ALL intersections and identify trails that need splitting
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
        trails_to_split AS (
            SELECT DISTINCT t.app_uuid
            FROM %I.trails t
            JOIN trail_intersections ti ON t.app_uuid = ti.trail1_uuid OR t.app_uuid = ti.trail2_uuid
            WHERE ti.intersection_point IS NOT NULL
        )
        -- DELETE the original trails that need to be split
        DELETE FROM %I.trails 
        WHERE app_uuid IN (SELECT app_uuid FROM trails_to_split)
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);

    -- Step 3: Insert the split segments for trails that had intersections
    EXECUTE format($f$
        WITH trail_intersections AS (
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
        trails_to_split AS (
            SELECT DISTINCT t.app_uuid
            FROM (%s) t
            JOIN trail_intersections ti ON t.app_uuid = ti.trail1_uuid OR t.app_uuid = ti.trail2_uuid
            WHERE ti.intersection_point IS NOT NULL
        ),
        split_segments AS (
            SELECT 
                t.app_uuid,
                t.osm_id,
                t.name,
                t.region,
                t.trail_type,
                t.surface,
                t.difficulty,
                t.source_tags,
                t.bbox_min_lng,
                t.bbox_max_lng,
                t.bbox_min_lat,
                t.bbox_max_lat,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                t.max_elevation,
                t.min_elevation,
                t.avg_elevation,
                t.source,
                (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path as split_path
            FROM (%s) t
            JOIN trail_intersections ti ON t.app_uuid = ti.trail1_uuid OR t.app_uuid = ti.trail2_uuid
            JOIN trails_to_split tts ON t.app_uuid = tts.app_uuid
            WHERE ti.intersection_point IS NOT NULL
        )
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        SELECT
            app_uuid || '_split_' || split_path[1] as app_uuid,
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
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM split_segments
        WHERE ST_IsValid(split_geometry)
          AND split_geometry IS NOT NULL
    $f$, source_query, source_query, source_query, source_query, staging_schema);

    GET DIAGNOSTICS split_count_var = ROW_COUNT;

    -- Step 4: Generate intersection points
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ) AS intersections
    $f$, staging_schema, tolerance_meters, staging_schema, staging_schema);

    GET DIAGNOSTICS intersection_count_var = ROW_COUNT;

    RETURN QUERY SELECT 
        original_count_var, 
        split_count_var, 
        intersection_count_var, 
        true, 
        format('Successfully copied and split %s trails with %s intersections (v8)', split_count_var, intersection_count_var);

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 0, 0, 0, false, format('Error during copy and split (v8): %s', SQLERRM);
END;
$$ LANGUAGE plpgsql; 