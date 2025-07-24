-- Fast Native PostGIS Functions for Carthorse
-- Uses native PostGIS functions for fast node/edge detection without pgRouting complexity

-- Function to create routing graph using fast native PostGIS
CREATE OR REPLACE FUNCTION fast_create_routing_graph(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS TABLE (
    node_count integer,
    edge_count integer,
    analysis_results text,
    processing_time text
) AS $$
DECLARE
    node_count integer := 0;
    edge_count integer := 0;
    analysis_results text;
    start_time timestamp;
    end_time timestamp;
    dyn_sql text;
BEGIN
    start_time := clock_timestamp();
    
    -- Clear existing routing tables
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Step 1: Create nodes using native PostGIS ST_Node and ST_Dump
    -- This is much faster than pgRouting's pgr_nodenetwork
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH all_trails AS (
            SELECT id, app_uuid, name, ST_Force2D(geo2) as geom
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        trail_collection AS (
            SELECT ST_Collect(geom) as all_geometries
            FROM all_trails
        ),
        intersection_points AS (
            SELECT dump.geom as point
            FROM trail_collection, ST_Dump(ST_Node(all_geometries)) dump
            WHERE ST_GeometryType(dump.geom) = 'ST_Point'
        ),
        trail_endpoints AS (
            SELECT ST_StartPoint(geom) as point, app_uuid, name FROM all_trails
            UNION ALL
            SELECT ST_EndPoint(geom) as point, app_uuid, name FROM all_trails
        ),
        all_nodes AS (
            SELECT point, 'intersection' as node_type, NULL as name FROM intersection_points
            UNION ALL
            SELECT point, 'endpoint' as node_type, name FROM trail_endpoints
        ),
        unique_nodes AS (
            SELECT DISTINCT ON (ST_AsText(point))
                point,
                node_type,
                array_remove(array_agg(DISTINCT name), NULL) as connected_trails
            FROM all_nodes
            GROUP BY point, node_type
        )
        SELECT 
            ST_Y(point) as lat,
            ST_X(point) as lng,
            COALESCE(ST_Z(ST_Force3D(point)), 0) as elevation,
            node_type,
            array_to_string(connected_trails, ',') as connected_trails
        FROM unique_nodes
        WHERE point IS NOT NULL;
    $f$, staging_schema, staging_schema, trails_table);
    
    EXECUTE dyn_sql;
    
    -- Step 2: Create edges by connecting trail segments to nearest nodes
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geo2)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, ST_Force2D(geo2) as geom, elevation_gain,
                   ST_StartPoint(ST_Force2D(geo2)) as start_point, 
                   ST_EndPoint(ST_Force2D(geo2)) as end_point
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
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
            geom as geo2
        FROM node_connections
        WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id;
    $f$, staging_schema, staging_schema, trails_table, tolerance_meters, staging_schema, tolerance_meters);
    
    EXECUTE dyn_sql;
    
    -- Get counts
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Simple analysis
    analysis_results := format('nodes=%s, edges=%s, avg_connections=%.1f', 
        node_count, edge_count, 
        CASE WHEN node_count > 0 THEN edge_count::float / node_count ELSE 0 END);
    
    end_time := clock_timestamp();
    
    RETURN QUERY SELECT node_count, edge_count, analysis_results, 
        format('%.2fs', extract(epoch from (end_time - start_time)));
END;
$$ LANGUAGE plpgsql;

-- Function to validate the routing graph
CREATE OR REPLACE FUNCTION fast_validate_graph(
    staging_schema text
) RETURNS TABLE (
    validation_type text,
    status text,
    details text
) AS $$
DECLARE
    node_count integer;
    edge_count integer;
    isolated_nodes integer;
    disconnected_edges integer;
BEGIN
    -- Get basic counts
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Check for isolated nodes
    EXECUTE format($f$
        SELECT COUNT(*) FROM %I.routing_nodes n
        WHERE NOT EXISTS (
            SELECT 1 FROM %I.routing_edges e 
            WHERE e.from_node_id = n.id OR e.to_node_id = n.id
        )
    $f$, staging_schema, staging_schema) INTO isolated_nodes;
    
    -- Check for disconnected edges
    EXECUTE format($f$
        SELECT COUNT(*) FROM %I.routing_edges e
        WHERE NOT EXISTS (
            SELECT 1 FROM %I.routing_nodes n WHERE n.id = e.from_node_id
        ) OR NOT EXISTS (
            SELECT 1 FROM %I.routing_nodes n WHERE n.id = e.to_node_id
        )
    $f$, staging_schema, staging_schema) INTO disconnected_edges;
    
    -- Return validation results
    validation_type := 'basic_counts';
    status := CASE WHEN node_count > 0 AND edge_count > 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('nodes=%s, edges=%s', node_count, edge_count);
    RETURN NEXT;
    
    validation_type := 'isolated_nodes';
    status := CASE WHEN isolated_nodes = 0 THEN 'PASS' ELSE 'WARNING' END;
    details := format('isolated_nodes=%s', isolated_nodes);
    RETURN NEXT;
    
    validation_type := 'disconnected_edges';
    status := CASE WHEN disconnected_edges = 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('disconnected_edges=%s', disconnected_edges);
    RETURN NEXT;
    
    validation_type := 'connectivity';
    status := CASE WHEN edge_count >= node_count - 1 THEN 'PASS' ELSE 'WARNING' END;
    details := format('edge_to_node_ratio=%.2f', edge_count::float / GREATEST(node_count, 1));
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to get routing statistics
CREATE OR REPLACE FUNCTION fast_get_routing_stats(
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