-- Trailhead Management Functions for Carthorse
-- These functions allow marking specific nodes as trailheads and managing trailhead-based route generation

-- Function to mark a specific node as a trailhead
CREATE OR REPLACE FUNCTION public.mark_node_as_trailhead(
    staging_schema text,
    node_id integer,
    trailhead_name text DEFAULT NULL
) RETURNS boolean AS $$
DECLARE
    node_exists boolean;
    trailhead_count integer;
BEGIN
    -- Check if the node exists in routing_nodes
    SELECT EXISTS(
        SELECT 1 FROM ${staging_schema}.routing_nodes 
        WHERE id = node_id
    ) INTO node_exists;
    
    IF NOT node_exists THEN
        RAISE EXCEPTION 'Node % does not exist in staging schema %', node_id, staging_schema;
    END IF;
    
    -- Update the node to be a trailhead
    EXECUTE format('
        UPDATE %I.routing_nodes 
        SET node_type = ''trailhead'',
            connected_trails = CASE 
                WHEN connected_trails IS NULL THEN ''[]''::text
                ELSE connected_trails
            END
        WHERE id = $1
    ', staging_schema) USING node_id;
    
    -- Get count of updated rows
    GET DIAGNOSTICS trailhead_count = ROW_COUNT;
    
    IF trailhead_count = 0 THEN
        RAISE EXCEPTION 'Failed to mark node % as trailhead', node_id;
    END IF;
    
    RAISE NOTICE 'Successfully marked node % as trailhead in schema %', node_id, staging_schema;
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to clear all trailhead designations
CREATE OR REPLACE FUNCTION public.clear_all_trailheads(
    staging_schema text
) RETURNS integer AS $$
DECLARE
    cleared_count integer;
BEGIN
    -- Reset all trailhead nodes back to their original type
    EXECUTE format('
        UPDATE %I.routing_nodes 
        SET node_type = CASE 
            WHEN array_length(string_to_array(connected_trails, '',''), 1) > 1 THEN ''intersection''
            ELSE ''endpoint''
        END
        WHERE node_type = ''trailhead''
    ', staging_schema);
    
    GET DIAGNOSTICS cleared_count = ROW_COUNT;
    
    RAISE NOTICE 'Cleared % trailhead designations in schema %', cleared_count, staging_schema;
    RETURN cleared_count;
END;
$$ LANGUAGE plpgsql;

-- Function to list all trailheads in a staging schema
CREATE OR REPLACE FUNCTION public.list_trailheads(
    staging_schema text
) RETURNS TABLE(
    node_id integer,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    trailhead_name text
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            id as node_id,
            lat,
            lng,
            elevation,
            node_type,
            connected_trails,
            ''trailhead'' as trailhead_name
        FROM %I.routing_nodes
        WHERE node_type = ''trailhead''
        ORDER BY id
    ', staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to get trailhead nodes for route generation
CREATE OR REPLACE FUNCTION public.get_trailhead_nodes(
    staging_schema text,
    max_trailheads integer DEFAULT 50
) RETURNS TABLE(
    id integer,
    lat real,
    lng real,
    elevation real,
    node_type text,
    connected_trails text,
    connection_count integer
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            rn.id,
            rn.lat,
            rn.lng,
            rn.elevation,
            rn.node_type,
            rn.connected_trails,
            COALESCE(nm.connection_count, 1) as connection_count
        FROM %I.routing_nodes rn
        LEFT JOIN %I.node_mapping nm ON rn.id = nm.pg_id
        WHERE rn.node_type = ''trailhead''
        ORDER BY nm.connection_count ASC, rn.id
        LIMIT $1
    ', staging_schema, staging_schema) USING max_trailheads;
END;
$$ LANGUAGE plpgsql;

-- Function to count trailheads in a staging schema
CREATE OR REPLACE FUNCTION public.count_trailheads(
    staging_schema text
) RETURNS integer AS $$
DECLARE
    trailhead_count integer;
BEGIN
    EXECUTE format('
        SELECT COUNT(*) 
        FROM %I.routing_nodes 
        WHERE node_type = ''trailhead''
    ', staging_schema) INTO trailhead_count;
    
    RETURN trailhead_count;
END;
$$ LANGUAGE plpgsql;

-- Function to validate trailhead setup
CREATE OR REPLACE FUNCTION public.validate_trailhead_setup(
    staging_schema text
) RETURNS TABLE(
    is_valid boolean,
    message text,
    trailhead_count integer,
    total_nodes integer
) AS $$
DECLARE
    th_count integer;
    total_count integer;
BEGIN
    -- Count trailheads
    SELECT public.count_trailheads(staging_schema) INTO th_count;
    
    -- Count total nodes
    EXECUTE format('
        SELECT COUNT(*) FROM %I.routing_nodes
    ', staging_schema) INTO total_count;
    
    -- Return validation results
    RETURN QUERY SELECT 
        CASE 
            WHEN th_count > 0 THEN true
            ELSE false
        END as is_valid,
        CASE 
            WHEN th_count > 0 THEN format('Valid trailhead setup with %s trailheads', th_count)
            ELSE 'No trailheads found - route generation will use default entry points'
        END as message,
        th_count as trailhead_count,
        total_count as total_nodes;
END;
$$ LANGUAGE plpgsql; 