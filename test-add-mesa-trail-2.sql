-- Test script to add the second missing Mesa Trail segment
-- This trail should connect to the east end of the first Mesa Trail (edge 32)

-- Check the current state
SELECT 'Current ways_noded count:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;

-- Check if the trail exists in trails table
SELECT 'Mesa Trail 2 in trails table:' as info, id, name, app_uuid, ST_Length(geometry) as length_m 
FROM trails 
WHERE app_uuid = '88ccf267-4ffb-45a5-8dc3-d202eac72975';

-- Check edge 32 details (the Mesa Trail we added earlier)
SELECT 'Edge 32 details:' as info, id, source, target, name, app_uuid, 
       ST_AsText(ST_StartPoint(the_geom)) as start_point, 
       ST_AsText(ST_EndPoint(the_geom)) as end_point
FROM carthorse_1754955399973.ways_noded 
WHERE id = 32;

-- Check the distance between Mesa Trail 2 start and Edge 32 end
SELECT 'Distance between Mesa Trail 2 and Edge 32:' as info,
       ST_Distance(ST_StartPoint(t.geometry), ST_EndPoint(w.the_geom)) as distance_meters
FROM trails t, carthorse_1754955399973.ways_noded w 
WHERE t.app_uuid = '88ccf267-4ffb-45a5-8dc3-d202eac72975' AND w.id = 32;

-- Now let's manually add the Mesa Trail 2 to ways_noded
-- We need to find the next available ID
SELECT 'Next available ID:' as info, COALESCE(MAX(id), 0) + 1 as next_id 
FROM carthorse_1754955399973.ways_noded;

-- Insert the Mesa Trail 2 into ways_noded
INSERT INTO carthorse_1754955399973.ways_noded (id, the_geom, length_km, app_uuid, name, elevation_gain, elevation_loss, old_id, sub_id, source, target)
SELECT 
    33 as id,  -- Next available ID
    ST_Force2D(geometry) as the_geom,
    ST_Length(geometry) / 1000.0 as length_km,
    app_uuid,
    name,
    elevation_gain,
    elevation_loss,
    id as old_id,
    1 as sub_id,
    17 as source,  -- Connect to node 17 (end of edge 32)
    18 as target   -- New target node
FROM trails 
WHERE app_uuid = '88ccf267-4ffb-45a5-8dc3-d202eac72975';

-- Check if the insertion worked
SELECT 'Mesa Trail 2 added to ways_noded:' as info, id, source, target, name, app_uuid
FROM carthorse_1754955399973.ways_noded 
WHERE app_uuid = '88ccf267-4ffb-45a5-8dc3-d202eac72975';

-- Check the new total count
SELECT 'New ways_noded count:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;

-- Show the complete chain: Edge 30 -> Edge 32 -> Edge 33
SELECT 'Complete chain:' as info, id, source, target, name, app_uuid
FROM carthorse_1754955399973.ways_noded 
WHERE id IN (30, 32, 33)
ORDER BY id;
