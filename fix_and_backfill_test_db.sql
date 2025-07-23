-- 0. Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Drop and recreate test_trails with the full schema of trails
DROP TABLE IF EXISTS public.test_trails CASCADE;
CREATE TABLE public.test_trails (LIKE public.trails INCLUDING ALL);

-- 2. Insert 10 Boulder trails from your real data
INSERT INTO public.test_trails
SELECT * FROM public.trails WHERE region = 'boulder' LIMIT 10;

-- 3. Ensure routing_nodes has all required columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'routing_nodes' AND column_name = 'node_uuid'
    ) THEN
        ALTER TABLE public.routing_nodes
            ADD COLUMN node_uuid uuid,
            ADD COLUMN lat double precision,
            ADD COLUMN lng double precision,
            ADD COLUMN elevation double precision,
            ADD COLUMN node_type text,
            ADD COLUMN connected_trails text;
    END IF;
END$$;

-- 4. Ensure routing_edges has all required columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'routing_edges' AND column_name = 'from_node_id'
    ) THEN
        ALTER TABLE public.routing_edges
            ADD COLUMN from_node_id integer,
            ADD COLUMN to_node_id integer,
            ADD COLUMN trail_id uuid,
            ADD COLUMN trail_name text,
            ADD COLUMN distance_km double precision,
            ADD COLUMN elevation_gain double precision;
    END IF;
END$$;

-- 5. Ensure test_trails has all columns referenced by your functions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'test_trails' AND column_name = 'app_uuid'
    ) THEN
        ALTER TABLE public.test_trails
            ADD COLUMN app_uuid uuid;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'test_trails' AND column_name = 'length_km'
    ) THEN
        ALTER TABLE public.test_trails
            ADD COLUMN length_km double precision;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'test_trails' AND column_name = 'elevation_gain'
    ) THEN
        ALTER TABLE public.test_trails
            ADD COLUMN elevation_gain double precision;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'test_trails' AND column_name = 'geometry'
    ) THEN
        ALTER TABLE public.test_trails
            ADD COLUMN geometry geometry(LineString, 4326);
    END IF;
END$$;

-- 6. Backfill app_uuid in test_trails
UPDATE public.test_trails
SET app_uuid = gen_random_uuid()
WHERE app_uuid IS NULL;

-- 7. (Optional) Backfill app_uuid in main trails table for future test DB refreshes
UPDATE public.trails
SET app_uuid = gen_random_uuid()
WHERE app_uuid IS NULL;

-- 8. Show the first 3 rows of test_trails to verify app_uuid and columns
SELECT id, app_uuid, name, length_km, elevation_gain, geometry FROM public.test_trails LIMIT 3;

-- 9. Show the columns of test_trails, routing_nodes, and routing_edges
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'test_trails';
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'routing_nodes';
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'routing_edges'; 