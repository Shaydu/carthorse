-- =============================================================================
-- POSTGIS-BASED ROUTING FUNCTIONS
-- =============================================================================
-- These functions use PostGIS spatial functions for routing
-- Works with our current schema (WGS84 coordinates, routing_nodes/routing_edges)
-- =============================================================================

-- Function to find routes using PostGIS spatial functions
CREATE OR REPLACE FUNCTION find_routes_spatial(
    staging_schema text,
    target_distance_km double precision,
    target_elevation_gain double precision,
    tolerance_percent double precision DEFAULT 20.0,
    max_depth integer DEFAULT 6
) RETURNS TABLE(
    route_id text,
    start_node integer,
    end_node integer,
    total_distance_km double precision,
    total_elevation_gain double precision,
    route_path integer[],
    route_edges integer[],
    route_shape text,
    trail_count integer,
    similarity_score double precision
) AS $$
DECLARE
    min_distance double precision;
    max_distance double precision;
    min_elevation double precision;
    max_elevation double precision;
    route_detail record;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    -- Use a simpler approach: find connected edge sequences
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all edges as potential starting points
            SELECT 
                e.id as edge_id,
                e.source as start_node,
                e.target as current_node,
                e.source as end_node,
                ARRAY[e.source, e.target] as path,
                ARRAY[e.id] as edges,
                e.distance_km::double precision as total_distance_km,
                COALESCE(e.elevation_gain, 0)::double precision as total_elevation_gain,
                1 as depth,
                ARRAY[e.trail_name] as trail_names
            FROM %I.routing_edges e
            WHERE e.distance_km <= $1  -- Start with edges that fit our target
            
            UNION ALL
            
            -- Recursively explore connected edges
            SELECT 
                rs.edge_id,
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.distance_km::double precision,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0)::double precision,
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $2  -- Limit depth
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km + e.distance_km::double precision <= $3  -- Distance tolerance
              AND rs.total_elevation_gain + COALESCE(e.elevation_gain, 0)::double precision <= $4  -- Elevation tolerance
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
                    total_distance_km, $5,
                    total_elevation_gain, $6
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $7  -- Minimum distance
              AND total_elevation_gain >= $8  -- Minimum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_distance, max_depth, max_distance, max_elevation, 
          target_distance_km, target_elevation_gain, min_distance, min_elevation;
END;
$$ LANGUAGE plpgsql;

-- Function to find simple loops using spatial proximity
CREATE OR REPLACE FUNCTION find_simple_loops_spatial(
    staging_schema text,
    target_distance_km double precision,
    target_elevation_gain double precision,
    tolerance_percent double precision DEFAULT 30.0
) RETURNS TABLE(
    route_id text,
    start_node integer,
    end_node integer,
    total_distance_km double precision,
    total_elevation_gain double precision,
    route_path integer[],
    route_edges integer[],
    route_shape text,
    trail_count integer,
    similarity_score double precision
) AS $$
DECLARE
    min_distance double precision;
    max_distance double precision;
    min_elevation double precision;
    max_elevation double precision;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    RETURN QUERY EXECUTE format($f$
        WITH potential_loops AS (
            -- Find edges that could form loops by connecting back to start
            SELECT 
                e1.id as edge1_id,
                e1.source as start_node,
                e1.target as mid_node,
                e2.id as edge2_id,
                e2.target as end_node,
                (e1.distance_km + e2.distance_km)::double precision as total_distance,
                (COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0))::double precision as total_elevation,
                ARRAY[e1.source, e1.target, e2.target] as path,
                ARRAY[e1.id, e2.id] as edges,
                ARRAY[e1.trail_name, e2.trail_name] as trail_names
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.source != e2.target  -- Not a self-loop
              AND e1.distance_km + e2.distance_km BETWEEN $1 AND $2
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $3 AND $4
        ),
        valid_loops AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation as total_elevation_gain,
                path,
                edges,
                'loop' as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance, $5,
                    total_elevation, $6
                ) as similarity_score
            FROM potential_loops
            GROUP BY start_node, end_node, total_distance, total_elevation, path, edges
        )
        SELECT * FROM valid_loops
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING min_distance, max_distance, min_elevation, max_elevation,
          target_distance_km, target_elevation_gain;
END;
$$ LANGUAGE plpgsql;

-- Function to find out-and-back routes using spatial functions
CREATE OR REPLACE FUNCTION find_out_and_back_spatial(
    staging_schema text,
    target_distance_km double precision,
    target_elevation_gain double precision,
    tolerance_percent double precision DEFAULT 30.0
) RETURNS TABLE(
    route_id text,
    start_node integer,
    end_node integer,
    total_distance_km double precision,
    total_elevation_gain double precision,
    route_path integer[],
    route_edges integer[],
    route_shape text,
    trail_count integer,
    similarity_score double precision
) AS $$
DECLARE
    min_distance double precision;
    max_distance double precision;
    min_elevation double precision;
    max_elevation double precision;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    RETURN QUERY EXECUTE format($f$
        WITH out_and_back AS (
            -- Find edges that form out-and-back routes
            SELECT 
                e1.id as edge1_id,
                e1.source as start_node,
                e1.target as mid_node,
                e2.id as edge2_id,
                e2.target as end_node,
                (e1.distance_km + e2.distance_km)::double precision as total_distance,
                (COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0))::double precision as total_elevation,
                ARRAY[e1.source, e1.target, e2.target] as path,
                ARRAY[e1.id, e2.id] as edges,
                ARRAY[e1.trail_name, e2.trail_name] as trail_names
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.source = e2.target  -- Forms a loop back to start
              AND e1.distance_km + e2.distance_km BETWEEN $1 AND $2
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $3 AND $4
        ),
        valid_routes AS (
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
                total_elevation as total_elevation_gain,
                path,
                edges,
                'out-and-back' as route_shape,
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                calculate_route_similarity_score(
                    total_distance, $5,
                    total_elevation, $6
                ) as similarity_score
            FROM out_and_back
            GROUP BY start_node, end_node, total_distance, total_elevation, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING min_distance, max_distance, min_elevation, max_elevation,
          target_distance_km, target_elevation_gain;
END;
$$ LANGUAGE plpgsql; 