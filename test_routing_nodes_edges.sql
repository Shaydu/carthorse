-- test_routing_nodes_edges.sql
-- This script creates a test table, runs node/edge functions, and checks results in the test database.

-- 1. Drop and create the test_trails table
DROP TABLE IF EXISTS public.test_trails CASCADE;
CREATE TABLE public.test_trails (
    id SERIAL PRIMARY KEY,
    name TEXT,
    geom geometry(LineString, 4326)
);

-- 2. Insert 10 Boulder trails (example geometries)
INSERT INTO public.test_trails (name, geom) VALUES
('Trail 1', ST_GeomFromText('LINESTRING(-105.28 40.01, -105.27 40.02)', 4326)),
('Trail 2', ST_GeomFromText('LINESTRING(-105.27 40.02, -105.26 40.03)', 4326)),
('Trail 3', ST_GeomFromText('LINESTRING(-105.26 40.03, -105.25 40.04)', 4326)),
('Trail 4', ST_GeomFromText('LINESTRING(-105.25 40.04, -105.24 40.05)', 4326)),
('Trail 5', ST_GeomFromText('LINESTRING(-105.24 40.05, -105.23 40.06)', 4326)),
('Trail 6', ST_GeomFromText('LINESTRING(-105.23 40.06, -105.22 40.07)', 4326)),
('Trail 7', ST_GeomFromText('LINESTRING(-105.22 40.07, -105.21 40.08)', 4326)),
('Trail 8', ST_GeomFromText('LINESTRING(-105.21 40.08, -105.20 40.09)', 4326)),
('Trail 9', ST_GeomFromText('LINESTRING(-105.20 40.09, -105.19 40.10)', 4326)),
('Trail 10', ST_GeomFromText('LINESTRING(-105.19 40.10, -105.18 40.11)', 4326));

-- 3. (Optional) Create split_trails table if needed
DROP TABLE IF EXISTS public.split_trails CASCADE;
CREATE TABLE public.split_trails AS
SELECT * FROM public.test_trails;

-- 4. Run the node and edge export functions
-- Adjust function/table names if your setup is different!
SELECT build_routing_nodes('public', 'test_trails', 2.0);
SELECT build_routing_edges('public', 'test_trails');

-- 5. Check the results
SELECT COUNT(*) AS node_count FROM public.routing_nodes;
SELECT COUNT(*) AS edge_count FROM public.routing_edges;

-- 6. (Optional) Clean up (uncomment if you want to drop the tables after checking)
-- DROP TABLE IF EXISTS public.routing_nodes;
-- DROP TABLE IF EXISTS public.routing_edges;
-- DROP TABLE IF EXISTS public.split_trails;
-- DROP TABLE IF EXISTS public.test_trails; 