-- Populate the carthorse schema with relevant trails from public.trails
-- Fixed version with correct column names

-- First, let's see what's currently in the carthorse schema
SELECT 'Current carthorse trails count:' as info, COUNT(*) as count FROM carthorse_1754955399973.trails;

-- Copy relevant trails from public.trails to carthorse schema with correct column mapping
INSERT INTO carthorse_1754955399973.trails (id, app_uuid, name, region, osm_id, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, created_at, updated_at, geometry)
SELECT 
    t.id,
    t.app_uuid,
    t.name,
    t.region,
    t.osm_id,
    t.trail_type,
    t.surface_type as surface,  -- Map surface_type to surface
    t.difficulty,
    t.length_km,
    t.elevation_gain,
    t.elevation_loss,
    t.max_elevation,
    t.min_elevation,
    t.avg_elevation,
    t.bbox_min_lng,
    t.bbox_max_lng,
    t.bbox_min_lat,
    t.bbox_max_lat,
    t.created_at,
    t.updated_at,
    t.geometry
FROM trails t
WHERE t.region = 'boulder' 
  AND ST_Intersects(t.geometry, ST_MakeEnvelope(-105.285, 39.965, -105.280, 39.975, 4326))
  AND t.app_uuid::text NOT IN (SELECT app_uuid FROM carthorse_1754955399973.trails WHERE app_uuid IS NOT NULL);

-- Check how many trails were copied
SELECT 'Trails copied to carthorse:' as info, COUNT(*) as count FROM carthorse_1754955399973.trails;

-- Show some of the copied trails
SELECT 'Sample copied trails:' as info, id, name, app_uuid, ST_Length(geometry) as length_m 
FROM carthorse_1754955399973.trails 
WHERE name LIKE '%Mesa%' 
ORDER BY ST_Length(geometry) DESC 
LIMIT 5;

-- Create the routing_nodes table if it doesn't exist
CREATE TABLE IF NOT EXISTS carthorse_1754955399973.routing_nodes (
    id SERIAL PRIMARY KEY,
    lng double precision NOT NULL,
    lat double precision NOT NULL,
    elevation double precision,
    node_type text,
    connected_trails text,
    color text,
    geojson text
);

-- Create the routing_edges table if it doesn't exist
CREATE TABLE IF NOT EXISTS carthorse_1754955399973.routing_edges (
    id SERIAL PRIMARY KEY,
    source integer NOT NULL,
    target integer NOT NULL,
    trail_id text,
    trail_name text,
    distance_km real,
    elevation_gain real,
    elevation_loss real,
    geometry geometry(LineString,4326),
    geojson text
);

-- Now let's clear the existing ways_noded and regenerate the routing network
DELETE FROM carthorse_1754955399973.ways_noded;

-- Regenerate routing nodes
SELECT * FROM generate_routing_nodes_native('carthorse_1754955399973', 50.0);

-- Regenerate routing edges
SELECT * FROM generate_routing_edges_native('carthorse_1754955399973', 50.0);

-- Check the final result
SELECT 'Final ways_noded count:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;

-- Show the Mesa Trail connections
SELECT 'Mesa Trail connections:' as info, id, source, target, name, app_uuid
FROM carthorse_1754955399973.ways_noded 
WHERE name LIKE '%Mesa%'
ORDER BY id;
