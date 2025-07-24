-- Native pgRouting Functions for Carthorse
-- These functions use native pgRouting functions for node/edge detection and graph analysis

-- Function to create routing graph using pgRouting's pgr_nodenetwork
CREATE OR REPLACE FUNCTION pgrouting_create_graph(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS TABLE (
    node_count integer,
    edge_count integer
) AS $$
DECLARE
    node_count integer := 0;
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    -- Clear existing routing tables
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Create temporary table for pgRouting
    EXECUTE format('CREATE TEMP TABLE temp_trails AS SELECT id, ST_Force2D(geo2) as geom FROM %I.%I WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)', staging_schema, trails_table);
    
    -- Use pgRouting's pgr_nodenetwork to create nodes and edges
    dyn_sql := format($f$
        -- Create nodes using pgr_nodenetwork
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        SELECT 
            ST_Y(geom) as lat,
            ST_X(geom) as lng,
            COALESCE(ST_Z(ST_Force3D(geom)), 0) as elevation,
            CASE WHEN cnt > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
            array_to_string(ARRAY(SELECT DISTINCT name FROM %I.%I t WHERE ST_DWithin(t.geo2, nodes.geom, $1)), ',') as connected_trails
        FROM pgr_nodenetwork(
            'temp_trails',
            $1,  -- tolerance
            'id',  -- id column
            'geom',  -- geometry column
            'split'  -- table suffix
        ) nodes;
    $f$, staging_schema, staging_schema, trails_table);
    
    EXECUTE dyn_sql USING tolerance_meters;
    
    -- Get node count
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    -- Create edges using the split table from pgr_nodenetwork
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geo2)
        SELECT 
            e.source as from_node_id,
            e.target as to_node_id,
            t.app_uuid as trail_id,
            t.name as trail_name,
            ST_Length(e.geom::geography) / 1000 as distance_km,
            COALESCE(t.elevation_gain, 0) as elevation_gain,
            e.geom as geo2
        FROM %I.split e
        JOIN %I.%I t ON e.old_id = t.id
        WHERE e.source IS NOT NULL AND e.target IS NOT NULL AND e.source <> e.target;
    $f$, staging_schema, staging_schema, staging_schema, trails_table);
    
    EXECUTE dyn_sql;
    
    -- Get edge count
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Clean up temporary split table
    EXECUTE format('DROP TABLE IF EXISTS %I.split', staging_schema);
    
    RETURN QUERY SELECT node_count, edge_count;
END;
$$ LANGUAGE plpgsql;

-- Function to analyze routing graph using pgRouting's pgr_analyzegraph
CREATE OR REPLACE FUNCTION pgrouting_analyze_graph(
    staging_schema text
) RETURNS TABLE (
    analysis_type text,
    result_value text
) AS $$
DECLARE
    analysis_results record;
BEGIN
    -- Analyze the routing graph using pgRouting
    FOR analysis_results IN
        EXECUTE format($f$
            SELECT * FROM pgr_analyzegraph(
                'SELECT id as edge_id, from_node_id as source, to_node_id as target, distance_km as cost, distance_km as reverse_cost 
                 FROM %I.routing_edges 
                 WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL',
                true,  -- directed
                true   -- has_rcost
            );
        $f$, staging_schema)
    LOOP
        analysis_type := 'graph_analysis';
        result_value := format('edges=%s, vertices=%s, isolated=%s, dead_ends=%s, gaps=%s, invalid_edges=%s',
            analysis_results.edges, analysis_results.vertices, analysis_results.isolated,
            analysis_results.dead_ends, analysis_results.gaps, analysis_results.invalid_edges);
        RETURN NEXT;
    END LOOP;
    
    -- Additional analysis
    analysis_type := 'node_types';
    EXECUTE format('SELECT COUNT(*) FILTER (WHERE node_type = ''intersection'') as intersection_count, COUNT(*) FILTER (WHERE node_type = ''endpoint'') as endpoint_count FROM %I.routing_nodes', staging_schema) INTO analysis_results;
    result_value := format('intersection_nodes=%s, endpoint_nodes=%s', analysis_results.intersection_count, analysis_results.endpoint_count);
    RETURN NEXT;
    
    analysis_type := 'edge_stats';
    EXECUTE format('SELECT COUNT(*) as total_edges, AVG(distance_km) as avg_distance, MAX(distance_km) as max_distance FROM %I.routing_edges', staging_schema) INTO analysis_results;
    result_value := format('total_edges=%s, avg_distance=%.2f, max_distance=%.2f', analysis_results.total_edges, analysis_results.avg_distance, analysis_results.max_distance);
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to find shortest path using pgRouting
CREATE OR REPLACE FUNCTION pgrouting_shortest_path(
    staging_schema text,
    start_node_id integer,
    end_node_id integer
) RETURNS TABLE (
    seq integer,
    node_id integer,
    edge_id integer,
    cost double precision,
    agg_cost double precision,
    geom geometry
) AS $$
BEGIN
    RETURN QUERY
    EXECUTE format($f$
        SELECT 
            p.seq,
            p.node,
            p.edge,
            p.cost,
            p.agg_cost,
            e.geo2 as geom
        FROM pgr_dijkstra(
            'SELECT id as edge_id, from_node_id as source, to_node_id as target, distance_km as cost, distance_km as reverse_cost 
             FROM %I.routing_edges 
             WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL',
            $1, $2,  -- start and end nodes
            true     -- directed
        ) p
        LEFT JOIN %I.routing_edges e ON p.edge = e.id
        ORDER BY p.seq;
    $f$, staging_schema, staging_schema)
    USING start_node_id, end_node_id;
END;
$$ LANGUAGE plpgsql;

-- Function to validate routing graph integrity
CREATE OR REPLACE FUNCTION pgrouting_validate_graph(
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
    -- Count nodes and edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Check for isolated nodes (nodes with no edges)
    EXECUTE format($f$
        SELECT COUNT(*) FROM %I.routing_nodes n
        WHERE NOT EXISTS (
            SELECT 1 FROM %I.routing_edges e 
            WHERE e.from_node_id = n.id OR e.to_node_id = n.id
        )
    $f$, staging_schema, staging_schema) INTO isolated_nodes;
    
    -- Check for disconnected edges (edges pointing to non-existent nodes)
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