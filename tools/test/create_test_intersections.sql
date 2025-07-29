-- Create test trails with Y, T, and X intersections
-- Clear existing test data first
DELETE FROM routing_nodes;
DELETE FROM routing_edges;
DELETE FROM intersection_points;
DELETE FROM trails WHERE name LIKE 'TEST_%';

-- Y Intersection Test (3 trails meeting at one point)
INSERT INTO trails (app_uuid, name, region, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-y-1', 'TEST_Y_TRAIL_1', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.29 39.99 1800, -105.285 39.985 1800)', 4326)),
('test-y-2', 'TEST_Y_TRAIL_2', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.285 39.985 1800, -105.28 39.99 1800)', 4326)),
('test-y-3', 'TEST_Y_TRAIL_3', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.285 39.985 1800, -105.29 39.98 1800)', 4326));

-- T Intersection Test (2 trails, one crossing the other)
INSERT INTO trails (app_uuid, name, region, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-t-1', 'TEST_T_TRAIL_1', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.28 39.98 1800, -105.275 39.98 1800)', 4326)),
('test-t-2', 'TEST_T_TRAIL_2', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.2775 39.975 1800, -105.2775 39.985 1800)', 4326));

-- X Intersection Test (2 trails crossing each other)
INSERT INTO trails (app_uuid, name, region, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-x-1', 'TEST_X_TRAIL_1', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.27 39.98 1800, -105.265 39.98 1800)', 4326)),
('test-x-2', 'TEST_X_TRAIL_2', 'boulder', 'hiking', 'dirt', 'easy', 0.5, 10.0, 5.0, 1805.0, 1800.0, 1802.5,
 ST_GeomFromText('LINESTRINGZ(-105.2675 39.975 1800, -105.2675 39.985 1800)', 4326));

-- Update bbox values for the new trails
UPDATE trails SET 
  bbox_min_lng = ST_XMin(geometry),
  bbox_max_lng = ST_XMax(geometry),
  bbox_min_lat = ST_YMin(geometry),
  bbox_max_lat = ST_YMax(geometry)
WHERE name LIKE 'TEST_%'; 