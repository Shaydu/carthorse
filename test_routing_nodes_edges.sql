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
    geometry geometry(LineStringZ, 4326) NOT NULL
);

-- Insert 10 Boulder trails (with shared endpoints for edge creation)
INSERT INTO public.test_trails (app_uuid, name, length_km, elevation_gain, geometry) VALUES
('uuid-1', 'Trail 1', 1.0, 100, ST_GeomFromText('LINESTRINGZ(-105.28 40.01 1600, -105.27 40.02 1610)', 4326)),
('uuid-2', 'Trail 2', 1.0, 120, ST_GeomFromText('LINESTRINGZ(-105.27 40.02 1610, -105.26 40.03 1620)', 4326)),
('uuid-3', 'Trail 3', 1.0, 90,  ST_GeomFromText('LINESTRINGZ(-105.26 40.03 1620, -105.25 40.04 1630)', 4326)),
('uuid-4', 'Trail 4', 1.0, 80,  ST_GeomFromText('LINESTRINGZ(-105.25 40.04 1630, -105.24 40.05 1640)', 4326)),
('uuid-5', 'Trail 5', 1.0, 110, ST_GeomFromText('LINESTRINGZ(-105.24 40.05 1640, -105.23 40.06 1650)', 4326)),
('uuid-6', 'Trail 6', 1.0, 95,  ST_GeomFromText('LINESTRINGZ(-105.23 40.06 1650, -105.22 40.07 1660)', 4326)),
('uuid-7', 'Trail 7', 1.0, 105, ST_GeomFromText('LINESTRINGZ(-105.22 40.07 1660, -105.21 40.08 1670)', 4326)),
('uuid-8', 'Trail 8', 1.0, 115, ST_GeomFromText('LINESTRINGZ(-105.21 40.08 1670, -105.20 40.09 1680)', 4326)),
('uuid-9', 'Trail 9', 1.0, 130, ST_GeomFromText('LINESTRINGZ(-105.20 40.09 1680, -105.19 40.10 1690)', 4326)),
('uuid-10', 'Trail 10', 1.0, 140, ST_GeomFromText('LINESTRINGZ(-105.19 40.10 1690, -105.28 40.01 1600)', 4326));

-- Drop and create split_trails as a copy (if your functions expect it)
DROP TABLE IF EXISTS public.split_trails CASCADE;
CREATE TABLE public.split_trails AS
SELECT * FROM public.test_trails;

-- Clean out previous test results
TRUNCATE public.routing_nodes, public.routing_edges RESTART IDENTITY;

-- Run the node and edge export functions
SELECT public.build_routing_nodes('public', 'test_trails', 2.0);
SELECT public.build_routing_edges('public', 'test_trails', 20.0);

-- Check the results
SELECT COUNT(*) AS node_count FROM public.routing_nodes;
SELECT COUNT(*) AS edge_count FROM public.routing_edges;

-- Optionally, inspect the actual nodes/edges
-- SELECT * FROM public.routing_nodes;
-- SELECT * FROM public.routing_edges; 