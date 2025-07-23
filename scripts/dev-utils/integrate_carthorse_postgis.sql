-- === CARTHORSE PRODUCTION INTEGRATION SCRIPT ===
-- Ensure you have a backup of trail_master_db before running this!
--
-- This script integrates all schema, constraints, elevation, and spatial function changes
-- into the production PostGIS database. It follows Carthorse safety and validation rules.

-- 0. DROP REDUNDANT INDEXES, FUNCTIONS, AND TRIGGERS (for idempotency)
-- Drop triggers if they exist
DROP TRIGGER IF EXISTS update_trails_updated_at ON trails;
DROP TRIGGER IF EXISTS trigger_validate_trail_completeness ON trails;
DROP TRIGGER IF EXISTS trigger_auto_calculate_bbox ON trails;
DROP TRIGGER IF EXISTS trigger_auto_calculate_length ON trails;
DROP TRIGGER IF EXISTS trigger_validate_routing_edge_consistency ON routing_edges;

-- Drop functions if they exist (with correct signatures)
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS validate_trail_completeness() CASCADE;
DROP FUNCTION IF EXISTS auto_calculate_bbox() CASCADE;
DROP FUNCTION IF EXISTS auto_calculate_length() CASCADE;
DROP FUNCTION IF EXISTS validate_routing_edge_consistency() CASCADE;
DROP FUNCTION IF EXISTS calculate_trail_stats() CASCADE;
DROP FUNCTION IF EXISTS check_database_integrity() CASCADE;

-- Drop views if they exist
DROP VIEW IF EXISTS incomplete_trails;
DROP VIEW IF EXISTS trails_with_2d_geometry;
DROP VIEW IF EXISTS invalid_geometries;
DROP VIEW IF EXISTS inconsistent_elevation_data;

-- Drop indexes if they exist (before recreating)
DROP INDEX IF EXISTS idx_trails_app_uuid;
DROP INDEX IF EXISTS idx_trails_osm_id;
DROP INDEX IF EXISTS idx_trails_region;
DROP INDEX IF EXISTS idx_trails_bbox;
DROP INDEX IF EXISTS idx_trails_geom;
DROP INDEX IF EXISTS idx_trails_elevation;
DROP INDEX IF EXISTS idx_trails_surface;
DROP INDEX IF EXISTS idx_trails_type;
DROP INDEX IF EXISTS idx_trails_bbox_spatial;
DROP INDEX IF EXISTS idx_trails_bbox_coords;
DROP INDEX IF EXISTS idx_trails_region_bbox;
DROP INDEX IF EXISTS idx_trails_region_elevation;
DROP INDEX IF EXISTS idx_elevation_points_location;
DROP INDEX IF EXISTS idx_elevation_points_elevation;
DROP INDEX IF EXISTS idx_elevation_points_spatial;
DROP INDEX IF EXISTS idx_routing_nodes_location;
DROP INDEX IF EXISTS idx_routing_nodes_type;
DROP INDEX IF EXISTS idx_routing_nodes_coords;
DROP INDEX IF EXISTS idx_routing_nodes_spatial;
DROP INDEX IF EXISTS idx_routing_edges_trail;
DROP INDEX IF EXISTS idx_routing_edges_nodes;
DROP INDEX IF EXISTS idx_routing_edges_geometry;
DROP INDEX IF EXISTS idx_routing_edges_distance;
DROP INDEX IF EXISTS idx_routing_edges_elevation;
DROP INDEX IF EXISTS idx_trails_geom_spatial;
DROP INDEX IF EXISTS idx_routing_nodes_geometry_spatial;
DROP INDEX IF EXISTS idx_routing_edges_geometry_spatial;
DROP INDEX IF EXISTS idx_trails_geometry_gist;
DROP INDEX IF EXISTS idx_routing_nodes_geometry_gist;
DROP INDEX IF EXISTS idx_routing_edges_geometry_gist;
DROP INDEX IF EXISTS idx_trails_completeness_check;
DROP INDEX IF EXISTS idx_trails_3d_geometry;
DROP INDEX IF EXISTS idx_trails_bbox_validation;

-- 0.1. DATA CLEANUP: Fix negative elevation_loss values before constraints
UPDATE trails SET elevation_loss = ABS(elevation_loss) WHERE elevation_loss < 0;

-- 1. SCHEMA AND TABLE DEFINITIONS
\i 'sql/carthorse-postgres-schema.sql'

-- 2. CONSTRAINTS AND DATA INTEGRITY
-- NOTE: Ensure all constraints reference the 'geometry' column, not 'geom'.
-- Add DROP CONSTRAINT IF EXISTS before each ADD CONSTRAINT for idempotency.
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_elevation_gain_positive;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_elevation_loss_positive;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_max_elevation_valid;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_min_elevation_valid;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_avg_elevation_range;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_elevation_order;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_valid_geometry;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_3d_geometry;
ALTER TABLE trails DROP CONSTRAINT IF EXISTS trails_min_points;
-- (Add more DROP CONSTRAINTs as needed for other tables/fields)
\i 'sql/carthorse-postgres-constraints.sql'

-- 3. ELEVATION CONSTRAINTS
\i 'sql/add-basic-elevation-constraints.sql'

-- 4. POSTGIS INTERSECTION AND ROUTING FUNCTIONS
\i 'sql/carthorse-postgis-intersection-functions.sql'

-- 5. (OPTIONAL) REINDEX FOR PERFORMANCE (uncomment if needed)
-- REINDEX TABLE trails;
-- REINDEX TABLE routing_nodes;
-- REINDEX TABLE routing_edges;

-- 6. VALIDATION (run these after integration)
-- SELECT * FROM get_intersection_stats('public');
-- SELECT * FROM validate_intersection_detection('public');
-- SELECT * FROM validate_spatial_data_integrity('public');
-- SELECT * FROM check_database_integrity(); 