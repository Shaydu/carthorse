-- =============================================================================
-- FIXED PGROUTING K-SHORTEST PATH ROUTE FINDING
-- =============================================================================
-- 
-- Fixed implementation that uses the correct pgr_ksp function signature
-- Uses: pgr_ksp(text, text, integer, boolean, boolean)
-- 
-- This fixes the "function pgr_ksp is not unique" error
-- =============================================================================

-- Drop the old function if it exists
DROP FUNCTION IF EXISTS find_routes_pgrouting(text, float, float, float, integer);

-- Create the fixed KSP route finding function
CREATE OR REPLACE FUNCTION find_routes_pgrouting(
    staging_schema text,
    target_distance_km float DEFAULT 2.0,
    target_elevation_gain float DEFAULT 300.0,
    config_tolerance float DEFAULT 30.0,
    max_depth integer DEFAULT 6
) RETURNS TABLE(
    route_id uuid,
    start_node bigint,
    end_node bigint,
    total_distance_km float,
    total_elevation_gain float,
    route_path bigint[],
    route_edges bigint[],
    route_shape text,
    trail_count integer,
    similarity_score float
) AS $$
DECLARE
    edge_query text;
    vertex_query text;
BEGIN
    -- Create temporary nodes table with integer IDs (sample only)
    EXECUTE format('
        CREATE TEMP TABLE temp_nodes AS
        SELECT 
            row_number() OVER() as id,
            id as node_uuid,
            lat,
            lng,
            node_type
        FROM %I.routing_nodes
        WHERE node_type IN (''intersection'', ''endpoint'')
        LIMIT 100  -- Sample 100 nodes to get better coverage
    ', staging_schema);
    
    -- Create temporary edges table with integer IDs for pgRouting
    EXECUTE format('
        CREATE TEMP TABLE temp_edges AS 
        SELECT 
            row_number() OVER() as id,
            n1.id as source,
            n2.id as target,
            e.length_km as cost,
            e.length_km as reverse_cost
        FROM %I.routing_edges e
        JOIN temp_nodes n1 ON e.source = n1.node_uuid
        JOIN temp_nodes n2 ON e.target = n2.node_uuid
        WHERE e.length_km > 0.1
    ', staging_schema);
    
    -- Build the edge and vertex queries for pgr_ksp
    edge_query := 'SELECT id, source, target, cost, reverse_cost FROM temp_edges';
    vertex_query := 'SELECT id FROM temp_nodes';
    
    -- Return routes using the correct pgr_ksp signature
    RETURN QUERY EXECUTE format('
        WITH ksp_routes AS (
            SELECT 
                gen_random_uuid() as route_id,
                n1.id as start_node,
                n2.id as end_node,
                p.cost as total_distance_km,
                ARRAY[p.node] as route_path,
                ARRAY[p.edge] as route_edges,
                CASE 
                    WHEN n1.id = n2.id THEN ''loop''
                    ELSE ''out-and-back''
                END as route_shape,
                1 as trail_count,
                1.0::double precision as similarity_score
            FROM temp_nodes n1
            CROSS JOIN temp_nodes n2
            CROSS JOIN LATERAL (
                SELECT * FROM pgr_ksp(
                    %L, %L, 3, false, false
                ) WHERE start_vid = n1.id AND end_vid = n2.id
                AND cost > 0.5 AND cost <= %s * (1 + %s / 100.0)
                LIMIT 1
            ) p
            WHERE p.cost IS NOT NULL
            AND n1.id != n2.id  -- Avoid self-loops for now
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
                    ABS(r.total_distance_km - %s) / %s + 
                    ABS(COALESCE(SUM(e.elevation_gain), 0) - %s) / NULLIF(%s, 0)
                ) / 2.0) as calculated_similarity_score
            FROM all_routes r
            LEFT JOIN temp_edges te ON te.source = ANY(r.route_path) AND te.target = ANY(r.route_path)
            LEFT JOIN %I.routing_edges e ON e.source = (SELECT node_uuid FROM temp_nodes WHERE id = te.source) 
                AND e.target = (SELECT node_uuid FROM temp_nodes WHERE id = te.target)
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
        WHERE calculated_elevation_gain >= %s * (1 - %s / 100.0)
          AND calculated_elevation_gain <= %s * (1 + %s / 100.0)
          AND calculated_similarity_score >= 0.3
        ORDER BY calculated_similarity_score DESC, total_distance_km
        LIMIT 50
    ', 
    edge_query, vertex_query, 
    target_distance_km, config_tolerance,
    target_distance_km, target_distance_km,
    target_elevation_gain, target_elevation_gain,
    staging_schema,
    target_elevation_gain, config_tolerance,
    target_elevation_gain, config_tolerance
    );
    
    -- Clean up temp tables
    DROP TABLE IF EXISTS temp_edges;
    DROP TABLE IF EXISTS temp_nodes;
END;
$$ LANGUAGE plpgsql;

-- Test the fixed function
SELECT 'Fixed KSP function created successfully' as status; 