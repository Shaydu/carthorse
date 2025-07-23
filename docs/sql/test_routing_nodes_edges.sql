-- test_routing_nodes_edges.sql
-- This script creates a test table, runs node/edge functions, and checks results in the test database.

-- Drop and create the test_trails table with all required columns
DROP TABLE IF EXISTS public.test_trails CASCADE;
CREATE TABLE public.test_trails (
    id SERIAL PRIMARY KEY,
    app_uuid TEXT UNIQUE NOT NULL,
    name TEXT,
    length_km REAL,
    elevation_gain REAL,
    geometry GEOMETRY(LINESTRINGZ, 4326) NOT NULL,
    geo2 GEOMETRY(LINESTRINGZ, 4326) NOT NULL
);

-- Insert 10 Boulder trails (with shared endpoints for edge creation)
INSERT INTO public.test_trails (app_uuid, name, length_km, elevation_gain, geometry, geo2) VALUES
('uuid-1', 'Trail 1', 1.0, 100, ST_GeomFromText('LINESTRINGZ(-105.28 40.01 1600, -105.27 40.02 1610)', 4326), ST_GeomFromText('LINESTRINGZ(-105.28 40.01 1600, -105.27 40.02 1610)', 4326)),
('uuid-2', 'Trail 2', 1.0, 120, ST_GeomFromText('LINESTRINGZ(-105.27 40.02 1610, -105.26 40.03 1620)', 4326), ST_GeomFromText('LINESTRINGZ(-105.27 40.02 1610, -105.26 40.03 1620)', 4326)),
('uuid-3', 'Trail 3', 1.0, 90,  ST_GeomFromText('LINESTRINGZ(-105.26 40.03 1620, -105.25 40.04 1630)', 4326), ST_GeomFromText('LINESTRINGZ(-105.26 40.03 1620, -105.25 40.04 1630)', 4326)),
('uuid-4', 'Trail 4', 1.0, 80,  ST_GeomFromText('LINESTRINGZ(-105.25 40.04 1630, -105.24 40.05 1640)', 4326), ST_GeomFromText('LINESTRINGZ(-105.25 40.04 1630, -105.24 40.05 1640)', 4326)),
('uuid-5', 'Trail 5', 1.0, 110, ST_GeomFromText('LINESTRINGZ(-105.24 40.05 1640, -105.23 40.06 1650)', 4326), ST_GeomFromText('LINESTRINGZ(-105.24 40.05 1640, -105.23 40.06 1650)', 4326)),
('uuid-6', 'Trail 6', 1.0, 95,  ST_GeomFromText('LINESTRINGZ(-105.23 40.06 1650, -105.22 40.07 1660)', 4326), ST_GeomFromText('LINESTRINGZ(-105.23 40.06 1650, -105.22 40.07 1660)', 4326)),
('uuid-7', 'Trail 7', 1.0, 105, ST_GeomFromText('LINESTRINGZ(-105.22 40.07 1660, -105.21 40.08 1670)', 4326), ST_GeomFromText('LINESTRINGZ(-105.22 40.07 1660, -105.21 40.08 1670)', 4326)),
('uuid-8', 'Trail 8', 1.0, 115, ST_GeomFromText('LINESTRINGZ(-105.21 40.08 1670, -105.20 40.09 1680)', 4326), ST_GeomFromText('LINESTRINGZ(-105.21 40.08 1670, -105.20 40.09 1680)', 4326)),
('uuid-9', 'Trail 9', 1.0, 130, ST_GeomFromText('LINESTRINGZ(-105.20 40.09 1680, -105.19 40.10 1690)', 4326), ST_GeomFromText('LINESTRINGZ(-105.20 40.09 1680, -105.19 40.10 1690)', 4326)),
('uuid-10', 'Trail 10', 1.0, 140, ST_GeomFromText('LINESTRINGZ(-105.19 40.10 1690, -105.28 40.01 1600)', 4326), ST_GeomFromText('LINESTRINGZ(-105.19 40.10 1690, -105.28 40.01 1600)', 4326));

-- Drop and create split_trails as a copy (if your functions expect it)
DROP TABLE IF EXISTS public.split_trails CASCADE;
CREATE TABLE public.split_trails AS
SELECT * FROM public.test_trails;

-- Create alternative routing functions that use geo2 column instead of geometry
CREATE OR REPLACE FUNCTION public.build_routing_nodes_geo2(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters double precision DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            SELECT 
                ST_StartPoint(geo2) as start_point, 
                ST_EndPoint(geo2) as end_point, 
                app_uuid, 
                name
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        all_endpoints AS (
            SELECT 
                start_point as point, 
                ST_Force3D(start_point) as point_3d, 
                ARRAY[name] as connected_trails, 
                'endpoint' as node_type 
            FROM trail_endpoints
            UNION ALL
            SELECT 
                end_point as point, 
                ST_Force3D(end_point) as point_3d, 
                ARRAY[name] as connected_trails, 
                'endpoint' as node_type 
            FROM trail_endpoints
        ),
        grouped_nodes AS (
            SELECT 
                ST_X(point) as lng, 
                ST_Y(point) as lat, 
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT ct) as all_connected_trails,
                CASE WHEN array_length(array_agg(DISTINCT ct), 1) > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
                point, point_3d
            FROM all_endpoints
            CROSS JOIN LATERAL unnest(connected_trails) AS ct
            GROUP BY point, point_3d
        ),
        final_nodes AS (
            SELECT DISTINCT ON (point) lng, lat, elevation, all_connected_trails, node_type
            FROM grouped_nodes
            ORDER BY point, array_length(all_connected_trails, 1) DESC
        )
        SELECT lat, lng, elevation, node_type, array_to_string(all_connected_trails, ',') as connected_trails
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    $f$, staging_schema, staging_schema, trails_table);
    RAISE NOTICE 'build_routing_nodes_geo2 SQL: %', dyn_sql;
    EXECUTE dyn_sql USING intersection_tolerance_meters;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Alternative intersection detection function for geo2 column
CREATE OR REPLACE FUNCTION public.detect_trail_intersections_geo2(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 2.0
) RETURNS TABLE (
    intersection_point geometry,
    intersection_point_3d geometry,
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters double precision
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH trail_geometries AS (
            SELECT id, app_uuid, name, ST_Force2D(geo2) as geometry
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2)
        ),
        intersection_points AS (
            SELECT 
                ST_Node(ST_Collect(geometry)) as nodes
            FROM trail_geometries
        ),
        exploded_nodes AS (
            SELECT (ST_Dump(nodes)).geom as point
            FROM intersection_points
        ),
        node_connections AS (
            SELECT 
                en.point,
                array_agg(tg.app_uuid) as connected_trail_ids,
                array_agg(tg.name) as connected_trail_names,
                COUNT(*) as connection_count
            FROM exploded_nodes en
            JOIN trail_geometries tg ON ST_DWithin(en.point, tg.geometry, $1)
            GROUP BY en.point
        )
        SELECT 
            point as intersection_point,
            ST_Force3D(point) as intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            CASE WHEN connection_count > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
            $1 as distance_meters
        FROM node_connections
        WHERE connection_count > 0
    $f$, staging_schema, trails_table) USING tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- Alternative routing edges function for geo2 column
CREATE OR REPLACE FUNCTION public.build_routing_edges_geo2(
    staging_schema text,
    trails_table text,
    edge_tolerance double precision DEFAULT 20.0
) RETURNS integer AS $$
DECLARE
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
        WITH trail_segments AS (
            SELECT id, app_uuid, name, ST_Force2D(geo2) as geometry, length_km, elevation_gain,
                   ST_StartPoint(ST_Force2D(geo2)) as start_point, ST_EndPoint(ST_Force2D(geo2)) as end_point
            FROM %I.%I
            WHERE geo2 IS NOT NULL AND ST_IsValid(geo2) AND ST_Length(geo2) > 0.1
        ),
        node_connections AS (
            SELECT ts.id as trail_id, ts.app_uuid as trail_uuid, ts.name as trail_name, ts.length_km, ts.elevation_gain, ts.geometry,
                   fn.id as from_node_id, tn.id as to_node_id, fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM trail_segments ts
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %s)
                ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %s)
                ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, geometry, from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geometry::geography) / 1000) as distance_km,
                   COALESCE(elevation_gain, 0) as elevation_gain,
                   ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326)) as geometry
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid as trail_id, trail_name, distance_km, elevation_gain, geometry
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance);
    RAISE NOTICE 'build_routing_edges_geo2 SQL: %', dyn_sql;
    EXECUTE dyn_sql;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- Clean out previous test results
TRUNCATE public.routing_nodes, public.routing_edges RESTART IDENTITY;

-- Run the alternative node and edge export functions using geo2 column
SELECT public.build_routing_nodes_geo2('public', 'test_trails', 2.0);
SELECT public.build_routing_edges_geo2('public', 'test_trails', 20.0);

-- Check the results
SELECT COUNT(*) AS node_count FROM public.routing_nodes;
SELECT COUNT(*) AS edge_count FROM public.routing_edges;

-- Optionally, inspect the actual nodes/edges
-- SELECT * FROM public.routing_nodes;
-- SELECT * FROM public.routing_edges; 