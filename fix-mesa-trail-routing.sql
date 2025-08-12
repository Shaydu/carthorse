-- Fix Mesa Trail routing by copying the missing trail and fixing connections

-- Step 1: Copy the specific Mesa Trail segment to staging
INSERT INTO staging_boulder_1754918168168.trails (
    id, name, app_uuid, region, osm_id, trail_type, surface, difficulty, 
    length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, 
    avg_elevation, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, 
    created_at, updated_at, geometry
)
SELECT 
    id, name, app_uuid, region, osm_id, trail_type, surface_type as surface, difficulty,
    length_km, elevation_gain, elevation_loss, max_elevation, min_elevation,
    avg_elevation, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
    created_at, updated_at, geometry
FROM public.trails 
WHERE app_uuid = '88ccf267-4ffb-45a5-8dc3-d202eac72975';

-- Step 2: Check what we copied
SELECT 'Copied Mesa Trail:' as info, COUNT(*) as count FROM staging_boulder_1754918168168.trails WHERE app_uuid = '88ccf267-4ffb-45a5-8dc3-d202eac72975';

-- Step 3: Clear existing routing data
DELETE FROM staging_boulder_1754918168168.routing_nodes;
DELETE FROM staging_boulder_1754918168168.routing_edges;

-- Step 4: Generate routing nodes with more generous tolerance (50 meters)
SELECT generate_routing_nodes_native('staging_boulder_1754918168168', 50.0);

-- Step 5: Generate routing edges with more generous tolerance (50 meters)
SELECT generate_routing_edges_native('staging_boulder_1754918168168', 50.0);

-- Step 6: Check the results
SELECT 'Routing nodes created:' as info, COUNT(*) as count FROM staging_boulder_1754918168168.routing_nodes;
SELECT 'Routing edges created:' as info, COUNT(*) as count FROM staging_boulder_1754918168168.routing_edges;

-- Step 7: Check specifically for Mesa Trail edges
SELECT 'Mesa Trail edges:' as info, id, source, target, trail_name, trail_id
FROM staging_boulder_1754918168168.routing_edges 
WHERE trail_name LIKE '%Mesa%'
ORDER BY id;

-- Step 8: Check for edges without source/target (orphaned edges)
SELECT 'Orphaned edges:' as info, COUNT(*) as count 
FROM staging_boulder_1754918168168.routing_edges 
WHERE source IS NULL OR target IS NULL;
