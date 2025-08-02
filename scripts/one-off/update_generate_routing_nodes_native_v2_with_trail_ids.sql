-- Updated generate_routing_nodes_native_v2 function with trail_ids array support
CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native_v2_with_trail_ids(
    staging_schema text, 
    intersection_tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(node_count integer, success boolean, message text) AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from actual trail endpoints and intersections with trail_ids
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
        ),
        intersection_points AS (
            -- Get intersection points from detect_trail_intersections function
            -- Convert integer trail IDs to text UUIDs by looking them up
            SELECT 
                ip.intersection_point as point,
                COALESCE(ST_Z(ip.intersection_point_3d), 0) as elevation,
                'intersection' as node_type,
                array_to_string(ip.connected_trail_names, ',') as connected_trails,
                array_agg(t.app_uuid) as trail_ids
            FROM detect_trail_intersections($1, 'trails', $2) ip
            JOIN %I.trails t ON t.id = ANY(ip.connected_trail_ids)
            WHERE array_length(ip.connected_trail_ids, 1) > 1
            GROUP BY ip.intersection_point, ip.intersection_point_3d, ip.connected_trail_names
        ),
        all_nodes AS (
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM all_endpoints
            WHERE point IS NOT NULL
            UNION ALL
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM intersection_points
            WHERE point IS NOT NULL
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM all_nodes
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            trail_ids,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING staging_schema, intersection_tolerance_meters;
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes with trail_ids (v2, routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation with trail_ids (v2): %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql; 