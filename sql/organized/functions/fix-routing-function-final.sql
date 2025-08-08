-- Final fix for find_routes_recursive_configurable function
-- This version works with staging schema UUIDs and correct column names

CREATE OR REPLACE FUNCTION public.find_routes_recursive_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT NULL::double precision, max_depth integer DEFAULT 8)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    config_tolerance float;
    distance_limits json;
    elevation_limits json;
BEGIN
    -- Get configurable values
    IF tolerance_percent IS NULL THEN
        config_tolerance := 20.0;  -- Default from config
    ELSE
        config_tolerance := tolerance_percent;
    END IF;
    
    distance_limits := get_route_distance_limits();
    elevation_limits := get_elevation_gain_limits();
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            -- Use row_number to create integer IDs from UUIDs
            SELECT 
                (row_number() OVER (ORDER BY id))::integer as start_node,
                (row_number() OVER (ORDER BY id))::integer as current_node,
                (row_number() OVER (ORDER BY id))::integer as end_node,
                ARRAY[(row_number() OVER (ORDER BY id))::integer] as path,
                ARRAY[]::integer[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names,
                id as original_node_id  -- Keep original UUID for reference
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            -- Use correct column names (source/target) and handle UUIDs
            SELECT 
                rs.start_node,
                (row_number() OVER (ORDER BY e.target))::integer as current_node,
                (row_number() OVER (ORDER BY e.target))::integer as end_node,
                rs.path || (row_number() OVER (ORDER BY e.target))::integer,
                rs.edges || (row_number() OVER (ORDER BY e.id))::integer,
                rs.total_distance_km + e.length_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name,
                e.target as original_node_id
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.original_node_id = e.source  -- Use source/target columns
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score
                calculate_route_similarity_score(
                    total_distance_km, $2,
                    total_elevation_gain, $4
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain;
END;
$function$; 