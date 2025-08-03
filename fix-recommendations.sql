-- Fixed route recommendations function
CREATE OR REPLACE FUNCTION find_routes_recursive_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 20.0,
    max_depth integer DEFAULT 8
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
DECLARE
    config_tolerance float;
BEGIN
    config_tolerance := COALESCE(tolerance_percent, 20.0);
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
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
            WHERE node_type = 'intersection'
            
            UNION ALL
            
            SELECT 
                rs.start_node,
                e.target::text as current_node,
                e.target::text as end_node,
                rs.path || e.target::text,
                rs.edges || e.id::text,
                rs.total_distance_km + e.length_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source::text
            WHERE rs.depth < $1
              AND e.target::text != ALL(rs.path)
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)
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
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
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



CREATE OR REPLACE FUNCTION generate_route_recommendations_configurable(
    staging_schema text,
    region_name text DEFAULT 'boulder'
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    total_routes integer := 0;
    pattern_distance float;
    pattern_elevation float;
    pattern_shape text;
    start_time timestamp;
BEGIN
    start_time := clock_timestamp();
    RAISE NOTICE 'Starting route recommendation generation at %', start_time;
    
    -- Pattern 1: Short loops (2-5km, 100-300m elevation)
    pattern_distance := 3.0;
    pattern_elevation := 200.0;
    pattern_shape := 'loop';
    
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
                    ORDER BY array_position(r.route_path, n.id::text)
                )
            )::jsonb as route_path,
            json_agg(r.route_edges)::jsonb as route_edges,
            %L || '' '' || r.route_shape || '' Route - '' || 
            ROUND(r.total_distance_km::numeric, 1) || ''km, '' || 
            ROUND(r.total_elevation_gain::numeric) || ''m gain'' as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            %L,
            %L,
            %L,
            20.0,  -- 20%% tolerance
            8
        ) r
        JOIN %I.routing_nodes n ON n.id::text = ANY(r.route_path)
        WHERE r.route_shape = %L
          AND r.similarity_score >= 0.3
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges
    ', staging_schema, region_name, pattern_distance, pattern_elevation, region_name,
       staging_schema, pattern_distance, pattern_elevation, staging_schema, pattern_shape);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for short loops', route_count;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql; 