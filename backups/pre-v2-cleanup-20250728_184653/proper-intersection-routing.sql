-- Proper Intersection Detection Routing Functions for Carthorse
-- Uses native PostGIS functions to correctly detect all trail intersections

-- Function to create routing graph with proper intersection detection
CREATE OR REPLACE FUNCTION proper_create_routing_graph(
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
    
    -- Step 1: Find all intersection points between trails
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_intersections AS (
            SELECT DISTINCT
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
                array_agg(DISTINCT t1.name) || array_agg(DISTINCT t2.name) as connected_trails
            FROM %I.%I t1
            JOIN %I.%I t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
            GROUP BY ST_Intersection(t1.geometry, t2.geometry)
        ),
        unique_intersections AS (
            SELECT DISTINCT ON (ST_AsText(intersection_point))
                intersection_point,
                array_agg(DISTINCT trail_name) as connected_trails
            FROM (
                SELECT intersection_point, unnest(connected_trails) as trail_name
                FROM trail_intersections
            ) expanded
            GROUP BY intersection_point
        )
        SELECT 
            ST_Y(intersection_point) as lat,
            ST_X(intersection_point) as lng,
            0 as elevation,
            'intersection' as node_type,
            array_to_string(connected_trails, ',') as connected_trails
        FROM unique_intersections
        WHERE intersection_point IS NOT NULL
    $f$, staging_schema, staging_schema, trails_table, staging_schema, trails_table);
    
    -- Step 2: Add trail endpoints that are not at intersections
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            SELECT 
                ST_StartPoint(ST_Force2D(geometry)) as start_point,
                ST_EndPoint(ST_Force2D(geometry)) as end_point,
                name
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        all_endpoints AS (
            SELECT start_point as point, name FROM trail_endpoints
            UNION ALL
            SELECT end_point as point, name FROM trail_endpoints
        ),
        unique_endpoints AS (
            SELECT DISTINCT ON (ST_AsText(point))
                point,
                array_agg(DISTINCT name) as connected_trails
            FROM all_endpoints
            GROUP BY point
        ),
        endpoints_not_at_intersections AS (
            SELECT ue.point, ue.connected_trails
            FROM unique_endpoints ue
            WHERE NOT EXISTS (
                SELECT 1 FROM %I.routing_nodes rn
                WHERE rn.node_type = 'intersection'
                  AND ST_DWithin(ue.point, ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326), %s)
            )
        )
        SELECT 
            ST_Y(point) as lat,
            ST_X(point) as lng,
            0 as elevation,
            'endpoint' as node_type,
            array_to_string(connected_trails, ',') as connected_trails
        FROM endpoints_not_at_intersections
        WHERE point IS NOT NULL
    $f$, staging_schema, staging_schema, trails_table, staging_schema, tolerance_meters);
    
    -- Step 3: Create edges by connecting trail segments to nearest nodes
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

-- Function to get proper routing statistics
CREATE OR REPLACE FUNCTION proper_get_routing_stats(
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