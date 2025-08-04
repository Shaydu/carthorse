-- Fix node classification to be based on actual edge count, not trail names
-- This addresses the issue where all nodes are classified as 'endpoint' after trail splitting

-- Function to fix node classification based on actual edge connectivity
CREATE OR REPLACE FUNCTION fix_node_classification(staging_schema text) RETURNS integer AS $$
DECLARE
    updated_count integer := 0;
BEGIN
    -- Update node classification based on actual edge count
    EXECUTE format('
        UPDATE %I.routing_nodes 
        SET node_type = CASE 
            WHEN edge_count <= 2 THEN ''endpoint''
            WHEN edge_count >= 3 THEN ''intersection''
            ELSE node_type
        END
        FROM (
            SELECT n.id, COUNT(e.id) as edge_count
            FROM %I.routing_nodes n
            LEFT JOIN %I.routing_edges e ON n.id = e.source OR n.id = e.target
            GROUP BY n.id
        ) connectivity
        WHERE %I.routing_nodes.id = connectivity.id
    ', staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % nodes with correct classification', updated_count;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to validate node classification
CREATE OR REPLACE FUNCTION validate_node_classification(staging_schema text) RETURNS TABLE(
    node_type text,
    count integer,
    avg_edge_count numeric
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            n.node_type,
            COUNT(*) as count,
            AVG(edge_count) as avg_edge_count
        FROM %I.routing_nodes n
        JOIN (
            SELECT 
                node_id,
                COUNT(edge_id) as edge_count
            FROM (
                SELECT n.id as node_id, e.id as edge_id
                FROM %I.routing_nodes n
                LEFT JOIN %I.routing_edges e ON n.id = e.source OR n.id = e.target
            ) node_edges
            GROUP BY node_id
        ) connectivity ON n.id = connectivity.node_id
        GROUP BY n.node_type
        ORDER BY n.node_type
    ', staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to get detailed node classification stats
CREATE OR REPLACE FUNCTION get_node_classification_stats(staging_schema text) RETURNS TABLE(
    total_nodes integer,
    intersection_nodes integer,
    endpoint_nodes integer,
    avg_edges_per_intersection numeric,
    avg_edges_per_endpoint numeric
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH node_edge_counts AS (
            SELECT 
                n.id,
                n.node_type,
                COUNT(e.id) as edge_count
            FROM %I.routing_nodes n
            LEFT JOIN %I.routing_edges e ON n.id = e.source OR n.id = e.target
            GROUP BY n.id, n.node_type
        )
        SELECT 
            COUNT(*) as total_nodes,
            COUNT(CASE WHEN node_type = ''intersection'' THEN 1 END) as intersection_nodes,
            COUNT(CASE WHEN node_type = ''endpoint'' THEN 1 END) as endpoint_nodes,
            AVG(CASE WHEN node_type = ''intersection'' THEN edge_count END) as avg_edges_per_intersection,
            AVG(CASE WHEN node_type = ''endpoint'' THEN edge_count END) as avg_edges_per_endpoint
        FROM node_edge_counts
    ', staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql; 