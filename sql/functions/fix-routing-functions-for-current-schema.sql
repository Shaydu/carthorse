-- Fix routing functions to work with current PostgreSQL schema
-- The current schema has different column names than what the functions expect

-- Fix generate_routing_nodes_native to work with current schema
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(staging_schema text, tolerance_meters real DEFAULT 2.0)
RETURNS TABLE(node_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail start and end points ONLY
    -- Use the current schema structure: id, the_geom, cnt, lng, lat, elevation
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, the_geom, cnt, lng, lat, elevation)
        SELECT DISTINCT
            nextval('routing_nodes_id_seq') as id,
            ST_SetSRID(ST_MakePoint(ST_X(point), ST_Y(point)), 4326) as the_geom,
            1 as cnt,
            ST_X(point) as lng,
            ST_Y(point) as lat,
            COALESCE(ST_Z(point), 0) as elevation
        FROM (
            -- Start points of all trails
            SELECT ST_StartPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
            UNION
            -- End points of all trails
            SELECT ST_EndPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
        ) trail_points
        WHERE point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema);
    
    -- Get total node count
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes (endpoints only)', node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing nodes (endpoints only)', node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
$$;

-- Fix generate_routing_edges_native to work with current schema
CREATE OR REPLACE FUNCTION generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 2.0)
RETURNS TABLE(edge_count integer, success boolean, message text)
LANGUAGE plpgsql
AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from trail segments
    -- Use the current schema structure: id, app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss, geom, source, target
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (id, app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss, geom, source, target)
        SELECT 
            nextval('routing_edges_id_seq') as id,
            t.app_uuid,
            t.name,
            t.trail_type,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.geometry as geom,
            source_node.id as source,
            target_node.id as target
        FROM %I.trails t
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry), $1)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry))
            LIMIT 1
        ) source_node
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry), $1)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry))
            LIMIT 1
        ) target_node
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry) 
          AND t.length_km > 0
          AND source_node.id IS NOT NULL
          AND target_node.id IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges from %s nodes', edge_count_var, node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing edges from % nodes', edge_count_var, node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing edges generation: %', SQLERRM;
END;
$$;

-- Create sequence if it doesn't exist
CREATE SEQUENCE IF NOT EXISTS routing_nodes_id_seq;
CREATE SEQUENCE IF NOT EXISTS routing_edges_id_seq; 