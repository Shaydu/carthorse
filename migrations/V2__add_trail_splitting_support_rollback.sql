-- Migration V2 Rollback: Remove Trail Splitting Support
-- Reverts schema from v2 back to v1 by removing trail splitting tables and constraints

-- =====================================================
-- REMOVE FOREIGN KEY CONSTRAINTS
-- =====================================================
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS fk_split_trails_original_trail;

-- =====================================================
-- REMOVE CHECK CONSTRAINTS
-- =====================================================

-- Split trails constraints
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS chk_split_trails_segment_number_positive;
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS chk_split_trails_elevation_gain_non_negative;
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS chk_split_trails_elevation_loss_non_negative;
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS chk_split_trails_elevation_order;
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS chk_split_trails_valid_geometry;
ALTER TABLE split_trails DROP CONSTRAINT IF EXISTS chk_split_trails_min_points;

-- Intersection points constraints
ALTER TABLE intersection_points DROP CONSTRAINT IF EXISTS chk_intersection_points_valid_point;
ALTER TABLE intersection_points DROP CONSTRAINT IF EXISTS chk_intersection_points_valid_point_3d;
ALTER TABLE intersection_points DROP CONSTRAINT IF EXISTS chk_intersection_points_node_type_valid;
ALTER TABLE intersection_points DROP CONSTRAINT IF EXISTS chk_intersection_points_distance_positive;

-- Trail hashes constraints
ALTER TABLE trail_hashes DROP CONSTRAINT IF EXISTS chk_trail_hashes_hash_not_empty;

-- =====================================================
-- DROP INDEXES
-- =====================================================

-- Split trails indexes
DROP INDEX IF EXISTS idx_split_trails_original_trail_id;
DROP INDEX IF EXISTS idx_split_trails_segment_number;
DROP INDEX IF EXISTS idx_split_trails_app_uuid;
DROP INDEX IF EXISTS idx_split_trails_geometry;
DROP INDEX IF EXISTS idx_split_trails_bbox;

-- Intersection points indexes
DROP INDEX IF EXISTS idx_intersection_points_point;
DROP INDEX IF EXISTS idx_intersection_points_point_3d;
DROP INDEX IF EXISTS idx_intersection_points_node_type;

-- Trail hashes indexes
DROP INDEX IF EXISTS idx_trail_hashes_app_uuid;
DROP INDEX IF EXISTS idx_trail_hashes_geometry_hash;

-- =====================================================
-- DROP TABLES
-- =====================================================
DROP TABLE IF EXISTS split_trails CASCADE;
DROP TABLE IF EXISTS intersection_points CASCADE;
DROP TABLE IF EXISTS trail_hashes CASCADE;

-- =====================================================
-- UPDATE SCHEMA VERSION BACK TO V1
-- =====================================================
DELETE FROM schema_version WHERE version = 'v2';
INSERT INTO schema_version (version) VALUES ('v1'); 