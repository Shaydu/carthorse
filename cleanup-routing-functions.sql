-- Cleanup duplicate routing functions and install correct versions
-- This script removes duplicate functions and installs the working versions

-- Drop all existing routing functions to clean up duplicates
DROP FUNCTION IF EXISTS build_routing_edges(text, text);
DROP FUNCTION IF EXISTS build_routing_edges(text, text, double precision);
DROP FUNCTION IF EXISTS build_routing_edges_fixed(text, text, double precision);
DROP FUNCTION IF EXISTS build_routing_nodes(text, text, double precision);
DROP FUNCTION IF EXISTS cleanup_routing_graph(text);
DROP FUNCTION IF EXISTS generate_routing_edges_native(text, real);
DROP FUNCTION IF EXISTS generate_routing_graph();
DROP FUNCTION IF EXISTS generate_routing_nodes_native(text, real);
DROP FUNCTION IF EXISTS prep_routing_network(text, text, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS prepare_routing_network(text);
DROP FUNCTION IF EXISTS prepare_routing_network(text, text, text, text, text, text, text, text, double precision, boolean);
DROP FUNCTION IF EXISTS show_routing_summary();
DROP FUNCTION IF EXISTS validate_routing_edge_consistency();

-- Now install the correct functions from working-routing-functions.sql
-- Function: generate_routing_nodes_native (OPTIMIZED VERSION)
-- Creates nodes only at actual trail endpoints and intersections, filters out isolated nodes
-- Uses YAML configuration for tolerance (defaultIntersectionTolerance: 2.0m)
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(staging_schema text, intersection_tolerance_meters real DEFAULT 2.0)
RETURNS TABLE(node_count integer, success boolean, message text) AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from actual trail endpoints and intersections
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails
            FROM trail_endpoints
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails
            FROM all_endpoints
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema);
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes (routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql;

-- Function: generate_routing_edges_native (OPTIMIZED VERSION)
-- Creates edges based on actual trail geometry, with configurable tolerance for coordinate matching
-- Only creates edges between connected, routable nodes
-- Uses YAML configuration for tolerance (defaultIntersectionTolerance: 0.5m)
CREATE OR REPLACE FUNCTION generate_routing_edges_native(staging_schema text, tolerance_meters real DEFAULT 0.5)
RETURNS TABLE(edge_count integer, success boolean, message text) AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    orphaned_count integer := 0;
    orphaned_edges_count integer := 0;
    tolerance_degrees real := tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from actual trail segments (simplified version)
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry, geojson)
        SELECT 
            start_node.id as source, 
            end_node.id as target, 
            t.app_uuid as trail_id, 
            t.name as trail_name, 
            t.length_km as distance_km, 
            t.elevation_gain, 
            t.elevation_loss, 
            t.geometry, 
            ST_AsGeoJSON(t.geometry, 6, 0) as geojson 
        FROM %I.trails t
        JOIN %I.routing_nodes start_node ON ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), %L)
        JOIN %I.routing_nodes end_node ON ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), %L)
        WHERE t.geometry IS NOT NULL 
        AND ST_IsValid(t.geometry) 
        AND t.length_km > 0
        AND start_node.id IS NOT NULL 
        AND end_node.id IS NOT NULL
        AND start_node.id <> end_node.id
    $f$, staging_schema, staging_schema, 'trails', staging_schema, 'routing_nodes', tolerance_degrees, staging_schema, 'routing_nodes', tolerance_degrees);
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Clean up orphaned nodes (nodes that have no edges)
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.routing_edges 
            UNION 
            SELECT DISTINCT target FROM %I.routing_edges
        )
    $f$, staging_schema, staging_schema, 'routing_edges', staging_schema, 'routing_edges');
    
    GET DIAGNOSTICS orphaned_count = ROW_COUNT;
    
    -- Clean up orphaned edges (edges that point to non-existent nodes)
    EXECUTE format($f$
        DELETE FROM %I.routing_edges 
        WHERE source NOT IN (SELECT id FROM %I.routing_nodes) 
        OR target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema, 'routing_edges', staging_schema, 'routing_nodes', staging_schema, 'routing_nodes');
    
    GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Generated %s routing edges from %s nodes, cleaned up %s orphaned nodes and %s orphaned edges (routable only, tolerance: %s m)', edge_count_var, node_count_var, orphaned_count, orphaned_edges_count, tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql;

-- Add a simple cleanup function
CREATE OR REPLACE FUNCTION cleanup_routing_graph(staging_schema text)
RETURNS TABLE(success boolean, message text, cleaned_nodes integer, cleaned_edges integer) AS $$
DECLARE
    orphaned_nodes integer := 0;
    orphaned_edges integer := 0;
BEGIN
    -- Clean up orphaned nodes (nodes that have no edges)
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.routing_edges 
            UNION 
            SELECT DISTINCT target FROM %I.routing_edges
        )
    $f$, staging_schema, staging_schema, 'routing_edges', staging_schema, 'routing_edges');
    
    GET DIAGNOSTICS orphaned_nodes = ROW_COUNT;
    
    -- Clean up orphaned edges (edges that point to non-existent nodes)
    EXECUTE format($f$
        DELETE FROM %I.routing_edges 
        WHERE source NOT IN (SELECT id FROM %I.routing_nodes) 
        OR target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema, 'routing_edges', staging_schema, 'routing_nodes', staging_schema, 'routing_nodes');
    
    GET DIAGNOSTICS orphaned_edges = ROW_COUNT;
    
    RETURN QUERY SELECT 
        true as success,
        format('Cleaned up %s orphaned nodes and %s orphaned edges', orphaned_nodes, orphaned_edges) as message,
        orphaned_nodes,
        orphaned_edges;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        false as success,
        format('Error during cleanup: %s', SQLERRM) as message,
        0 as cleaned_nodes,
        0 as cleaned_edges;
END;
$$ LANGUAGE plpgsql;

-- Add a summary function
CREATE OR REPLACE FUNCTION show_routing_summary()
RETURNS TABLE(type text, count bigint) AS $$
BEGIN
    RETURN QUERY SELECT 'routing_nodes'::text, COUNT(*)::bigint FROM routing_nodes
    UNION ALL
    SELECT 'routing_edges'::text, COUNT(*)::bigint FROM routing_edges;
END;
$$ LANGUAGE plpgsql;

-- Verify the functions are installed correctly
SELECT 'generate_routing_nodes_native' as function_name, 
       pg_get_functiondef(oid) as definition 
FROM pg_proc 
WHERE proname = 'generate_routing_nodes_native';

SELECT 'generate_routing_edges_native' as function_name, 
       pg_get_functiondef(oid) as definition 
FROM pg_proc 
WHERE proname = 'generate_routing_edges_native'; 