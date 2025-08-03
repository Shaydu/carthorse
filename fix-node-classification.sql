-- Fix node classification based on actual connectivity
CREATE OR REPLACE FUNCTION fix_node_classification(staging_schema text) RETURNS integer AS $$
DECLARE
    updated_count integer := 0;
BEGIN
    -- Update node types based on actual connectivity in the routing graph
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
    
    -- Show the corrected classification
    EXECUTE format('
        SELECT 
            node_type,
            COUNT(*) as node_count,
            ROUND(AVG(edge_count), 1) as avg_edges_per_node
        FROM (
            SELECT n.node_type, COUNT(e.id) as edge_count
            FROM %I.routing_nodes n
            LEFT JOIN %I.routing_edges e ON n.id = e.source OR n.id = e.target
            GROUP BY n.node_type, n.id
        ) node_stats
        GROUP BY node_type
        ORDER BY node_type
    ', staging_schema, staging_schema);
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to validate node classification
CREATE OR REPLACE FUNCTION validate_node_classification(staging_schema text) RETURNS TABLE(
    node_type text,
    node_count integer,
    avg_edges_per_node numeric,
    min_edges integer,
    max_edges integer
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            node_type,
            COUNT(*) as node_count,
            ROUND(AVG(edge_count), 1) as avg_edges_per_node,
            MIN(edge_count) as min_edges,
            MAX(edge_count) as max_edges
        FROM (
            SELECT n.node_type, COUNT(e.id) as edge_count
            FROM %I.routing_nodes n
            LEFT JOIN %I.routing_edges e ON n.id = e.source OR n.id = e.target
            GROUP BY n.node_type, n.id
        ) node_stats
        GROUP BY node_type
        ORDER BY node_type
    ', staging_schema);
END;
$$ LANGUAGE plpgsql; 