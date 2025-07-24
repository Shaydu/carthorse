-- PostGIS Intersection Detection Routing Functions for Carthorse
-- Uses the existing PostGIS approach (ST_Node, ST_Collect, ST_Dump) but works with current schema

-- Function to create routing graph using PostGIS intersection detection
CREATE OR REPLACE FUNCTION postgis_intersection_routing(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS TABLE (
    node_count integer,
    edge_count integer,
    processing_time text
) AS $$
DECLARE
    node_count integer := 0;
    edge_count integer := 0;
    start_time timestamp;
    end_time timestamp;
BEGIN
    start_time := clock_timestamp();
    
    -- Clear existing routing tables
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Step 1: Find all intersection points using PostGIS ST_Node approach
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_geometries AS (
            SELECT id, app_uuid, name, ST_Force2D(geometry) as geometry
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            SELECT 
                ST_Node(ST_Collect(geometry)) as nodes
            FROM trail_geometries
        ),
        exploded_nodes AS (
            SELECT (ST_Dump(nodes)).geom as point
            FROM intersection_points
        ),
        node_connections AS (
            SELECT 
                en.point,
                array_agg(tg.name) as connected_trail_names,
                COUNT(*) as connection_count
            FROM exploded_nodes en
            JOIN trail_geometries tg ON ST_DWithin(en.point, tg.geometry, %s)
            WHERE ST_GeometryType(en.point) = 'ST_Point'
            GROUP BY en.point
        )
        SELECT 
            ST_Y(point) as lat,
            ST_X(point) as lng,
            0 as elevation,
            CASE WHEN connection_count > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
            array_to_string(connected_trail_names, ',') as connected_trails
        FROM node_connections
        WHERE connection_count > 0
    $f$, staging_schema, staging_schema, trails_table, tolerance_meters);
    
    -- Step 2: Create edges by connecting trail segments to nearest nodes
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, ST_Force2D(geometry) as geom, elevation_gain,
                   ST_StartPoint(ST_Force2D(geometry)) as start_point, 
                   ST_EndPoint(ST_Force2D(geometry)) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        node_connections AS (
            SELECT ts.id as trail_id, ts.app_uuid as trail_uuid, ts.name as trail_name, ts.geom, ts.elevation_gain,
                   fn.id as from_node_id, tn.id as to_node_id
            FROM trail_segments ts
            LEFT JOIN LATERAL (
                SELECT n.id
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
                ORDER BY ST_Distance(ts.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
                ORDER BY ST_Distance(ts.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        )
        SELECT 
            from_node_id,
            to_node_id,
            trail_uuid as trail_id,
            trail_name,
            ST_Length(geom::geography) / 1000 as distance_km,
            COALESCE(elevation_gain, 0) as elevation_gain,
            geom as geometry
        FROM node_connections
        WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, tolerance_meters, staging_schema, tolerance_meters);
    
    -- Get counts
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    end_time := clock_timestamp();
    
    RETURN QUERY SELECT node_count, edge_count, 
        format('%s seconds', round(extract(epoch from (end_time - start_time))::numeric, 2));
END;
$$ LANGUAGE plpgsql;

-- Function to get PostGIS routing statistics
CREATE OR REPLACE FUNCTION postgis_intersection_stats(
    staging_schema text
) RETURNS TABLE (
    total_nodes integer,
    intersection_nodes integer,
    endpoint_nodes integer,
    total_edges integer
) AS $$
BEGIN
    RETURN QUERY
    EXECUTE format($f$
        SELECT 
            COUNT(*) as total_nodes,
            COUNT(*) FILTER (WHERE node_type = 'intersection') as intersection_nodes,
            COUNT(*) FILTER (WHERE node_type = 'endpoint') as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges
        FROM %I.routing_nodes
    $f$, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql; 