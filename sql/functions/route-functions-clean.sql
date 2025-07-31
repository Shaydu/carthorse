-- Clean route finding functions without staging schema constraints

-- Function to find routes recursively
CREATE OR REPLACE FUNCTION public.find_routes_recursive(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT 20.0, max_depth integer DEFAULT 8) RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::double precision as total_distance,
                0.0::double precision as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            WHERE node_type IN ('intersection', 'endpoint')
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                (rs.total_distance + e.distance_km)::double precision,
                (rs.total_elevation_gain + COALESCE(e.elevation_gain, 0))::double precision,
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation_gain,
                path as route_path,
                edges as route_edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score (0-1)
                calculate_route_similarity_score(total_distance, $2, total_elevation_gain, $4) as similarity_score
            FROM route_search
            WHERE total_distance >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_distance <= $2 * (1 + $3 / 100.0)  -- Maximum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)  -- Maximum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance, total_elevation_gain, route_path, route_edges
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
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT get_max_routes_per_bin()  -- Limit results
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, tolerance_percent, target_elevation_gain;
END;
$_$;

-- Function to generate route recommendations
CREATE OR REPLACE FUNCTION public.generate_route_recommendations(staging_schema text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    route_count integer := 0;
    pattern record;
BEGIN
    -- Define common route patterns
    CREATE TEMP TABLE route_patterns (
        pattern_name text,
        target_distance_km float,
        target_elevation_gain float,
        route_shape text,
        tolerance_percent float
    );
    
    -- Insert common route patterns
    INSERT INTO route_patterns VALUES
        ('Short Loop', 3.0, 150.0, 'loop', 30.0),
        ('Medium Loop', 5.0, 250.0, 'loop', 30.0),
        ('Short Out-and-Back', 2.5, 100.0, 'out-and-back', 30.0),
        ('Medium Out-and-Back', 4.0, 200.0, 'out-and-back', 30.0),
        ('Short Point-to-Point', 3.5, 180.0, 'point-to-point', 30.0),
        ('Medium Point-to-Point', 5.5, 300.0, 'point-to-point', 30.0);
    
    -- Generate recommendations for each pattern
    FOR pattern IN SELECT * FROM route_patterns LOOP
        INSERT INTO route_recommendations (
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
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                'type', 'LineString',
                'coordinates', r.route_path
            ) as route_path,
            -- Convert edges to JSON array
            to_jsonb(r.route_edges) as route_edges,
            NOW() as created_at
        FROM find_routes_recursive(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Only good matches
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges, r.route_path;
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    DROP TABLE route_patterns;
    RETURN route_count;
END;
$$; 