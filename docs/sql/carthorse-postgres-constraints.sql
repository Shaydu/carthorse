-- PostgreSQL Master Database Constraints
-- This file adds comprehensive constraints to ensure data integrity

-- Enable PostGIS extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- TRAILS TABLE CONSTRAINTS
-- ============================================================================

-- Add NOT NULL constraints for required fields
ALTER TABLE trails 
  ALTER COLUMN app_uuid SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN geometry SET NOT NULL,
  ALTER COLUMN region SET NOT NULL;

-- Add CHECK constraints for data validation
ALTER TABLE trails 
  ADD CONSTRAINT chk_trails_length_positive 
    CHECK (length_km IS NULL OR length_km > 0),
  
  ADD CONSTRAINT chk_trails_elevation_gain_non_negative 
    CHECK (elevation_gain IS NULL OR elevation_gain >= 0),
  
  ADD CONSTRAINT chk_trails_elevation_loss_non_negative 
    CHECK (elevation_loss IS NULL OR elevation_loss >= 0),
  
  ADD CONSTRAINT chk_trails_max_elevation_valid 
    CHECK (max_elevation IS NULL OR max_elevation >= -1000),
  
  ADD CONSTRAINT chk_trails_min_elevation_valid 
    CHECK (min_elevation IS NULL OR min_elevation >= -1000),
  
  ADD CONSTRAINT chk_trails_avg_elevation_valid 
    CHECK (avg_elevation IS NULL OR avg_elevation >= -1000),
  
  ADD CONSTRAINT chk_trails_bbox_valid 
    CHECK (
      (bbox_min_lng IS NULL AND bbox_max_lng IS NULL AND bbox_min_lat IS NULL AND bbox_max_lat IS NULL) OR
      (bbox_min_lng IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lat IS NOT NULL AND
       bbox_min_lng <= bbox_max_lng AND bbox_min_lat <= bbox_max_lat)
    ),
  
  ADD CONSTRAINT chk_trails_elevation_consistency 
    CHECK (
      (max_elevation IS NULL AND min_elevation IS NULL AND avg_elevation IS NULL) OR
      (max_elevation IS NOT NULL AND min_elevation IS NOT NULL AND avg_elevation IS NOT NULL AND
       max_elevation >= min_elevation AND avg_elevation BETWEEN min_elevation AND max_elevation)
    ),
  
  ADD CONSTRAINT chk_trails_geometry_3d 
    CHECK (
      geometry IS NULL OR 
      (ST_NDims(geom) = 3 AND ST_GeometryType(geom) = 'ST_LineString')
    ),
  
  ADD CONSTRAINT chk_trails_geometry_valid 
    CHECK (geometry IS NULL OR ST_IsValid(geometry)),
  
  ADD CONSTRAINT chk_trails_geometry_min_points 
    CHECK (geometry IS NULL OR ST_NPoints(geometry) >= 2),
  
  ADD CONSTRAINT chk_trails_surface_valid 
    CHECK (surface IS NULL OR surface IN (
      'dirt', 'gravel', 'paved', 'concrete', 'asphalt', 'wood', 'metal', 'stone', 
      'grass', 'sand', 'mud', 'snow', 'ice', 'unknown'
    )),
  
  ADD CONSTRAINT chk_trails_type_valid 
    CHECK (trail_type IS NULL OR trail_type IN (
      'hiking', 'biking', 'running', 'walking', 'climbing', 'skiing', 'snowshoeing',
      'horseback', 'motorized', 'mixed', 'unknown'
    )),
  
  ADD CONSTRAINT chk_trails_difficulty_valid 
    CHECK (difficulty IS NULL OR difficulty IN (
      'easy', 'moderate', 'difficult', 'expert', 'unknown'
    )),
  
  ADD CONSTRAINT chk_trails_region_valid 
    CHECK (region IN ('boulder', 'seattle', 'test'));

-- Add unique constraints
ALTER TABLE trails 
  ADD CONSTRAINT uk_trails_app_uuid UNIQUE (app_uuid),
  ADD CONSTRAINT uk_trails_osm_id UNIQUE (osm_id);

-- ============================================================================
-- ELEVATION POINTS TABLE CONSTRAINTS
-- ============================================================================

-- Add NOT NULL constraints
ALTER TABLE elevation_points 
  ALTER COLUMN lat SET NOT NULL,
  ALTER COLUMN lng SET NOT NULL,
  ALTER COLUMN elevation SET NOT NULL;

-- Add CHECK constraints for coordinate and elevation validation
ALTER TABLE elevation_points 
  ADD CONSTRAINT chk_elevation_points_lat_range 
    CHECK (lat >= -90 AND lat <= 90),
  
  ADD CONSTRAINT chk_elevation_points_lng_range 
    CHECK (lng >= -180 AND lng <= 180),
  
  ADD CONSTRAINT chk_elevation_points_elevation_range 
    CHECK (elevation >= -1000 AND elevation <= 9000);

-- ============================================================================
-- ROUTING NODES TABLE CONSTRAINTS
-- ============================================================================

-- Add NOT NULL constraints
ALTER TABLE routing_nodes 
  ALTER COLUMN node_id SET NOT NULL,
  ALTER COLUMN lat SET NOT NULL,
  ALTER COLUMN lng SET NOT NULL;

-- Add CHECK constraints
ALTER TABLE routing_nodes 
  ADD CONSTRAINT chk_routing_nodes_lat_range 
    CHECK (lat >= -90 AND lat <= 90),
  
  ADD CONSTRAINT chk_routing_nodes_lng_range 
    CHECK (lng >= -180 AND lng <= 180),
  
  ADD CONSTRAINT chk_routing_nodes_type_valid 
    CHECK (node_type IN ('intersection', 'endpoint', 'trailhead')),
  
  ADD CONSTRAINT chk_routing_nodes_geometry_valid 
    CHECK (geometry IS NULL OR ST_IsValid(geometry)),
  
  ADD CONSTRAINT chk_routing_nodes_geometry_2d 
    CHECK (geometry IS NULL OR ST_NDims(geometry) = 2);

-- Add unique constraints
ALTER TABLE routing_nodes 
  ADD CONSTRAINT uk_routing_nodes_node_id UNIQUE (node_id);

-- ============================================================================
-- ROUTING EDGES TABLE CONSTRAINTS
-- ============================================================================

-- Add NOT NULL constraints
ALTER TABLE routing_edges 
  ALTER COLUMN from_node_id SET NOT NULL,
  ALTER COLUMN to_node_id SET NOT NULL,
  ALTER COLUMN trail_id SET NOT NULL,
  ALTER COLUMN trail_name SET NOT NULL,
  ALTER COLUMN distance_km SET NOT NULL;

-- Add CHECK constraints
ALTER TABLE routing_edges 
  ADD CONSTRAINT chk_routing_edges_distance_positive 
    CHECK (distance_km > 0),
  
  ADD CONSTRAINT chk_routing_edges_elevation_gain_non_negative 
    CHECK (elevation_gain >= 0),
  
  ADD CONSTRAINT chk_routing_edges_elevation_loss_non_negative 
    CHECK (elevation_loss >= 0),
  
  ADD CONSTRAINT chk_routing_edges_different_nodes 
    CHECK (from_node_id != to_node_id),
  
  ADD CONSTRAINT chk_routing_edges_geometry_valid 
    CHECK (geometry IS NULL OR ST_IsValid(geometry)),
  
  ADD CONSTRAINT chk_routing_edges_geometry_2d 
    CHECK (geometry IS NULL OR ST_NDims(geometry) = 2);

-- ============================================================================
-- ROUTE RECOMMENDATIONS TABLE CONSTRAINTS
-- ============================================================================

-- Add CHECK constraints
ALTER TABLE route_recommendations 
  ADD CONSTRAINT chk_route_recommendations_distance_positive 
    CHECK (gpx_distance_km IS NULL OR gpx_distance_km > 0),
  
  ADD CONSTRAINT chk_route_recommendations_elevation_gain_non_negative 
    CHECK (gpx_elevation_gain IS NULL OR gpx_elevation_gain >= 0),
  
  ADD CONSTRAINT chk_route_recommendations_similarity_score_range 
    CHECK (similarity_score IS NULL OR (similarity_score >= 0 AND similarity_score <= 1)),
  
  ADD CONSTRAINT chk_route_recommendations_route_type_valid 
    CHECK (route_type IS NULL OR route_type IN (
      'exact_match', 'similar_distance', 'similar_elevation', 'similar_profile', 'custom'
    ));

-- ============================================================================
-- FOREIGN KEY CONSTRAINTS
-- ============================================================================

-- Add foreign key constraints for routing edges
ALTER TABLE routing_edges 
  ADD CONSTRAINT fk_routing_edges_from_node 
    FOREIGN KEY (from_node_id) REFERENCES routing_nodes(id) ON DELETE CASCADE,
  
  ADD CONSTRAINT fk_routing_edges_to_node 
    FOREIGN KEY (to_node_id) REFERENCES routing_nodes(id) ON DELETE CASCADE;

-- ============================================================================
-- TRIGGERS FOR DATA INTEGRITY
-- ============================================================================

-- Function to validate trail data completeness
CREATE OR REPLACE FUNCTION validate_trail_completeness()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure complete trails have all required elevation data
  IF NEW.geometry IS NOT NULL AND 
     (NEW.elevation_gain IS NULL OR NEW.max_elevation IS NULL OR 
      NEW.min_elevation IS NULL OR NEW.avg_elevation IS NULL) THEN
    RAISE EXCEPTION 'Complete trails must have all elevation data (elevation_gain, max_elevation, min_elevation, avg_elevation)';
  END IF;
  
  -- Ensure 3D geometry has elevation data
  IF NEW.geometry IS NOT NULL AND ST_NDims(NEW.geometry) = 3 AND 
     (NEW.elevation_gain IS NULL OR NEW.elevation_gain = 0) THEN
    RAISE EXCEPTION '3D geometry must have valid elevation_gain data';
  END IF;
  
  -- Ensure bbox is calculated if geometry exists
  IF NEW.geometry IS NOT NULL AND 
     (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
      NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
    RAISE EXCEPTION 'Trails with geometry must have calculated bounding box';
  END IF;
  
  -- Ensure length is calculated if geometry exists
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    RAISE EXCEPTION 'Trails with geometry must have calculated length_km';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate trail data completeness
CREATE TRIGGER trigger_validate_trail_completeness
  BEFORE INSERT OR UPDATE ON trails
  FOR EACH ROW
  EXECUTE FUNCTION validate_trail_completeness();

-- Function to auto-calculate bbox from geometry
CREATE OR REPLACE FUNCTION auto_calculate_bbox()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.geometry IS NOT NULL AND 
     (NEW.bbox_min_lng IS NULL OR NEW.bbox_max_lng IS NULL OR 
      NEW.bbox_min_lat IS NULL OR NEW.bbox_max_lat IS NULL) THEN
    
    NEW.bbox_min_lng := ST_XMin(NEW.geometry);
    NEW.bbox_max_lng := ST_XMax(NEW.geometry);
    NEW.bbox_min_lat := ST_YMin(NEW.geometry);
    NEW.bbox_max_lat := ST_YMax(NEW.geometry);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate bbox
CREATE TRIGGER trigger_auto_calculate_bbox
  BEFORE INSERT OR UPDATE ON trails
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_bbox();

-- Function to auto-calculate length from geometry
CREATE OR REPLACE FUNCTION auto_calculate_length()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    NEW.length_km := ST_Length(NEW.geometry, true) / 1000.0; -- Convert meters to kilometers
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate length
CREATE TRIGGER trigger_auto_calculate_length
  BEFORE INSERT OR UPDATE ON trails
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_length();

-- Function to validate routing edge consistency
CREATE OR REPLACE FUNCTION validate_routing_edge_consistency()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure trail_id references a valid trail
  IF NOT EXISTS (SELECT 1 FROM trails WHERE app_uuid = NEW.trail_id) THEN
    RAISE EXCEPTION 'trail_id must reference a valid trail in trails table';
  END IF;
  
  -- Ensure nodes exist
  IF NOT EXISTS (SELECT 1 FROM routing_nodes WHERE id = NEW.from_node_id) THEN
    RAISE EXCEPTION 'from_node_id must reference a valid node in routing_nodes table';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM routing_nodes WHERE id = NEW.to_node_id) THEN
    RAISE EXCEPTION 'to_node_id must reference a valid node in routing_nodes table';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate routing edge consistency
CREATE TRIGGER trigger_validate_routing_edge_consistency
  BEFORE INSERT OR UPDATE ON routing_edges
  FOR EACH ROW
  EXECUTE FUNCTION validate_routing_edge_consistency();

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Create additional indexes for constraint enforcement
CREATE INDEX IF NOT EXISTS idx_trails_completeness_check 
  ON trails (elevation_gain, max_elevation, min_elevation, avg_elevation) 
  WHERE elevation_gain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trails_3d_geometry 
  ON trails USING GIST (geometry) 
  WHERE ST_NDims(geometry) = 3;

CREATE INDEX IF NOT EXISTS idx_trails_bbox_validation 
  ON trails (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat) 
  WHERE bbox_min_lng IS NOT NULL;

-- ============================================================================
-- VIEWS FOR DATA INTEGRITY MONITORING
-- ============================================================================

-- View to identify incomplete trails
CREATE OR REPLACE VIEW incomplete_trails AS
SELECT 
  id,
  app_uuid,
  name,
  region,
  CASE 
    WHEN geometry IS NULL THEN 'Missing geometry'
    WHEN elevation_gain IS NULL THEN 'Missing elevation_gain'
    WHEN max_elevation IS NULL THEN 'Missing max_elevation'
    WHEN min_elevation IS NULL THEN 'Missing min_elevation'
    WHEN avg_elevation IS NULL THEN 'Missing avg_elevation'
    WHEN length_km IS NULL OR length_km <= 0 THEN 'Missing or invalid length'
    WHEN bbox_min_lng IS NULL THEN 'Missing bbox'
    ELSE 'Other'
  END as missing_data
FROM trails
WHERE geometry IS NULL 
   OR elevation_gain IS NULL 
   OR max_elevation IS NULL 
   OR min_elevation IS NULL 
   OR avg_elevation IS NULL
   OR length_km IS NULL 
   OR length_km <= 0
   OR bbox_min_lng IS NULL;

-- View to identify trails with 2D geometry (should be 3D)
CREATE OR REPLACE VIEW trails_with_2d_geometry AS
SELECT 
  id,
  app_uuid,
  name,
  region,
  ST_NDims(geometry) as dimensions,
  ST_GeometryType(geometry) as geometry_type
FROM trails
WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 2;

-- View to identify invalid geometries
CREATE OR REPLACE VIEW invalid_geometries AS
SELECT 
  id,
  app_uuid,
  name,
  region,
  ST_IsValidReason(geometry) as validity_reason
FROM trails
WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry);

-- View to identify trails with inconsistent elevation data
CREATE OR REPLACE VIEW inconsistent_elevation_data AS
SELECT 
  id,
  app_uuid,
  name,
  region,
  max_elevation,
  min_elevation,
  avg_elevation,
  elevation_gain,
  CASE 
    WHEN max_elevation < min_elevation THEN 'max_elevation < min_elevation'
    WHEN avg_elevation < min_elevation THEN 'avg_elevation < min_elevation'
    WHEN avg_elevation > max_elevation THEN 'avg_elevation > max_elevation'
    ELSE 'Other'
  END as inconsistency_type
FROM trails
WHERE max_elevation IS NOT NULL 
  AND min_elevation IS NOT NULL 
  AND avg_elevation IS NOT NULL
  AND (max_elevation < min_elevation 
       OR avg_elevation < min_elevation 
       OR avg_elevation > max_elevation);

-- ============================================================================
-- FUNCTIONS FOR DATA INTEGRITY CHECKS
-- ============================================================================

-- Function to check overall database integrity
CREATE OR REPLACE FUNCTION check_database_integrity()
RETURNS TABLE (
  check_name TEXT,
  status TEXT,
  count BIGINT,
  details TEXT
) AS $$
BEGIN
  -- Check incomplete trails
  RETURN QUERY
  SELECT 
    'Incomplete Trails'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails missing required data'::TEXT
  FROM incomplete_trails;
  
  -- Check 2D geometries
  RETURN QUERY
  SELECT 
    '2D Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END::TEXT,
    COUNT(*),
    'Trails with 2D geometry (should be 3D)'::TEXT
  FROM trails_with_2d_geometry;
  
  -- Check invalid geometries
  RETURN QUERY
  SELECT 
    'Invalid Geometries'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with invalid geometry'::TEXT
  FROM invalid_geometries;
  
  -- Check inconsistent elevation data
  RETURN QUERY
  SELECT 
    'Inconsistent Elevation'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Trails with inconsistent elevation data'::TEXT
  FROM inconsistent_elevation_data;
  
  -- Check orphaned routing edges
  RETURN QUERY
  SELECT 
    'Orphaned Routing Edges'::TEXT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
    COUNT(*),
    'Routing edges referencing non-existent trails'::TEXT
  FROM routing_edges re
  WHERE NOT EXISTS (SELECT 1 FROM trails t WHERE t.app_uuid = re.trail_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE trails IS 'Master trails table with 3D geometry and elevation data';
COMMENT ON COLUMN trails.geometry IS '3D LineString geometry with elevation data (SRID: 4326)';
COMMENT ON COLUMN trails.elevation_gain IS 'Total elevation gain in meters (must be >= 0)';
COMMENT ON COLUMN trails.elevation_loss IS 'Total elevation loss in meters (must be >= 0)';
COMMENT ON COLUMN trails.length_km IS 'Trail length in kilometers (must be > 0)';

COMMENT ON TABLE elevation_points IS 'Elevation data points from TIFF files';
COMMENT ON TABLE routing_nodes IS 'Intersection and endpoint nodes for routing';
COMMENT ON TABLE routing_edges IS 'Trail segments connecting routing nodes';
COMMENT ON TABLE route_recommendations IS 'GPX-based route recommendations';

COMMENT ON FUNCTION validate_trail_completeness() IS 'Ensures complete trails have all required elevation and geometry data';
COMMENT ON FUNCTION auto_calculate_bbox() IS 'Automatically calculates bounding box from geometry';
COMMENT ON FUNCTION auto_calculate_length() IS 'Automatically calculates trail length from geometry';
COMMENT ON FUNCTION check_database_integrity() IS 'Comprehensive database integrity check'; 

CREATE OR REPLACE FUNCTION public.build_routing_edges(
    staging_schema text,
    trails_table text,
    edge_tolerance double precision DEFAULT 20.0
) RETURNS integer AS $$
DECLARE
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    dyn_sql := format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss)
         WITH trail_segments AS (
             SELECT 
                 id,
                 app_uuid,
                 name,
                 geometry,
                 length_km,
                 elevation_gain,
                 elevation_loss,
                                 ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point
             FROM %I.%I
             WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
               AND ST_Length(geometry) > 0.1
         ),
         elevation_calculated AS (
             -- Calculate elevation data from geometry using PostGIS function
             -- If existing elevation data is NULL, calculate from geometry
             -- If calculation fails, preserve NULL (don''t default to 0)
             SELECT 
                 ts.*,
                 CASE 
                     WHEN ts.elevation_gain IS NOT NULL THEN ts.elevation_gain
                     ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(ts.geometry)))
                 END as calculated_elevation_gain,
                 CASE 
                     WHEN ts.elevation_loss IS NOT NULL THEN ts.elevation_loss
                     ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(ts.geometry)))
                 END as calculated_elevation_loss
             FROM trail_segments ts
         ),
         node_connections AS (
             SELECT 
                 ec.id as trail_id,
                 ec.app_uuid as trail_uuid,
                 ec.name as trail_name,
                 ec.length_km,
                 ec.calculated_elevation_gain as elevation_gain,
                 ec.calculated_elevation_loss as elevation_loss,
                 ec.geometry,
                 fn.id as from_node_id,
                 tn.id as to_node_id
             FROM elevation_calculated ec
             LEFT JOIN LATERAL (
                 SELECT n.id
                 FROM %I.routing_nodes n
                                 WHERE ST_DWithin(ec.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
                ORDER BY ST_Distance(ec.start_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                 LIMIT 1
             ) fn ON true
             LEFT JOIN LATERAL (
                 SELECT n.id
                 FROM %I.routing_nodes n
                                 WHERE ST_DWithin(ec.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s)
                ORDER BY ST_Distance(ec.end_point, ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                 LIMIT 1
             ) tn ON true
         ),
         valid_edges AS (
             SELECT 
                 trail_id,
                 trail_uuid,
                 trail_name,
                 length_km,
                 elevation_gain,
                 elevation_loss,
                 geometry,
                 from_node_id,
                 to_node_id
             FROM node_connections
             WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL
               AND from_node_id <> to_node_id
         ),
         edge_metrics AS (
             SELECT 
                 trail_id,
                 trail_uuid,
                 trail_name,
                 from_node_id,
                 to_node_id,
                 COALESCE(length_km, ST_Length(geometry::geography) / 1000) as distance_km,
                 -- Preserve NULL elevation values - don''t default to 0
                 elevation_gain,
                 elevation_loss
             FROM valid_edges
         )
         SELECT 
             from_node_id,
             to_node_id,
             trail_uuid as trail_id,
             trail_name,
             distance_km,
             elevation_gain,
             elevation_loss
         FROM edge_metrics
         ORDER BY trail_id',
         staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance);
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql; 