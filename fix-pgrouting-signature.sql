-- =============================================================================
-- FIX PGROUTING FUNCTION SIGNATURE
-- =============================================================================
-- 
-- Fix the existing find_routes_pgrouting function to use the correct pgr_ksp signature
-- =============================================================================

-- Drop the old function
DROP FUNCTION IF EXISTS find_routes_pgrouting(text, float, float, float, integer);

-- Create the fixed pgRouting function with correct signature
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
                    'SELECT id FROM temp_nodes',
                    3, false, false
                ) WHERE start_vid = n.id AND end_vid = n.id
                AND cost > 0.5 AND cost <= $1 * (1 + $2 / 100.0)
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

SELECT 'Fixed pgRouting function signature' as status; 