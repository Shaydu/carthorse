-- Fixed route recommendations function
CREATE OR REPLACE FUNCTION find_routes_recursive_configurable(
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



CREATE OR REPLACE FUNCTION generate_route_recommendations_configurable(
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
            FROM find_routes_recursive_configurable(
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

-- pgRouting Strategy Pattern for Advanced Route Finding
CREATE OR REPLACE FUNCTION find_routes_pgrouting(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 20.0,
    max_depth integer DEFAULT 8
) RETURNS TABLE(
    route_id text,
    start_node uuid,
    end_node uuid,
    total_distance_km float,
    total_elevation_gain float,
    route_path uuid[],
    route_edges uuid[],
    route_shape text,
    trail_count integer,
    similarity_score float
) AS $$
DECLARE
    config_tolerance float;
    edge_sql text;
    node_sql text;
BEGIN
    config_tolerance := COALESCE(tolerance_percent, 20.0);
    
    -- Create a temporary nodes table with integer IDs (sample only)
    EXECUTE format('
        CREATE TEMP TABLE temp_nodes AS
        SELECT 
            row_number() OVER() as id,
            id as node_uuid,
            lat,
            lng,
            node_type
        FROM %I.routing_nodes
        WHERE node_type = ''intersection''
        LIMIT 50  -- Sample 50 nodes to get better coverage
    ', staging_schema);
    
    -- Create a temporary table with integer IDs for pgRouting
    EXECUTE format('
        CREATE TEMP TABLE temp_edges AS 
        SELECT 
            row_number() OVER() as id,
            n1.id as source,
            n2.id as target,
            e.length_km as cost,
            e.elevation_gain as reverse_cost
        FROM %I.routing_edges e
        JOIN temp_nodes n1 ON e.source = n1.node_uuid
        JOIN temp_nodes n2 ON e.target = n2.node_uuid
        WHERE e.length_km > 0
    ', staging_schema);
    
    RETURN QUERY EXECUTE format($f$
        WITH ksp_routes AS (
            -- Use pgr_ksp to find k-shortest paths (loops)
            SELECT 
                gen_random_uuid()::text as route_id,
                n.node_uuid as start_node,
                n.node_uuid as end_node,
                p.cost::double precision as total_distance_km,
                0.0::double precision as total_elevation_gain,
                ARRAY[n.node_uuid] as route_path,
                ARRAY[]::uuid[] as route_edges,
                CASE 
                    WHEN p.cost > 0.5 AND p.cost <= $1 * (1 + $2 / 100.0) THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                1 as trail_count,
                1.0::double precision as similarity_score
            FROM temp_nodes n
            CROSS JOIN LATERAL (
                SELECT cost FROM pgr_ksp(
                    'SELECT id, source, target, cost FROM temp_edges',
                    n.id::integer, n.id::integer, 3, false
                ) WHERE cost > 0.5 AND cost <= $1 * (1 + $2 / 100.0)
                LIMIT 1
            ) p
            WHERE p.cost IS NOT NULL
            LIMIT 20  -- Limit to prevent explosion
        ),
        all_routes AS (
            SELECT * FROM ksp_routes
        ),
        routes_with_elevation AS (
            SELECT 
                r.route_id,
                r.start_node,
                r.end_node,
                r.total_distance_km,
                r.route_path,
                r.route_edges,
                r.route_shape,
                r.trail_count,
                r.similarity_score,
                COALESCE(SUM(e.elevation_gain), 0)::double precision as calculated_elevation_gain,
                GREATEST(0.0, 1.0 - (
                    ABS(r.total_distance_km - $1) / $1 + 
                    ABS(COALESCE(SUM(e.elevation_gain), 0) - $3) / NULLIF($3, 0)
                ) / 2.0) as calculated_similarity_score
            FROM all_routes r
            LEFT JOIN %I.routing_edges e ON e.source = ANY(r.route_path) AND e.target = ANY(r.route_path)
            GROUP BY r.route_id, r.start_node, r.end_node, r.total_distance_km, r.route_path, r.route_edges, r.route_shape, r.trail_count, r.similarity_score
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            calculated_elevation_gain as total_elevation_gain,
            route_path,
            route_edges,
            route_shape,
            trail_count,
            calculated_similarity_score as similarity_score
        FROM routes_with_elevation
        WHERE calculated_elevation_gain >= $3 * (1 - $2 / 100.0)
          AND calculated_elevation_gain <= $3 * (1 + $2 / 100.0)
          AND calculated_similarity_score >= 0.3
        ORDER BY calculated_similarity_score DESC, total_distance_km
        LIMIT 50
    $f$, staging_schema)
    USING target_distance_km, config_tolerance, target_elevation_gain;
    
    -- Clean up temp tables
    DROP TABLE IF EXISTS temp_edges;
    DROP TABLE IF EXISTS temp_nodes;
END;
$$ LANGUAGE plpgsql;

-- Test function to compare pgRouting vs recursive approach
CREATE OR REPLACE FUNCTION test_route_strategies(
    staging_schema text,
    target_distance_km float DEFAULT 2.0,
    target_elevation_gain float DEFAULT 300.0
) RETURNS TABLE(
    strategy text,
    route_count integer,
    loop_count integer,
    out_and_back_count integer,
    point_to_point_count integer,
    avg_similarity_score float
) AS $$
BEGIN
    -- Test recursive strategy
    RETURN QUERY
    SELECT 
        'recursive' as strategy,
        COUNT(*)::integer as route_count,
        COUNT(*) FILTER (WHERE route_shape = 'loop')::integer as loop_count,
        COUNT(*) FILTER (WHERE route_shape = 'out-and-back')::integer as out_and_back_count,
        COUNT(*) FILTER (WHERE route_shape = 'point-to-point')::integer as point_to_point_count,
        AVG(similarity_score) as avg_similarity_score
    FROM find_routes_recursive_configurable(staging_schema, target_distance_km, target_elevation_gain, 30.0, 6);
    
    -- Test pgRouting strategy
    RETURN QUERY
    SELECT 
        'pgrouting' as strategy,
        COUNT(*)::integer as route_count,
        COUNT(*) FILTER (WHERE route_shape = 'loop')::integer as loop_count,
        COUNT(*) FILTER (WHERE route_shape = 'out-and-back')::integer as out_and_back_count,
        COUNT(*) FILTER (WHERE route_shape = 'point-to-point')::integer as point_to_point_count,
        AVG(similarity_score) as avg_similarity_score
    FROM find_routes_pgrouting(staging_schema, target_distance_km, target_elevation_gain, 30.0, 6);
END;
$$ LANGUAGE plpgsql; 