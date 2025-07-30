-- ============================================================================
-- Create Production Routing Graph Functions
-- ============================================================================
-- This creates reusable functions for generating routing graphs
-- in the public schema of trail_master_db (production database)

-- Step 1: Install pgRouting if not already installed
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- Step 2: Create function to generate routing graph
CREATE OR REPLACE FUNCTION generate_routing_graph()
RETURNS TABLE(edges_count INTEGER, nodes_count INTEGER) AS $$
BEGIN
  -- Drop existing tables
  DROP TABLE IF EXISTS public.routing_edges CASCADE;
  DROP TABLE IF EXISTS public.routing_nodes CASCADE;
  
  -- Create routing edges (one edge per trail)
  CREATE TABLE public.routing_edges AS
  SELECT
    id,
    app_uuid,
    name,
    trail_type,
    length_km,
    elevation_gain,
    elevation_loss,
    -- Use simplified geometry for routing
            ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) AS geom
  FROM public.trails
  WHERE geometry IS NOT NULL;

  -- Add routing topology columns
  ALTER TABLE public.routing_edges ADD COLUMN source INTEGER;
  ALTER TABLE public.routing_edges ADD COLUMN target INTEGER;

  -- Create topology using pgRouting
  PERFORM pgr_createTopology('public.routing_edges', 0.0001, 'geom', 'id');

  -- Create nodes table from topology
  CREATE TABLE public.routing_nodes AS
  SELECT 
    id,
    the_geom,
    cnt,
    ST_X(the_geom) as lng,
    ST_Y(the_geom) as lat,
    ST_Z(the_geom) as elevation
  FROM public.routing_edges_vertices_pgr;

  -- Add spatial indexes for performance
  CREATE INDEX IF NOT EXISTS idx_routing_edges_geom ON public.routing_edges USING GIST (geom);
  CREATE INDEX IF NOT EXISTS idx_routing_nodes_geom ON public.routing_nodes USING GIST (the_geom);

  -- Return counts
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM public.routing_edges) as edges_count,
    (SELECT COUNT(*)::INTEGER FROM public.routing_nodes) as nodes_count;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create function to show routing graph summary
CREATE OR REPLACE FUNCTION show_routing_summary()
RETURNS TABLE(type TEXT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'Routing Edges (One per trail)' as type,
    COUNT(*) as count
  FROM public.routing_edges
  UNION ALL
  SELECT 
    'Routing Nodes (Intersections)' as type,
    COUNT(*) as count
  FROM public.routing_nodes;
END;
$$ LANGUAGE plpgsql;