-- Fixed route recommendations function for UUID-based schema
CREATE OR REPLACE FUNCTION find_routes_recursive_configurable_uuid(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 20.0,
    max_depth integer DEFAULT 8
) RETURNS TABLE(
    route_id text,
    start_node uuid,
    end_node uuid,
    total_distance_km double precision,
    total_elevation_gain double precision,
    route_path uuid[],
    route_edges uuid[],
    route_shape text,
    trail_count integer,
    similarity_score double precision
) AS $$
DECLARE
    config_tolerance float;
BEGIN
    config_tolerance := COALESCE(tolerance_percent, 20.0);
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::uuid[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            WHERE node_type = 'intersection'
            
            UNION ALL
            
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.length_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1
              AND (e.target != ALL(rs.path) OR (rs.depth > 1 AND e.target = rs.start_node))
              -- Early termination: stop if we exceed limits
              AND rs.total_distance_km + e.length_km <= $2 * (1 + $3 / 100.0)
              AND rs.total_elevation_gain + COALESCE(e.elevation_gain, 0) <= $4 * (1 + $3 / 100.0)
              -- Only continue if we're making progress toward target
              AND rs.total_distance_km + e.length_km >= $2 * 0.3  -- At least 30%% of target
              AND rs.total_elevation_gain + COALESCE(e.elevation_gain, 0) >= $4 * 0.3
        ),
        valid_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 AND start_node = end_node THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                GREATEST(0.0, 1.0 - (
                    ABS(total_distance_km - $2) / $2 + 
                    ABS(total_elevation_gain - $4) / NULLIF($4, 0)
                ) / 2.0) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)
              AND total_distance_km <= $2 * (1 + $3 / 100.0)
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)
              AND array_length(path, 1) >= 2
              AND total_distance_km >= 0.5
              AND total_distance_km <= 50.0
              AND total_elevation_gain >= 0
              AND total_elevation_gain <= 2000
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
        WHERE similarity_score >= 0.3
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT 50
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain;
END;
$$ LANGUAGE plpgsql;

-- Fixed route recommendations generation function for UUID schema
CREATE OR REPLACE FUNCTION generate_route_recommendations_uuid(
    staging_schema text,
    region_name text DEFAULT 'boulder'
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    total_routes integer := 0;
    pattern_distance float;
    pattern_elevation float;
    start_time timestamp;
BEGIN
    start_time := clock_timestamp();
    RAISE NOTICE 'Starting route recommendation generation at %', start_time;
    
    pattern_distance := 2.0;
    pattern_elevation := 300.0;
    
    EXECUTE format('
        INSERT INTO %I.route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            %L as region,
            %L,
            %L,
            r.total_distance_km,
            r.total_elevation_gain,
            ''similar_distance'' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                ''type'', ''LineString'',
                ''coordinates'', array_agg(
                    json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            json_agg(r.route_edges)::jsonb as route_edges,
            %L || '' '' || r.route_shape || '' Route - '' || 
            ROUND(r.total_distance_km::numeric, 1) || ''km, '' || 
            ROUND(r.total_elevation_gain::numeric) || ''m gain'' as route_name,
            NOW() as created_at
        FROM (
            SELECT DISTINCT ON (r.route_path) r.*
            FROM find_routes_recursive_configurable_uuid(
                %L,
                %L,
                %L,
                20.0,  -- 20%% tolerance
                8
            ) r
            WHERE r.route_shape = ANY(ARRAY[''loop'', ''point-to-point'', ''out-and-back''])
              AND r.similarity_score >= 0.3
            ORDER BY r.route_path, r.similarity_score DESC
        ) r
        JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges
    ', staging_schema, region_name, pattern_distance, pattern_elevation, region_name,
       staging_schema, pattern_distance, pattern_elevation, staging_schema);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes', route_count;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Create a wrapper function that matches the expected signature
CREATE OR REPLACE FUNCTION generate_route_recommendations(staging_schema text) RETURNS integer AS $$
BEGIN
    RETURN generate_route_recommendations_uuid(staging_schema, 'boulder');
END;
$$ LANGUAGE plpgsql; 