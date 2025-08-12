-- Fix for vertex assignment issue in PostgisNodeStrategy
-- The problem is that edges are being filtered out if they can't find nearby vertices
-- This ensures all trail endpoints get vertices and edges are properly connected

-- First, let's check the current state of the ways_noded table
SELECT 'Current ways_noded count:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;

-- Check for edges without source/target assignments
SELECT 'Edges without source/target:' as info, COUNT(*) as count 
FROM carthorse_1754955399973.ways_noded 
WHERE source IS NULL OR target IS NULL;

-- Check the vertex assignment tolerance being used
-- The issue is likely that the tolerance is too small (1 meter by default)
-- Let's increase the tolerance to match our 50-meter pgRouting tolerance

-- Update the vertex assignment with a more generous tolerance (50 meters)
UPDATE carthorse_1754955399973.ways_noded wn
SET source = (
    SELECT v.id
    FROM carthorse_1754955399973.ways_noded_vertices_pgr v
    WHERE ST_DWithin(v.the_geom, ST_StartPoint(wn.the_geom), 0.0005)  -- 50 meter tolerance
    ORDER BY ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) ASC
    LIMIT 1
),
target = (
    SELECT v.id
    FROM carthorse_1754955399973.ways_noded_vertices_pgr v
    WHERE ST_DWithin(v.the_geom, ST_EndPoint(wn.the_geom), 0.0005)  -- 50 meter tolerance
    ORDER BY ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) ASC
    LIMIT 1
)
WHERE source IS NULL OR target IS NULL;

-- Check the results
SELECT 'Edges after fix:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;

SELECT 'Edges still without source/target:' as info, COUNT(*) as count 
FROM carthorse_1754955399973.ways_noded 
WHERE source IS NULL OR target IS NULL;

-- Show the Mesa Trail edges specifically
SELECT 'Mesa Trail edges:' as info, id, source, target, name, app_uuid
FROM carthorse_1754955399973.ways_noded 
WHERE name LIKE '%Mesa%'
ORDER BY id;


