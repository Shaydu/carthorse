-- Fix the generate_routing_nodes_native function to ensure all trail endpoints get nodes
-- This will fix the issue where edges can't be created because nodes don't exist

CREATE OR REPLACE FUNCTION generate_routing_nodes_native(staging_schema text, intersection_tolerance_meters real DEFAULT 50.0)
RETURNS TABLE(node_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);

    -- Generate routing nodes at trail intersections and endpoints
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH intersection_points AS (
            -- Find actual intersections between trails
            SELECT DISTINCT
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
                ST_Force3D(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point_3d,
                ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                'intersection' as node_type,
                0.0 as distance_meters
            FROM %I.trails t1
            JOIN %I.trails t2 ON (
                t1.id < t2.id AND
                ST_Intersects(t1.geometry, t2.geometry) AND
                ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            )
            WHERE t1.geometry IS NOT NULL
              AND t2.geometry IS NOT NULL
              AND ST_IsValid(t1.geometry)
              AND ST_IsValid(t2.geometry)
              -- REMOVED: Minimum length filter that was excluding short trails
        ),
        endpoint_points AS (
            -- Find trail endpoints (ALL endpoints, regardless of length)
            SELECT DISTINCT
                ST_StartPoint(geometry) as endpoint_point,
                ST_Force3D(ST_StartPoint(geometry)) as endpoint_point_3d,
                ARRAY[app_uuid] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                'endpoint' as node_type,
                0.0 as distance_meters
            FROM %I.trails
            WHERE geometry IS NOT NULL
              AND ST_IsValid(geometry)
              -- REMOVED: Minimum length filter that was excluding short trails

            UNION ALL

            SELECT DISTINCT
                ST_EndPoint(geometry) as endpoint_point,
                ST_Force3D(ST_EndPoint(geometry)) as endpoint_point_3d,
                ARRAY[app_uuid] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                'endpoint' as node_type,
                0.0 as distance_meters
            FROM %I.trails
            WHERE geometry IS NOT NULL
              AND ST_IsValid(geometry)
              -- REMOVED: Minimum length filter that was excluding short trails
        ),
        all_points AS (
            SELECT
                intersection_point as point,
                intersection_point_3d as point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM intersection_points

            UNION ALL

            SELECT
                endpoint_point as point,
                endpoint_point_3d as point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM endpoint_points
        ),
        clustered_points AS (
            -- Cluster nearby points to avoid duplicates (less aggressive clustering)
            SELECT
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Centroid(ST_Collect(point_3d)) as clustered_point_3d,
                array_agg(DISTINCT unnest(connected_trail_ids)) as all_trail_ids,
                array_agg(DISTINCT unnest(connected_trail_names)) as all_trail_names,
                CASE
                    WHEN COUNT(*) > 1 THEN 'intersection'
                    ELSE MAX(node_type)
                END as node_type,
                AVG(distance_meters) as avg_distance
            FROM all_points
            GROUP BY ST_SnapToGrid(point, $1)  -- Cluster within tolerance
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            ST_Z(clustered_point_3d) as elevation,
            node_type,
            array_to_string(all_trail_names, '; ') as connected_trails,
            NOW() as created_at
        FROM clustered_points
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_degrees;

    GET DIAGNOSTICS node_count_var = ROW_COUNT;

    RETURN QUERY SELECT
        node_count_var,
        true as success,
        format('Generated %s routing nodes (tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT
        0, false,
        format('Error during routing nodes generation: %s', SQLERRM) as message;
END;
$$;
