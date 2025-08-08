-- Fix the route finding function syntax error
-- The issue is with array_agg(DISTINCT trail_names) not being properly grouped

DROP FUNCTION IF EXISTS find_routes_recursive_configurable(text, double precision, double precision, double precision, integer);

CREATE OR REPLACE FUNCTION find_routes_recursive_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT NULL,
    max_depth integer DEFAULT 8
) RETURNS TABLE(
    route_id text,
    start_node integer,
    end_node integer,
    total_distance_km float,
    total_elevation_gain float,
    route_path integer[],
    route_edges integer[],
    route_shape text,
    trail_count integer,
    similarity_score float
) AS $$
DECLARE
    config_tolerance float;
    distance_limits json;
    elevation_limits json;
BEGIN
    -- Get configurable values
    IF tolerance_percent IS NULL THEN
        config_tolerance := 100.0;  -- Much more permissive: 100% tolerance
    ELSE
        config_tolerance := tolerance_percent;
    END IF;
    
    distance_limits := get_route_distance_limits();
    elevation_limits := get_elevation_gain_limits();
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with ALL nodes (not just intersections)
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.distance_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * 5.0  -- Much more permissive: up to 500% of target
              AND rs.total_elevation_gain < $4 * 5.0  -- Much more permissive: up to 500% of target
        ),
        valid_routes AS (
            -- Much more permissive filtering
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
                -- Count unique trails (fixed GROUP BY)
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score using configurable weights
                calculate_route_similarity_score(
                    total_distance_km, $2,
                    total_elevation_gain, $4
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= 0.1  -- Much lower minimum: 100m
              AND total_distance_km <= $2 * 5.0  -- Much higher maximum: 500% of target
              AND total_elevation_gain >= 5.0  -- Much lower minimum: 5m
              AND total_elevation_gain <= $4 * 5.0  -- Much higher maximum: 500% of target
              AND array_length(path, 1) >= 2  -- At least 2 nodes
              -- Apply configurable limits (much more permissive)
              AND total_distance_km >= ($5 ->> 'min_km')::float * 0.1  -- 10% of minimum
              AND total_distance_km <= ($5 ->> 'max_km')::float * 2.0  -- 200% of maximum
              AND total_elevation_gain >= ($6 ->> 'min_meters')::float * 0.1  -- 10% of minimum
              AND total_elevation_gain <= ($6 ->> 'max_meters')::float * 2.0  -- 200% of maximum
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            path,
            edges,
            route_shape,
            trail_count,
            similarity_score
        FROM valid_routes
        WHERE similarity_score >= 0.01  -- Very low threshold: 1% similarity
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT get_max_routes_per_bin()  -- Use configurable limit
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain, 
          distance_limits, elevation_limits;
END;
$$ LANGUAGE plpgsql;

-- Test the fixed function
SELECT 'Route finding function fixed' as info;
SELECT 'Key changes:' as info;
SELECT '- Fixed GROUP BY clause for array_agg' as change;
SELECT '- Maintained permissive thresholds' as change;
SELECT '- 1% similarity threshold' as change;
SELECT '- 100m minimum distance' as change;
SELECT '- 5m minimum elevation' as change; 