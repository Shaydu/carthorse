-- Native pgRouting Functions for Carthorse
-- Uses ONLY native pgRouting functions for node/edge detection and graph analysis
-- Based on pgRouting 3.8.0 documentation

-- Function to create routing graph using pgRouting's pgr_nodenetwork
-- This is the ONLY function we need - it handles both node and edge creation
CREATE OR REPLACE FUNCTION pgrouting_create_complete_graph(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS TABLE (
    node_count integer,
    edge_count integer,
    analysis_results text
) AS $$
DECLARE
    node_count integer := 0;
    edge_count integer := 0;
    analysis_results text;
    temp_table_name text;
    split_table_name text;
    nodes_table_name text;
    dyn_sql text;
BEGIN
    -- Generate unique table names
    temp_table_name := 'temp_trails_' || floor(random() * 1000000);
    split_table_name := temp_table_name || '_split';
    nodes_table_name := temp_table_name || '_nodes';
    
    -- Clear existing routing tables
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Step 1: Create temporary table with trails for pgRouting
    EXECUTE format('CREATE TABLE %I AS SELECT id, ST_Force2D(geo2) as geom FROM %I.%I WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)', 
                   temp_table_name, staging_schema, trails_table);
    
    -- Step 2: Use pgr_nodenetwork to create nodes and split edges
    -- This function automatically:
    -- - Detects intersection points
    -- - Creates nodes at intersections and endpoints
    -- - Splits trails at intersection points
    -- - Creates edges between nodes
    EXECUTE format('SELECT pgr_nodenetwork(''%I'', %s, ''id'', ''geom'', ''split'', '''', false)', 
                   temp_table_name, tolerance_meters);
    
    -- Step 3: Extract nodes from the nodes table created by pgr_nodenetwork
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        SELECT 
            ST_Y(geom) as lat,
            ST_X(geom) as lng,
            COALESCE(ST_Z(ST_Force3D(geom)), 0) as elevation,
            CASE WHEN cnt > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
            array_to_string(ARRAY(SELECT DISTINCT name FROM %I.%I t WHERE ST_DWithin(t.geo2, nodes.geom, %s)), ',') as connected_trails
        FROM %I nodes
        WHERE geom IS NOT NULL;
    $f$, staging_schema, staging_schema, trails_table, tolerance_meters, nodes_table_name);
    
    EXECUTE dyn_sql;
    
    -- Step 4: Extract edges from the split table created by pgr_nodenetwork
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
        FROM %I e
        JOIN %I.%I t ON e.old_id = t.id
        WHERE e.source IS NOT NULL AND e.target IS NOT NULL AND e.source <> e.target;
    $f$, staging_schema, split_table_name, staging_schema, trails_table);
    
    EXECUTE dyn_sql;
    
    -- Step 5: Analyze the graph using pgr_analyzegraph
    EXECUTE format($f$
        SELECT format('edges=%s, vertices=%s, isolated=%s, dead_ends=%s, gaps=%s, invalid_edges=%s',
            edges, vertices, isolated, dead_ends, gaps, invalid_edges)
        FROM pgr_analyzegraph(
            'SELECT id as edge_id, from_node_id as source, to_node_id as target, distance_km as cost, distance_km as reverse_cost 
             FROM %I.routing_edges 
             WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL',
            true,  -- directed
            true   -- has_rcost
        );
    $f$, staging_schema) INTO analysis_results;
    
    -- Get counts
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Clean up temporary tables
    EXECUTE format('DROP TABLE IF EXISTS %I', temp_table_name);
    EXECUTE format('DROP TABLE IF EXISTS %I', split_table_name);
    EXECUTE format('DROP TABLE IF EXISTS %I', nodes_table_name);
    
    RETURN QUERY SELECT node_count, edge_count, analysis_results;
END;
$$ LANGUAGE plpgsql;

-- Function to validate routing graph using pgRouting analysis
CREATE OR REPLACE FUNCTION pgrouting_validate_graph(
    staging_schema text
) RETURNS TABLE (
    validation_type text,
    status text,
    details text
) AS $$
DECLARE
    analysis_results record;
    node_count integer;
    edge_count integer;
BEGIN
    -- Get basic counts
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Basic validation
    validation_type := 'basic_counts';
    status := CASE WHEN node_count > 0 AND edge_count > 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('nodes=%s, edges=%s', node_count, edge_count);
    RETURN NEXT;
    
    -- pgRouting graph analysis
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
        validation_type := 'isolated_nodes';
        status := CASE WHEN analysis_results.isolated = 0 THEN 'PASS' ELSE 'WARNING' END;
        details := format('isolated_nodes=%s', analysis_results.isolated);
        RETURN NEXT;
        
        validation_type := 'dead_ends';
        status := CASE WHEN analysis_results.dead_ends = 0 THEN 'PASS' ELSE 'WARNING' END;
        details := format('dead_ends=%s', analysis_results.dead_ends);
        RETURN NEXT;
        
        validation_type := 'gaps';
        status := CASE WHEN analysis_results.gaps = 0 THEN 'PASS' ELSE 'FAIL' END;
        details := format('gaps=%s', analysis_results.gaps);
        RETURN NEXT;
        
        validation_type := 'invalid_edges';
        status := CASE WHEN analysis_results.invalid_edges = 0 THEN 'PASS' ELSE 'FAIL' END;
        details := format('invalid_edges=%s', analysis_results.invalid_edges);
        RETURN NEXT;
    END LOOP;
    
    -- Node type analysis
    validation_type := 'node_types';
    EXECUTE format('SELECT COUNT(*) FILTER (WHERE node_type = ''intersection'') as intersection_count, COUNT(*) FILTER (WHERE node_type = ''endpoint'') as endpoint_count FROM %I.routing_nodes', staging_schema) INTO analysis_results;
    status := CASE WHEN analysis_results.intersection_count > 0 OR analysis_results.endpoint_count > 0 THEN 'PASS' ELSE 'FAIL' END;
    details := format('intersection_nodes=%s, endpoint_nodes=%s', analysis_results.intersection_count, analysis_results.endpoint_count);
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to find shortest path using pgRouting's pgr_dijkstra
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

-- Function to find edges close to a point using pgRouting's pgr_findcloseedges
CREATE OR REPLACE FUNCTION pgrouting_find_close_edges(
    staging_schema text,
    lat double precision,
    lng double precision,
    search_distance double precision DEFAULT 100.0
) RETURNS TABLE (
    edge_id integer,
    trail_name text,
    distance_meters double precision,
    geom geometry
) AS $$
BEGIN
    RETURN QUERY
    EXECUTE format($f$
        SELECT 
            e.id as edge_id,
            e.trail_name,
            p.distance as distance_meters,
            e.geo2 as geom
        FROM pgr_findcloseedges(
            'SELECT id as edge_id, geo2 as geom FROM %I.routing_edges WHERE geo2 IS NOT NULL',
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            $3,  -- distance
            1    -- num_edges
        ) p
        JOIN %I.routing_edges e ON p.edge_id = e.id
        ORDER BY p.distance;
    $f$, staging_schema, staging_schema)
    USING lng, lat, search_distance;
END;
$$ LANGUAGE plpgsql; 