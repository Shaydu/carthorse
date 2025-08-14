-- ============================================================================
-- CARTHORSE CURRENT ORCHESTRATOR FUNCTION DEPENDENCIES
-- ============================================================================
-- This file contains ONLY the functions that the current orchestrator actually uses
-- Based on code path analysis of the current CarthorseOrchestrator workflow
--
-- Functions included:
-- - detect_trail_intersections (used in routing queries)
-- - build_routing_nodes (used in staging schema setup)
-- - build_routing_edges (used in staging schema setup)
--
-- Functions NOT included (not used by current orchestrator):
-- - get_intersection_stats (statistics only)
-- - validate_intersection_detection (validation only)
-- - validate_spatial_data_integrity (validation only)
-- - check_database_integrity (validation only)
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- ============================================================================
-- CORE FUNCTION: detect_trail_intersections
-- ============================================================================
-- Used by: routing queries (though current orchestrator doesn't use routing queries)
-- Purpose: Detects intersections between trails for routing graph building
-- ENHANCED: Now preserves small connector trails for better network connectivity

CREATE OR REPLACE FUNCTION detect_trail_intersections(
    trails_schema text,
    trails_table text,
    intersection_tolerance_meters float DEFAULT 1.0
) RETURNS TABLE (
    intersection_point geometry,
    intersection_point_3d geometry,
    connected_trail_ids integer[],
    connected_trail_names text[],
    node_type text,
    distance_meters float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH trail_endpoints AS (
            -- Extract start and end points of all trails
            -- REMOVED: ST_Length(geometry) > 0 filter to preserve small connector trails
            SELECT 
                id,
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation,
                ST_Length(geometry::geography) as trail_length_meters
            FROM %I.%I
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              -- Preserve all trails, including small connectors (minimum 0.1 meters)
              AND ST_Length(geometry::geography) >= 0.1
        ),
        endpoint_clusters AS (
            -- Cluster endpoints that are within tolerance
            SELECT 
                ST_ClusterKMeans(
                    ST_Collect(ARRAY[start_point, end_point]), 
                    2
                ) OVER () as cluster_id,
                id,
                app_uuid,
                name,
                start_point,
                end_point,
                start_elevation,
                end_elevation,
                trail_length_meters
            FROM trail_endpoints
        ),
        intersection_points AS (
            -- Find actual intersections between trails
            -- ENHANCED: Include small connector trails in intersection detection
            SELECT DISTINCT
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
                ST_Force3D(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                0.0 as distance_meters
            FROM %I.%I t1
            JOIN %I.%I t2 ON (
                t1.id < t2.id AND
                ST_Intersects(t1.geometry, t2.geometry) AND
                ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN (''ST_Point'', ''ST_MultiPoint'')
            )
            WHERE t1.geometry IS NOT NULL 
              AND t2.geometry IS NOT NULL
              AND ST_IsValid(t1.geometry)
              AND ST_IsValid(t2.geometry)
              -- Preserve small connector trails (minimum 0.1 meters)
              AND ST_Length(t1.geometry::geography) >= 0.1
              AND ST_Length(t2.geometry::geography) >= 0.1
        ),
        small_connector_endpoints AS (
            -- Special handling for small connector trails (0.1-50 meters)
            -- These are often important for network connectivity
            SELECT 
                start_point as intersection_point,
                ST_Force3D(start_point) as intersection_point_3d,
                ARRAY[id] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                ''small_connector_endpoint'' as node_type,
                0.0 as distance_meters
            FROM trail_endpoints
            WHERE trail_length_meters BETWEEN 0.1 AND 50.0
              AND NOT EXISTS (
                SELECT 1 FROM intersection_points ip
                WHERE ST_DWithin(start_point, ip.intersection_point, $1)
              )
            UNION ALL
            SELECT 
                end_point as intersection_point,
                ST_Force3D(end_point) as intersection_point_3d,
                ARRAY[id] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                ''small_connector_endpoint'' as node_type,
                0.0 as distance_meters
            FROM trail_endpoints
            WHERE trail_length_meters BETWEEN 0.1 AND 50.0
              AND NOT EXISTS (
                SELECT 1 FROM intersection_points ip
                WHERE ST_DWithin(end_point, ip.intersection_point, $1)
              )
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            node_type,
            distance_meters
        FROM intersection_points
        UNION ALL
        SELECT 
            start_point as intersection_point,
            ST_Force3D(start_point) as intersection_point_3d,
            ARRAY[id] as connected_trail_ids,
            ARRAY[name] as connected_trail_names,
            ''endpoint'' as node_type,
            0.0 as distance_meters
        FROM trail_endpoints
        WHERE trail_length_meters > 50.0  -- Only regular endpoints for longer trails
          AND NOT EXISTS (
            SELECT 1 FROM intersection_points ip
            WHERE ST_DWithin(start_point, ip.intersection_point, $1)
          )
        UNION ALL
        SELECT 
            end_point as intersection_point,
            ST_Force3D(end_point) as intersection_point_3d,
            ARRAY[id] as connected_trail_ids,
            ARRAY[name] as connected_trail_names,
            ''endpoint'' as node_type,
            0.0 as distance_meters
        FROM trail_endpoints
        WHERE trail_length_meters > 50.0  -- Only regular endpoints for longer trails
          AND NOT EXISTS (
            SELECT 1 FROM intersection_points ip
            WHERE ST_DWithin(end_point, ip.intersection_point, $1)
          )
        UNION ALL
        -- Include small connector endpoints
        SELECT * FROM small_connector_endpoints
    ', trails_schema, trails_table, trails_schema, trails_table, trails_schema, trails_table)
    USING intersection_tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STAGING SCHEMA FUNCTION: build_routing_nodes
-- ============================================================================
-- Used by: staging schema setup (though current orchestrator doesn't use this)
-- Purpose: Builds routing nodes from trail intersections and endpoints
-- ENHANCED: Now preserves small connector trails for better network connectivity

CREATE OR REPLACE FUNCTION build_routing_nodes(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters float DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Insert routing nodes using intersection detection
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH intersection_data AS (
            SELECT 
                intersection_point,
                intersection_point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM detect_trail_intersections(''%I'', ''trails'', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1  -- Only true intersections
        ),
        all_nodes AS (
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM intersection_data
            UNION ALL
            SELECT 
                start_point as point,
                ST_Force3D(start_point) as point_3d,
                ARRAY[id] as connected_trail_ids,
                ARRAY[name] as connected_trail_names,
                ''endpoint'' as node_type,
                0.0 as distance_meters
            FROM %I.%I
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              -- Preserve all trails, including small connectors (minimum 0.1 meters)
              AND ST_Length(geometry::geography) >= 0.1
        ),
        clustered_nodes AS (
            SELECT 
                ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
                ST_Y(clustered_point) as lat,
                ST_X(clustered_point) as lng,
                COALESCE(ST_Z(clustered_point), 0) as elevation,
                node_type,
                array_agg(connected_trail_ids) as all_connected_trails,
                array_agg(connected_trail_names) as all_connected_names
            FROM (
                SELECT 
                    ST_Centroid(ST_Collect(point)) as clustered_point,
                    node_type,
                    connected_trail_ids,
                    connected_trail_names
                FROM all_nodes
                GROUP BY node_type, connected_trail_ids, connected_trail_names
            ) grouped
            GROUP BY clustered_point, node_type
        )
        SELECT 
            gen_random_uuid()::text as node_uuid,
            lat,
            lng,
            elevation,
            node_type,
            json_agg(DISTINCT jsonb_build_object(
                ''trail_ids'', all_connected_trails,
                ''trail_names'', all_connected_names
            )) as connected_trails
        FROM clustered_nodes
        GROUP BY lat, lng, elevation, node_type
        ORDER BY lat, lng
    ', staging_schema, staging_schema, trails_table, staging_schema, trails_table, staging_schema, trails_table)
    USING intersection_tolerance_meters;
    
    -- Get the count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STAGING SCHEMA FUNCTION: build_routing_edges
-- ============================================================================
-- Used by: staging schema setup (though current orchestrator doesn't use this)
-- Purpose: Builds routing edges between nodes
-- ENHANCED: Now preserves small connector trails for better network connectivity

CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text
) RETURNS integer AS $$
DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Insert routing edges
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss)
        WITH trail_segments AS (
            SELECT 
                id,
                app_uuid,
                name,
                geometry,
                length_km,
                elevation_gain,
                elevation_loss
            FROM %I.%I
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              -- Preserve all trails, including small connectors (minimum 0.1 meters)
              AND ST_Length(geometry::geography) >= 0.1
        ),
        node_pairs AS (
            SELECT 
                n1.id as from_node_id,
                n2.id as to_node_id,
                t.id as trail_id,
                t.app_uuid as trail_uuid,
                t.name as trail_name,
                t.length_km as distance_km,
                t.elevation_gain,
                t.elevation_loss
            FROM %I.routing_nodes n1
            JOIN %I.routing_nodes n2 ON n1.id != n2.id
            JOIN trail_segments t ON (
                ST_DWithin(
                    ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
                    ST_StartPoint(t.geometry),
                    0.001
                ) AND
                ST_DWithin(
                    ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326),
                    ST_EndPoint(t.geometry),
                    0.001
                )
            )
        ),
        edge_metrics AS (
            SELECT 
                from_node_id,
                to_node_id,
                trail_uuid,
                trail_name,
                distance_km,
                elevation_gain,
                elevation_loss,
                -- Check if both nodes are connected to the trail
                EXISTS (
                    SELECT 1 FROM %I.routing_nodes n
                    WHERE n.id = from_node_id
                    AND jsonb_path_exists(n.connected_trails, ''$[*].trail_ids[*] ? (@ == $tid)'', ''{"tid": trail_id}'')
                ) as start_connected,
                EXISTS (
                    SELECT 1 FROM %I.routing_nodes n
                    WHERE n.id = to_node_id
                    AND jsonb_path_exists(n.connected_trails, ''$[*].trail_ids[*] ? (@ == $tid)'', ''{"tid": trail_id}'')
                ) as end_connected
            FROM node_pairs
        )
        SELECT 
            from_node_id,
            to_node_id,
            trail_uuid as trail_id,
            trail_name,
            distance_km,
            elevation_gain,
            elevation_loss
        FROM edge_metrics
        WHERE start_connected AND end_connected
        ORDER BY trail_id
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema, staging_schema, staging_schema)
    USING intersection_tolerance_meters;
    
    -- Get the count of inserted edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION CLEANUP (for idempotency)
-- ============================================================================
-- These functions can be safely dropped and recreated

COMMENT ON FUNCTION detect_trail_intersections(text, text, float) IS 'Detects intersections between trails for routing graph building - ENHANCED to preserve small connector trails';
COMMENT ON FUNCTION build_routing_nodes(text, text, float) IS 'Builds routing nodes from trail intersections and endpoints - ENHANCED to preserve small connector trails';
COMMENT ON FUNCTION build_routing_edges(text, text) IS 'Builds routing edges between nodes - ENHANCED to preserve small connector trails';

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================
-- 
-- -- Detect intersections in a staging schema (now preserves small connectors)
-- SELECT * FROM detect_trail_intersections('staging_boulder_1234567890', 'trails', 2.0);
-- 
-- -- Build routing nodes (if using staging schema approach)
-- SELECT build_routing_nodes('staging_boulder_1234567890', 'trails', 2.0);
-- 
-- -- Build routing edges (if using staging schema approach)
-- SELECT build_routing_edges('staging_boulder_1234567890', 'trails');
-- 
-- ============================================================================ 