-- CARTHORSE DATA CLEANUP SCRIPT FOR trail_master_db
-- This script finds and fixes common data issues that violate constraints.
-- Run this before applying new constraints or migrations.

-- 1. Fix invalid trail_type values
UPDATE trails
SET trail_type = 'unknown'
WHERE trail_type NOT IN (
  'hiking', 'biking', 'running', 'walking', 'climbing', 'skiing', 'snowshoeing',
  'horseback', 'motorized', 'mixed', 'unknown'
);
-- Show remaining invalid trail_type values (should be zero)
SELECT id, trail_type FROM trails
WHERE trail_type NOT IN (
  'hiking', 'biking', 'running', 'walking', 'climbing', 'skiing', 'snowshoeing',
  'horseback', 'motorized', 'mixed', 'unknown'
);

-- 2. Fix out-of-range coordinates in trails
UPDATE trails
SET bbox_min_lat = GREATEST(bbox_min_lat, -90),
    bbox_max_lat = LEAST(bbox_max_lat, 90),
    bbox_min_lng = GREATEST(bbox_min_lng, -180),
    bbox_max_lng = LEAST(bbox_max_lng, 180)
WHERE bbox_min_lat < -90 OR bbox_max_lat > 90 OR bbox_min_lng < -180 OR bbox_max_lng > 180;
-- Show remaining out-of-range coordinates (should be zero)
SELECT id, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng FROM trails
WHERE bbox_min_lat < -90 OR bbox_max_lat > 90 OR bbox_min_lng < -180 OR bbox_max_lng > 180;

-- 3. Fix out-of-range coordinates in routing_nodes
UPDATE routing_nodes
SET lat = GREATEST(LEAST(lat, 90), -90),
    lng = GREATEST(LEAST(lng, 180), -180)
WHERE lat < -90 OR lat > 90 OR lng < -180 OR lng > 180;
-- Show remaining out-of-range routing_nodes (should be zero)
SELECT id, lat, lng FROM routing_nodes WHERE lat < -90 OR lat > 90 OR lng < -180 OR lng > 180;

-- 4. Fix invalid elevation values in trails
UPDATE trails
SET elevation_gain = NULLIF(elevation_gain, -9999),
    elevation_loss = NULLIF(elevation_loss, -9999),
    max_elevation = NULLIF(max_elevation, -9999),
    min_elevation = NULLIF(min_elevation, -9999),
    avg_elevation = NULLIF(avg_elevation, -9999)
WHERE elevation_gain = -9999 OR elevation_loss = -9999 OR max_elevation = -9999 OR min_elevation = -9999 OR avg_elevation = -9999;
-- Show remaining invalid elevation values (should be zero)
SELECT id, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation FROM trails
WHERE elevation_gain = -9999 OR elevation_loss = -9999 OR max_elevation = -9999 OR min_elevation = -9999 OR avg_elevation = -9999;

-- 5. Fix invalid elevation values in elevation_points
UPDATE elevation_points
SET elevation = NULL WHERE elevation < -1000 OR elevation > 9000;
-- Show remaining invalid elevation_points (should be zero)
SELECT id, lat, lng, elevation FROM elevation_points WHERE elevation < -1000 OR elevation > 9000;

-- 6. Fix invalid difficulty values in trails
UPDATE trails
SET difficulty = 'unknown'
WHERE difficulty NOT IN ('easy', 'moderate', 'difficult', 'expert', 'unknown');
-- Show remaining invalid difficulty values (should be zero)
SELECT id, difficulty FROM trails WHERE difficulty NOT IN ('easy', 'moderate', 'difficult', 'expert', 'unknown');

-- 7. Summary: count of remaining issues
SELECT COUNT(*) AS invalid_trail_types FROM trails WHERE trail_type NOT IN (
  'hiking', 'biking', 'running', 'walking', 'climbing', 'skiing', 'snowshoeing',
  'horseback', 'motorized', 'mixed', 'unknown'
);
SELECT COUNT(*) AS out_of_range_trails FROM trails WHERE bbox_min_lat < -90 OR bbox_max_lat > 90 OR bbox_min_lng < -180 OR bbox_max_lng > 180;
SELECT COUNT(*) AS out_of_range_nodes FROM routing_nodes WHERE lat < -90 OR lat > 90 OR lng < -180 OR lng > 180;
SELECT COUNT(*) AS invalid_trail_elev FROM trails WHERE elevation_gain = -9999 OR elevation_loss = -9999 OR max_elevation = -9999 OR min_elevation = -9999 OR avg_elevation = -9999;
SELECT COUNT(*) AS invalid_point_elev FROM elevation_points WHERE elevation < -1000 OR elevation > 9000;
SELECT COUNT(*) AS invalid_difficulty FROM trails WHERE difficulty NOT IN ('easy', 'moderate', 'difficult', 'expert', 'unknown'); 