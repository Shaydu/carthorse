-- Improved Fast Routing Functions for Carthorse
-- Uses native PostGIS functions with better intersection detection for trail networks

-- Function to create routing graph using improved intersection detection
CREATE OR REPLACE FUNCTION improved_create_routing_graph(
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
    dyn_sql text;
BEGIN
    start_time := clock_timestamp();
    
    -- Clear existing routing tables
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Step 1: Create nodes using improved approach
    -- First, get trail endpoints
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_data AS (
            SELECT name, ST_StartPoint(ST_Force2D(geometry)) as start_point, ST_EndPoint(ST_Force2D(geometry)) as end_point
            FROM %I.%I 
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        endpoints AS (
            SELECT start_point as point, name FROM trail_data
            UNION ALL
            SELECT end_point as point, name FROM trail_data
        ),
        unique_endpoints AS (
            SELECT DISTINCT ON (ST_AsText(point))
                point,
                array_agg(DISTINCT name) as connected_trails
            FROM endpoints
            GROUP BY point
        )
        SELECT 
            ST_Y(point) as lat,
            ST_X(point) as lng,
            0 as elevation,
            'endpoint' as node_type,
            array_to_string(connected_trails, ',') as connected_trails
        FROM unique_endpoints
        WHERE point IS NOT NULL
    $f$, staging_schema, staging_schema, trails_table);
    
    -- Then find near intersections by clustering nearby endpoints
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH endpoint_clusters AS (
            SELECT 
                ST_Centroid(ST_Collect(point)) as cluster_center,
                array_agg(DISTINCT name) as connected_trails,
                COUNT(*) as trail_count
            FROM (
                SELECT 
                    n.lat, n.lng, n.connected_trails,
                    ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326) as point,
                    unnest(string_to_array(n.connected_trails, ',')) as name
                FROM %I.routing_nodes n
                WHERE n.node_type = 'endpoint'
            ) endpoints
            GROUP BY ST_SnapToGrid(point, %s)
            HAVING COUNT(*) > 1
        )
        SELECT 
            ST_Y(cluster_center) as lat,
            ST_X(cluster_center) as lng,
            0 as elevation,
            'intersection' as node_type,
            array_to_string(connected_trails, ',') as connected_trails
        FROM endpoint_clusters
        WHERE trail_count > 1
    $f$, staging_schema, staging_schema, tolerance_meters);
    
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

-- Function to get improved routing statistics
CREATE OR REPLACE FUNCTION improved_get_routing_stats(
    staging_schema text
) RETURNS TABLE (
    total_nodes integer,
    intersection_nodes integer,
    endpoint_nodes integer,
    total_edges integer,
    avg_connections_per_node numeric
) AS $$
BEGIN
    RETURN QUERY
    EXECUTE format($f$
        SELECT 
            COUNT(*) as total_nodes,
            COUNT(*) FILTER (WHERE node_type = 'intersection') as intersection_nodes,
            COUNT(*) FILTER (WHERE node_type = 'endpoint') as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges,
            CASE 
                WHEN COUNT(*) > 0 THEN (SELECT COUNT(*)::numeric FROM %I.routing_edges) / COUNT(*)
                ELSE 0 
            END as avg_connections_per_node
        FROM %I.routing_nodes
    $f$, staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql; 