-- Fix build_routing_nodes (no node_uuid)
CREATE OR REPLACE FUNCTION public.build_routing_nodes(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters double precision DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            SELECT ST_StartPoint(geo2) as start_point, ST_EndPoint(geo2) as end_point, app_uuid, name
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        intersection_points AS (
            SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
            FROM public.detect_trail_intersections('%I', '%I', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1
        ),
        all_nodes AS (
            SELECT intersection_point as point, intersection_point_3d as point_3d, connected_trail_names as connected_trails, 'intersection' as node_type FROM intersection_points
            UNION ALL
            SELECT start_point as point, ST_Force3D(start_point) as point_3d, ARRAY[name] as connected_trails, 'endpoint' as node_type FROM trail_endpoints
            UNION ALL
            SELECT end_point as point, ST_Force3D(end_point) as point_3d, ARRAY[name] as connected_trails, 'endpoint' as node_type FROM trail_endpoints
        ),
        grouped_nodes AS (
            SELECT ST_X(point) as lng, ST_Y(point) as lat, COALESCE(ST_Z(point_3d), 0) as elevation,
                   array_agg(DISTINCT ct) as all_connected_trails,
                   CASE WHEN array_length(array_agg(DISTINCT ct), 1) > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
                   point, point_3d
            FROM all_nodes
            CROSS JOIN LATERAL unnest(connected_trails) AS ct
            GROUP BY point, point_3d
        ),
        final_nodes AS (
            SELECT DISTINCT ON (point) lng, lat, elevation, all_connected_trails, node_type
            FROM grouped_nodes
            ORDER BY point, array_length(all_connected_trails, 1) DESC
        )
        SELECT lat, lng, elevation, node_type, array_to_string(all_connected_trails, ',') as connected_trails
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    $f$, staging_schema, staging_schema, trails_table, staging_schema, trails_table);
    RAISE NOTICE 'build_routing_nodes SQL: %', dyn_sql;
    EXECUTE dyn_sql USING intersection_tolerance_meters;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Fix build_routing_edges (trail_id as TEXT)
CREATE OR REPLACE FUNCTION public.build_routing_edges(
    staging_schema text,
    trails_table text,
    edge_tolerance double precision DEFAULT 20.0
) RETURNS integer AS $$
DECLARE
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, geo2 as geo2_2d, length_km, elevation_gain, elevation_loss,
ST_StartPoint(geo2) as start_point, ST_EndPoint(geo2) as end_point
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2) AND ST_Length(geo2) > 0.1
        ),
        elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
            -- If existing elevation data is NULL, calculate from geometry
            -- If calculation fails, preserve NULL (don''t default to 0)
            SELECT 
                ts.*,
                CASE 
                    WHEN ts.elevation_gain IS NOT NULL THEN ts.elevation_gain
                    ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(ts.geo2)))
                END as calculated_elevation_gain,
                CASE 
                    WHEN ts.elevation_loss IS NOT NULL THEN ts.elevation_loss
                    ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(ts.geo2)))
                END as calculated_elevation_loss
            FROM trail_segments ts
        ),
        node_connections AS (
            SELECT ec.id as trail_id, ec.app_uuid as trail_uuid, ec.name as trail_name, ec.length_km, 
                   ec.calculated_elevation_gain as elevation_gain, ec.calculated_elevation_loss as elevation_loss,
                   ec.geo2_2d, fn.id as from_node_id, tn.id as to_node_id, 
                   fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM elevation_calculated ec
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ec.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
ORDER BY ST_Distance(ec.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ec.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
ORDER BY ST_Distance(ec.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, elevation_loss, geo2_2d, 
                   from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geo2_2d::geography) / 1000) as distance_km,
                   -- Preserve NULL elevation values - don''t default to 0
                   elevation_gain,
                   elevation_loss,
                   ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326)) as geo2
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid as trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geo2
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance);
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql; 