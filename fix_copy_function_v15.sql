CREATE OR REPLACE FUNCTION copy_and_split_trails_to_staging_native_v15(
    staging_schema text,
    source_table text,
    region_filter text,
    bbox_min_lng numeric,
    bbox_min_lat numeric,
    bbox_max_lng numeric,
    bbox_max_lat numeric,
    trail_limit integer,
    tolerance_meters numeric
) RETURNS integer AS $$
DECLARE
    source_query text;
    full_sql text;
    result_count integer := 0;
BEGIN
    RAISE NOTICE 'DEBUG V15: Function called with parameters:';
    RAISE NOTICE '  staging_schema: %', staging_schema;
    RAISE NOTICE '  source_table: %', source_table;
    RAISE NOTICE '  region_filter: %', region_filter;
    RAISE NOTICE '  bbox_min_lng: %', bbox_min_lng;
    RAISE NOTICE '  bbox_min_lat: %', bbox_min_lat;
    RAISE NOTICE '  bbox_max_lng: %', bbox_max_lng;
    RAISE NOTICE '  bbox_max_lat: %', bbox_max_lat;
    RAISE NOTICE '  trail_limit: %', trail_limit;
    RAISE NOTICE '  tolerance_meters: %', tolerance_meters;
    
    -- Build source query using format() with %I for table name
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    RAISE NOTICE 'DEBUG V15: source_query: %', source_query;
    
    -- Build full SQL using format() to handle nulls properly
    full_sql := format($f$
        WITH source_trails AS (
            %s
        ),
        split_trails AS (
            SELECT 
                gen_random_uuid() as app_uuid,
                osm_id,
                name,
                region,
                ST_GeometryType(geometry) as geometry_type,
                geometry,
                elevation,
                length_meters,
                created_at,
                updated_at
            FROM source_trails
            WHERE ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
            LIMIT %s
        ),
        intersection_splits AS (
            SELECT 
                t.app_uuid,
                t.osm_id,
                t.name,
                t.region,
                t.geometry_type,
                CASE 
                    WHEN ST_Intersects(t.geometry, i.geometry) THEN 
                        ST_Split(t.geometry, i.geometry)
                    ELSE 
                        t.geometry
                END as split_geometry,
                t.elevation,
                t.length_meters,
                t.created_at,
                t.updated_at
            FROM split_trails t
            CROSS JOIN (
                SELECT geometry 
                FROM %I 
                WHERE region = %L
                AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
                AND ST_DWithin(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s)
            ) i
        )
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, geometry_type, geometry, elevation, length_meters, created_at, updated_at
        )
        SELECT 
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            geometry_type,
            split_geometry as geometry,
            elevation,
            length_meters,
            created_at,
            updated_at
        FROM intersection_splits
        WHERE ST_GeometryType(split_geometry) = 'LINESTRING'
        AND ST_Length(split_geometry) > 0;
    $f$, 
        source_query,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, trail_limit,
        source_table, region_filter,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
        bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, tolerance_meters,
        staging_schema
    );
    
    RAISE NOTICE 'DEBUG V15: About to execute full_sql';
    RAISE NOTICE 'DEBUG V15: full_sql: %', full_sql;
    
    EXECUTE full_sql;
    
    GET DIAGNOSTICS result_count = ROW_COUNT;
    
    RAISE NOTICE 'DEBUG V15: Inserted % rows', result_count;
    
    RETURN result_count;
END;
$$ LANGUAGE plpgsql; 