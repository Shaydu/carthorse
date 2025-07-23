-- Fix build_routing_nodes
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
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            SELECT ST_StartPoint(geometry) as start_point, ST_EndPoint(geometry) as end_point, app_uuid, name
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
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
        SELECT gen_random_uuid() as node_uuid, lat, lng, elevation, node_type, array_to_string(all_connected_trails, ',') as connected_trails
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    $f$, staging_schema, staging_schema, trails_table, staging_schema, trails_table);
    RAISE NOTICE 'build_routing_nodes SQL: %', dyn_sql;
    EXECUTE dyn_sql USING intersection_tolerance_meters;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Fix build_routing_edges
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
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, ST_Force2D(geometry) as geometry, length_km, elevation_gain,
                   ST_StartPoint(ST_Force2D(geometry)) as start_point, ST_EndPoint(ST_Force2D(geometry)) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry) AND ST_Length(geometry) > 0.1
        ),
        node_connections AS (
            SELECT ts.id as trail_id, ts.app_uuid as trail_uuid, ts.name as trail_name, ts.length_km, ts.elevation_gain, ts.geometry,
                   fn.id as from_node_id, tn.id as to_node_id, fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM trail_segments ts
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %s)
                ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %s)
                ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, geometry, from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geometry::geography) / 1000) as distance_km,
                   COALESCE(elevation_gain, 0) as elevation_gain,
                   ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326)) as geometry
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid::uuid as trail_id, trail_name, distance_km, elevation_gain, geometry
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance);
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql; 