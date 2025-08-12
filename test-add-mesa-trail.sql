-- Test script to manually add the missing Mesa Trail to ways_noded
-- This trail should connect to edge 30 (Mallory Cave Trail) at the west end

-- First, let's check the current state
SELECT 'Current ways_noded count:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;

-- Check if the trail exists in trails table
SELECT 'Mesa Trail in trails table:' as info, id, name, app_uuid, ST_Length(geometry) as length_m 
FROM carthorse_1754955399973.trails 
WHERE app_uuid = 'f9cf58ed-347c-4dc9-ba09-f87904a7d4ed';

-- Check edge 30 details
SELECT 'Edge 30 details:' as info, id, source, target, name, app_uuid, 
       ST_AsText(ST_StartPoint(the_geom)) as start_point, 
       ST_AsText(ST_EndPoint(the_geom)) as end_point
FROM carthorse_1754955399973.ways_noded 
WHERE id = 30;

-- Check the distance between Mesa Trail end and Edge 30 start
SELECT 'Distance between Mesa Trail and Edge 30:' as info,
       ST_Distance(ST_EndPoint(t.geometry), ST_StartPoint(w.the_geom)) as distance_meters
FROM carthorse_1754955399973.trails t, carthorse_1754955399973.ways_noded w 
WHERE t.app_uuid = 'f9cf58ed-347c-4dc9-ba09-f87904a7d4ed' AND w.id = 30;

-- Now let's manually add the Mesa Trail to ways_noded
-- We need to find the next available ID
SELECT 'Next available ID:' as info, COALESCE(MAX(id), 0) + 1 as next_id 
FROM carthorse_1754955399973.ways_noded;

-- Insert the Mesa Trail into ways_noded
INSERT INTO carthorse_1754955399973.ways_noded (id, the_geom, length_km, app_uuid, name, elevation_gain, elevation_loss, old_id, sub_id, source, target)
SELECT 
    32 as id,  -- Next available ID
    ST_Force2D(geometry) as the_geom,
    ST_Length(geometry) / 1000.0 as length_km,
    app_uuid,
    name,
    elevation_gain,
    elevation_loss,
    id as old_id,
    1 as sub_id,
    16 as source,  -- Connect to node 16 (end of edge 30)
    17 as target   -- New target node
FROM carthorse_1754955399973.trails 
WHERE app_uuid = 'f9cf58ed-347c-4dc9-ba09-f87904a7d4ed';

-- Check if the insertion worked
SELECT 'Mesa Trail added to ways_noded:' as info, id, source, target, name, app_uuid
FROM carthorse_1754955399973.ways_noded 
WHERE app_uuid = 'f9cf58ed-347c-4dc9-ba09-f87904a7d4ed';

-- Check the new total count
SELECT 'New ways_noded count:' as info, COUNT(*) as count FROM carthorse_1754955399973.ways_noded;
