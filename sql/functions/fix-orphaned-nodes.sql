-- Fix for orphaned nodes issue
-- This function generates routing nodes from trail endpoints only, since trails are already split

CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native(staging_schema text, tolerance_meters real DEFAULT get_intersection_tolerance()) RETURNS TABLE(node_count integer, success boolean, message text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail start and end points ONLY
    -- Since trails are already split at intersections, we don't need intersection detection
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        SELECT DISTINCT
            gen_random_uuid() as node_uuid,
            ST_Y(point) as lat,
            ST_X(point) as lng,
            ST_Z(point) as elevation,
            'endpoint' as node_type,
            'endpoint' as connected_trails
        FROM (
            -- Start points of all trails
            SELECT ST_StartPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
            UNION
            -- End points of all trails
            SELECT ST_EndPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
        ) trail_points
        WHERE point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema);
    
    -- Get total node count (endpoints only)
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes (endpoints only - trails already split)', node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing nodes (endpoints only - trails already split)', node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
$_$; 