-- Realistic Route Finding Algorithm
-- Designed to work with actual trail data characteristics

CREATE OR REPLACE FUNCTION find_routes_realistic(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 100.0,  -- Very permissive tolerance
    max_depth integer DEFAULT 4  -- Shorter max depth for shorter trails
) RETURNS TABLE(
    route_id text,
    start_node text,
    end_node text,
    total_distance_km float,
    total_elevation_gain float,
    route_path text[],
    route_edges text[],
    route_shape text,
    trail_count integer,
    similarity_score float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with ALL nodes (not just intersections)
            SELECT 
                id::text as start_node,
                id::text as current_node,
                id::text as end_node,
                ARRAY[id::text] as path,
                ARRAY[]::text[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target::text as current_node,
                e.target::text as end_node,
                rs.path || e.target::text,
                rs.edges || e.id::text,
                rs.total_distance_km + e.distance_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node::uuid = e.source
            WHERE rs.depth < $1  -- Limit depth
              AND e.target::text != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * 3.0  -- Very permissive: up to 300% of target
              AND rs.total_elevation_gain < $4 * 3.0  -- Very permissive: up to 300% of target
        ),
        valid_routes AS (
            -- Very permissive filtering for real trail data
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                -- Simplified route shape classification
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Very permissive similarity score
                GREATEST(0, 1 - ABS(total_distance_km - $2) / GREATEST($2, 0.1)) * 0.6 +
                GREATEST(0, 1 - ABS(total_elevation_gain - $4) / GREATEST($4, 10.0)) * 0.4 as similarity_score
            FROM route_search
            WHERE total_distance_km >= 0.1  -- Minimum 100m
              AND total_distance_km <= $2 * 5.0  -- Up to 500% of target
              AND total_elevation_gain >= 5.0  -- Minimum 5m elevation
              AND total_elevation_gain <= $4 * 5.0  -- Up to 500% of target
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            route_path,
            route_edges,
            route_shape,
            trail_count,
            similarity_score
        FROM valid_routes
        WHERE similarity_score >= 0.05  -- Very low threshold: 5% similarity
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT 50  -- More routes per pattern
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, tolerance_percent, target_elevation_gain;
END;
$$ LANGUAGE plpgsql;

-- Test the realistic algorithm
SELECT 'Realistic route finding algorithm created' as info;
SELECT 'Key changes for real trail data:' as info;
SELECT '- Starts from ALL nodes (not just intersections)' as change;
SELECT '- Very permissive tolerance (up to 500% of target)' as change;
SELECT '- Very low similarity threshold (5% vs 30%)' as change;
SELECT '- Minimum distance: 100m (vs 5km)' as change;
SELECT '- Minimum elevation: 5m (vs 200m)' as change;
SELECT '- More routes per pattern (50 vs 10)' as change;
SELECT '- Shorter max depth (4 vs 8) for shorter trails' as change; 