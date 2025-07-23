-- 1. Ensure output tables have the correct columns
ALTER TABLE public.routing_nodes
  ADD COLUMN IF NOT EXISTS node_uuid uuid,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS elevation double precision,
  ADD COLUMN IF NOT EXISTS node_type text,
  ADD COLUMN IF NOT EXISTS connected_trails text;

ALTER TABLE public.routing_edges
  ADD COLUMN IF NOT EXISTS from_node_id integer,
  ADD COLUMN IF NOT EXISTS to_node_id integer,
  ADD COLUMN IF NOT EXISTS trail_id uuid,
  ADD COLUMN IF NOT EXISTS trail_name text,
  ADD COLUMN IF NOT EXISTS distance_km double precision,
  ADD COLUMN IF NOT EXISTS elevation_gain double precision;

-- 2. Insert guaranteed-intersecting stub lines into test_trails
INSERT INTO public.test_trails (name, geom)
VALUES
  ('A', ST_GeomFromText('LINESTRING(0 0, 1 1)', 4326)),
  ('B', ST_GeomFromText('LINESTRING(0 1, 1 0)', 4326)),
  ('C', ST_GeomFromText('LINESTRING(0.5 0, 0.5 1)', 4326))
ON CONFLICT DO NOTHING;

-- 3. Add geometry column if missing and copy 2D geom to 3D geometry
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'test_trails' AND column_name = 'geometry'
  ) THEN
    ALTER TABLE public.test_trails ADD COLUMN geometry GEOMETRY(LINESTRING, 4326);
  END IF;
END$$;

UPDATE public.test_trails
SET geometry = ST_Force3D(geom)
WHERE geom IS NOT NULL;

-- 4. Run node/edge functions
SELECT build_routing_nodes('public', 'test_trails', 2.0);
SELECT build_routing_edges('public', 'test_trails');

-- 5. Show node and edge counts
SELECT COUNT(*) AS node_count FROM public.routing_nodes;
SELECT COUNT(*) AS edge_count FROM public.routing_edges;

-- 6. Show a sample of the output
SELECT * FROM public.routing_nodes LIMIT 5;
SELECT * FROM public.routing_edges LIMIT 5;
