-- Simplified Route Finding Algorithm
-- This version is less restrictive and should work with real trail data

CREATE OR REPLACE FUNCTION find_routes_simplified(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 50.0,  -- More permissive tolerance
    max_depth integer DEFAULT 6  -- Shorter max depth
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
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- More permissive filtering
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
                -- Simplified similarity score
                GREATEST(0, 1 - ABS(total_distance_km - $2) / $2) * 0.6 +
                GREATEST(0, 1 - ABS(total_elevation_gain - $4) / $4) * 0.4 as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * 0.3  -- Much more permissive: 30% of target
              AND total_distance_km <= $2 * 2.0  -- Up to 200% of target
              AND total_elevation_gain >= $4 * 0.3  -- 30% of target elevation
              AND total_elevation_gain <= $4 * 2.0  -- Up to 200% of target
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
        WHERE similarity_score >= 0.1  -- Much lower threshold: 10% similarity
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT 20  -- More routes per pattern
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, tolerance_percent, target_elevation_gain;
END;
$$ LANGUAGE plpgsql;

-- Test the simplified algorithm
SELECT 'Simplified route finding algorithm created' as info;
SELECT 'Key changes:' as info;
SELECT '- Starts from ALL nodes (not just intersections)' as change;
SELECT '- Much more permissive tolerance (50% vs 25%)' as change;
SELECT '- Lower similarity threshold (10% vs 30%)' as change;
SELECT '- Higher distance/elevation limits (up to 200% of target)' as change;
SELECT '- More routes per pattern (20 vs 10)' as change; 