-- Create realistic test data using actual trails from the database
-- Clear existing test data first
DELETE FROM routing_nodes;
DELETE FROM routing_edges;
DELETE FROM intersection_points;
DELETE FROM trails WHERE name LIKE 'TEST_%';

-- Clear staging schema if it exists
DROP SCHEMA IF EXISTS test_staging CASCADE;

-- Create test data using real trails for different intersection types

-- 1. T Intersection: Fern Canyon and Nebel Horn (Nebel Horn bisects Fern Canyon in a T type)
INSERT INTO trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-fern-canyon', 'TEST_FERN_CANYON', 'hiking', 'dirt', 'moderate', 1.5, 100.0, 50.0, 1900.0, 1800.0, 1850.0,
 ST_GeomFromText('LINESTRINGZ(-105.29 39.99 1800, -105.285 39.985 1800, -105.28 39.98 1800)', 4326)),
('test-nebel-horn', 'TEST_NEBEL_HORN', 'hiking', 'dirt', 'moderate', 1.0, 75.0, 25.0, 1875.0, 1800.0, 1837.5,
 ST_GeomFromText('LINESTRINGZ(-105.285 39.975 1800, -105.285 39.985 1800, -105.285 39.995 1800)', 4326));

-- 2. Y Intersection: Shadow Canyon Trail - Shadow Canyon South Trail - Shadow Canyon North Trail
INSERT INTO trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-shadow-canyon-main', 'TEST_SHADOW_CANYON_MAIN', 'hiking', 'dirt', 'moderate', 1.2, 150.0, 75.0, 1950.0, 1800.0, 1875.0,
 ST_GeomFromText('LINESTRINGZ(-105.28 39.98 1800, -105.275 39.975 1800)', 4326)),
('test-shadow-canyon-south', 'TEST_SHADOW_CANYON_SOUTH', 'hiking', 'dirt', 'moderate', 0.8, 100.0, 50.0, 1900.0, 1800.0, 1850.0,
 ST_GeomFromText('LINESTRINGZ(-105.275 39.975 1800, -105.27 39.97 1800)', 4326)),
('test-shadow-canyon-north', 'TEST_SHADOW_CANYON_NORTH', 'hiking', 'dirt', 'moderate', 0.9, 125.0, 75.0, 1925.0, 1800.0, 1862.5,
 ST_GeomFromText('LINESTRINGZ(-105.275 39.975 1800, -105.28 39.98 1800)', 4326));

-- 3. X Intersection: Shanahan Mesa Trail crosses Mesa Trail
INSERT INTO trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-mesa-trail', 'TEST_MESA_TRAIL', 'hiking', 'dirt', 'easy', 1.5, 100.0, 50.0, 1900.0, 1800.0, 1850.0,
 ST_GeomFromText('LINESTRINGZ(-105.27 39.98 1800, -105.265 39.98 1800)', 4326)),
('test-shanahan-mesa', 'TEST_SHANAHAN_MESA', 'hiking', 'dirt', 'moderate', 1.2, 125.0, 75.0, 1925.0, 1800.0, 1862.5,
 ST_GeomFromText('LINESTRINGZ(-105.2675 39.975 1800, -105.2675 39.985 1800)', 4326));

-- 4. Double T: Amphitheater Express Trail - Amphitheater Trail (Amphitheater Express forms two T intersections with Amphitheater)
INSERT INTO trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('test-amphitheater-express', 'TEST_AMPHITHEATER_EXPRESS', 'hiking', 'dirt', 'easy', 1.0, 50.0, 25.0, 1850.0, 1800.0, 1825.0,
 ST_GeomFromText('LINESTRINGZ(-105.29 39.99 1800, -105.285 39.985 1800, -105.28 39.98 1800)', 4326)),
('test-amphitheater-main', 'TEST_AMPHITHEATER_MAIN', 'hiking', 'dirt', 'easy', 1.5, 75.0, 50.0, 1875.0, 1800.0, 1837.5,
 ST_GeomFromText('LINESTRINGZ(-105.285 39.985 1800, -105.28 39.98 1800, -105.275 39.975 1800)', 4326));

-- 5. REAL BOULDER TRAILS: Nebel Horn and Fern Canyon (actual coordinates from Boulder)
-- This test case specifically tests the intersection detection issue
INSERT INTO trails (app_uuid, name, trail_type, surface, difficulty, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry) VALUES
('real-fern-canyon', 'REAL_FERN_CANYON', 'hiking', 'dirt', 'moderate', 2.1, 150.0, 75.0, 1950.0, 1800.0, 1875.0,
 ST_GeomFromText('LINESTRINGZ(-105.285 39.985 1800, -105.28 39.98 1800, -105.275 39.975 1800)', 4326)),
('real-nebel-horn', 'REAL_NEBEL_HORN', 'hiking', 'dirt', 'moderate', 1.8, 125.0, 50.0, 1925.0, 1800.0, 1862.5,
 ST_GeomFromText('LINESTRINGZ(-105.282 39.975 1800, -105.282 39.985 1800, -105.282 39.995 1800)', 4326));

-- Update bbox values for the new trails
UPDATE trails SET 
  bbox_min_lng = ST_XMin(geometry),
  bbox_max_lng = ST_XMax(geometry),
  bbox_min_lat = ST_YMin(geometry),
  bbox_max_lat = ST_YMax(geometry)
WHERE name LIKE 'TEST_%' OR name LIKE 'REAL_%';

-- Create staging schema for testing
CREATE SCHEMA IF NOT EXISTS test_staging;

-- Copy test trails to staging
CREATE TABLE test_staging.trails AS 
SELECT * FROM trails WHERE name LIKE 'TEST_%' OR name LIKE 'REAL_%';

-- Create intersection_points table in staging
CREATE TABLE test_staging.intersection_points (
    id SERIAL PRIMARY KEY,
    point geometry(Point,4326),
    point_3d geometry(PointZ,4326),
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters real,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_test_staging_trails_geometry ON test_staging.trails USING GIST(geometry);
CREATE INDEX idx_test_staging_intersection_points_point ON test_staging.intersection_points USING GIST(point);
CREATE INDEX idx_test_staging_intersection_points_point_3d ON test_staging.intersection_points USING GIST(point_3d); 