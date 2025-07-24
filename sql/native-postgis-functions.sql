-- Native PostGIS/pgRouting Functions for Carthorse
-- These functions use native PostGIS and pgRouting functions instead of custom implementations

-- The native_split_trails_at_intersections function is deprecated and has been removed.

-- Function to build routing nodes using native PostGIS functions
CREATE OR REPLACE FUNCTION native_build_routing_nodes(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer := 0;
    dyn_sql text;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Build routing nodes using native PostGIS functions
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH all_trails AS (
            SELECT id, app_uuid, name, ST_Force2D(geo2) as geo2_2d, ST_Force3D(geo2) as geo2_3d
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        trail_collection AS (
            SELECT ST_Collect(geo2_2d) as all_geometries
            FROM all_trails
        ),
        intersection_nodes AS (
            SELECT dump.geom as point
            FROM trail_collection, ST_Dump(ST_Node(all_geometries)) dump
            WHERE ST_GeometryType(dump.geom) = 'ST_Point'
        ),
        trail_endpoints AS (
            SELECT ST_StartPoint(geo2_2d) as point, app_uuid, name FROM all_trails
            UNION ALL
            SELECT ST_EndPoint(geo2_2d) as point, app_uuid, name FROM all_trails
        ),
        all_nodes AS (
            SELECT point, 'intersection' as node_type FROM intersection_nodes
            UNION ALL
            SELECT point, 'endpoint' as node_type FROM trail_endpoints
        ),
        node_connections AS (
            SELECT 
                n.point,
                array_agg(DISTINCT t.name) as connected_trails,
                COUNT(DISTINCT t.app_uuid) as trail_count
            FROM all_nodes n
            JOIN all_trails t ON ST_DWithin(n.point, t.geo2_2d, $1)
            GROUP BY n.point
        ),
        final_nodes AS (
            SELECT DISTINCT ON (ST_AsText(point))
                ST_Y(point) as lat,
                ST_X(point) as lng,
                COALESCE(ST_Z(ST_Force3D(point)), 0) as elevation,
                CASE WHEN trail_count > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
                array_to_string(connected_trails, ',') as connected_trails
            FROM node_connections
            WHERE trail_count > 0
            ORDER BY ST_AsText(point), trail_count DESC
        )
        SELECT lat, lng, elevation, node_type, connected_trails
        FROM final_nodes
    $f$, staging_schema, staging_schema, trails_table);
    
    EXECUTE dyn_sql USING tolerance_meters;
    
    -- Get count of routing nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Function to build routing edges using native PostGIS functions
CREATE OR REPLACE FUNCTION native_build_routing_edges(
    staging_schema text,
    trails_table text,
    edge_tolerance double precision DEFAULT 20.0
) RETURNS integer AS $$
DECLARE
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Build routing edges using native PostGIS functions
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geo2)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, ST_Force2D(geo2) as geo2_2d, length_km, elevation_gain,
                   ST_StartPoint(ST_Force2D(geo2)) as start_point, ST_EndPoint(ST_Force2D(geo2)) as end_point
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2) AND ST_Length(geo2::geography) > 0.1
        ),
        node_connections AS (
            SELECT ts.id as trail_id, ts.app_uuid as trail_uuid, ts.name as trail_name, ts.length_km, ts.elevation_gain, ts.geo2_2d,
                   fn.id as from_node_id, tn.id as to_node_id, fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM trail_segments ts
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), $1)
                ORDER BY ST_Distance(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), $1)
                ORDER BY ST_Distance(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, geo2_2d, from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geo2_2d::geography) / 1000) as distance_km,
                   COALESCE(elevation_gain, 0) as elevation_gain,
                   ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326)) as geo2
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid as trail_id, trail_name, distance_km, elevation_gain, geo2
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, staging_schema);
    
    EXECUTE dyn_sql USING edge_tolerance;
    
    -- Get count of routing edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- Function to analyze the routing graph using pgRouting
CREATE OR REPLACE FUNCTION analyze_routing_graph(
    staging_schema text
) RETURNS TABLE (
    analysis_type text,
    result text
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        -- Analyze the graph using pgRouting
        SELECT 'pgr_analyzegraph' as analysis_type, 
               'Graph analysis completed' as result
        FROM pgr_analyzegraph(
            'SELECT id as id, from_node_id as source, to_node_id as target, distance_km as cost, distance_km as reverse_cost FROM %I.routing_edges',
            false
        );
    $f$, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to get routing statistics
CREATE OR REPLACE FUNCTION get_routing_stats(
    staging_schema text
) RETURNS TABLE (
    total_nodes integer,
    intersection_nodes integer,
    endpoint_nodes integer,
    total_edges integer,
    avg_connections_per_node numeric
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            COUNT(*)::integer as total_nodes,
            COUNT(*) FILTER (WHERE node_type = 'intersection')::integer as intersection_nodes,
            COUNT(*) FILTER (WHERE node_type = 'endpoint')::integer as endpoint_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_edges) as total_edges,
            ROUND(AVG(array_length(string_to_array(connected_trails, ','), 1)), 2) as avg_connections_per_node
        FROM %I.routing_nodes
    $f$, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql; 