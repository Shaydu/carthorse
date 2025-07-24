-- pgRouting with Caching for Carthorse
-- Implements caching to avoid regenerating routing networks on every export

-- Function to calculate a hash of trail geometries for change detection
CREATE OR REPLACE FUNCTION calculate_trail_hash(
    staging_schema text,
    trails_table text
) RETURNS text AS $$
DECLARE
    trail_hash text;
BEGIN
    -- Calculate a hash based on trail count, geometry count, and geometry checksums
    EXECUTE format($f$
        SELECT md5(
            COUNT(*)::text || '|' ||
            COUNT(DISTINCT ST_AsText(geo2))::text || '|' ||
            SUM(ST_Length(geo2::geography))::text
        )
        FROM %I.%I 
        WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
    $f$, staging_schema, trails_table) INTO trail_hash;
    
    RETURN trail_hash;
END;
$$ LANGUAGE plpgsql;

-- Function to check if routing network needs to be regenerated
CREATE OR REPLACE FUNCTION needs_network_regeneration(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS boolean AS $$
DECLARE
    current_hash text;
    cached_hash text;
    cached_tolerance double precision;
    node_count integer;
    edge_count integer;
BEGIN
    -- Calculate current trail hash
    SELECT calculate_trail_hash(staging_schema, trails_table) INTO current_hash;
    
    -- Check if we have cached network data
    BEGIN
        EXECUTE format('SELECT network_hash, tolerance FROM %I.network_cache LIMIT 1', staging_schema) 
        INTO cached_hash, cached_tolerance;
    EXCEPTION WHEN undefined_table THEN
        -- No cache table exists, need to regenerate
        RETURN true;
    END;
    
    -- Check if we have any nodes/edges
    BEGIN
        EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
        EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    EXCEPTION WHEN undefined_table THEN
        -- No routing tables exist, need to regenerate
        RETURN true;
    END;
    
    -- Return true if any of these conditions are met:
    -- 1. No cached hash (first run)
    -- 2. Hash has changed (trails modified)
    -- 3. Tolerance has changed
    -- 4. No nodes/edges exist
    RETURN (cached_hash IS NULL) OR 
           (cached_hash != current_hash) OR 
           (cached_tolerance != tolerance_meters) OR
           (node_count = 0) OR 
           (edge_count = 0);
END;
$$ LANGUAGE plpgsql;

-- Function to create routing network with caching
CREATE OR REPLACE FUNCTION pgrouting_create_cached_graph(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 1.0
) RETURNS TABLE (
    node_count integer,
    edge_count integer,
    analysis_results text,
    cache_status text
) AS $$
DECLARE
    node_count integer := 0;
    edge_count integer := 0;
    analysis_results text;
    cache_status text;
    current_hash text;
    temp_table_name text;
    split_table_name text;
    nodes_table_name text;
    dyn_sql text;
    start_time timestamp;
    end_time timestamp;
BEGIN
    start_time := clock_timestamp();
    
    -- Check if we need to regenerate the network
    IF NOT needs_network_regeneration(staging_schema, trails_table, tolerance_meters) THEN
        -- Use cached network
        EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
        EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
        cache_status := 'USED_CACHE';
        analysis_results := 'Cached network used - no regeneration needed';
        
        RETURN QUERY SELECT node_count, edge_count, analysis_results, cache_status;
        RETURN;
    END IF;
    
    -- Need to regenerate network
    cache_status := 'REGENERATED';
    
    -- Calculate current hash
    SELECT calculate_trail_hash(staging_schema, trails_table) INTO current_hash;
    
    -- Clear existing routing tables
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Create cache table if it doesn't exist
    EXECUTE format($f$
        CREATE TABLE IF NOT EXISTS %I.network_cache (
            id SERIAL PRIMARY KEY,
            network_hash text NOT NULL,
            tolerance double precision NOT NULL,
            created_at timestamp DEFAULT now(),
            node_count integer,
            edge_count integer
        )
    $f$, staging_schema);
    
    -- Generate unique table names
    temp_table_name := 'temp_trails_' || floor(random() * 1000000);
    split_table_name := temp_table_name || '_split';
    nodes_table_name := temp_table_name || '_nodes';
    
    -- Create temporary table with trails for pgRouting
    EXECUTE format('CREATE TABLE %I AS SELECT id, ST_Force2D(geo2) as geom FROM %I.%I WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)', 
                   temp_table_name, staging_schema, trails_table);
    
    -- Use pgr_nodenetwork to create nodes and split edges
    EXECUTE format('SELECT pgr_nodenetwork(''%I'', %s, ''id'', ''geom'', ''split'', '''', false)', 
                   temp_table_name, tolerance_meters);
    
    -- Extract nodes from the nodes table created by pgr_nodenetwork
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
    
    -- Extract edges from the split table created by pgr_nodenetwork
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
    
    -- Get counts
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    -- Analyze the graph using pgr_analyzegraph
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        analysis_results := 'Analysis failed: ' || SQLERRM;
    END;
    
    -- Update cache
    EXECUTE format($f$
        INSERT INTO %I.network_cache (network_hash, tolerance, node_count, edge_count)
        VALUES (%L, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            network_hash = EXCLUDED.network_hash,
            tolerance = EXCLUDED.tolerance,
            node_count = EXCLUDED.node_count,
            edge_count = EXCLUDED.edge_count,
            created_at = now()
    $f$, staging_schema, current_hash, tolerance_meters, node_count, edge_count);
    
    -- Clean up temporary tables
    EXECUTE format('DROP TABLE IF EXISTS %I', temp_table_name);
    EXECUTE format('DROP TABLE IF EXISTS %I', split_table_name);
    EXECUTE format('DROP TABLE IF EXISTS %I', nodes_table_name);
    
    end_time := clock_timestamp();
    cache_status := cache_status || ' (took ' || extract(epoch from (end_time - start_time)) || 's)';
    
    RETURN QUERY SELECT node_count, edge_count, analysis_results, cache_status;
END;
$$ LANGUAGE plpgsql;

-- Function to clear network cache
CREATE OR REPLACE FUNCTION clear_network_cache(
    staging_schema text
) RETURNS void AS $$
BEGIN
    EXECUTE format('DROP TABLE IF EXISTS %I.network_cache', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to get cache status
CREATE OR REPLACE FUNCTION get_cache_status(
    staging_schema text
) RETURNS TABLE (
    cache_exists boolean,
    last_updated timestamp,
    node_count integer,
    edge_count integer,
    tolerance double precision
) AS $$
BEGIN
    RETURN QUERY
    EXECUTE format($f$
        SELECT 
            true as cache_exists,
            created_at as last_updated,
            node_count,
            edge_count,
            tolerance
        FROM %I.network_cache
        ORDER BY created_at DESC
        LIMIT 1
    $f$, staging_schema);
    
    -- If no cache exists, return false
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::timestamp, 0, 0, 0.0;
    END IF;
END;
$$ LANGUAGE plpgsql; 