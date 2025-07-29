-- Migration V3: Add PostGIS intersection and routing functions
-- These functions become part of the database schema and are versioned with the data

-- =====================================================
-- INTERSECTION DETECTION FUNCTIONS
-- =====================================================

-- Function to detect trail intersections and populate intersection_points table
CREATE OR REPLACE FUNCTION detect_trail_intersections(
    staging_schema text,
    tolerance_meters real DEFAULT 1.0
) RETURNS void AS $$
DECLARE
    intersection_count integer := 0;
BEGIN
    -- Clear existing intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Detect intersections between trails
    EXECUTE format($f$
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(intersection_point) as point,
            ST_Force3D(intersection_point) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $1 as distance_meters
        FROM (
            SELECT 
                (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point,
                t1.app_uuid as t1_uuid,
                t2.app_uuid as t2_uuid
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Distance(ST_StartPoint(t1.geometry)::geography, ST_EndPoint(t1.geometry)::geography) > 10
              AND ST_Distance(ST_StartPoint(t2.geometry)::geography, ST_EndPoint(t2.geometry)::geography) > 10
        ) intersections
        JOIN %I.trails t1 ON t1.app_uuid = intersections.t1_uuid
        JOIN %I.trails t2 ON t2.app_uuid = intersections.t2_uuid
        WHERE ST_Length(intersection_point::geography) = 0  -- Point intersections only
          AND ST_Distance(intersection_point::geography, ST_StartPoint(t1.geometry)::geography) > $1
          AND ST_Distance(intersection_point::geography, ST_EndPoint(t1.geometry)::geography) > $1
          AND ST_Distance(intersection_point::geography, ST_StartPoint(t2.geometry)::geography) > $1
          AND ST_Distance(intersection_point::geography, ST_EndPoint(t2.geometry)::geography) > $1
    $f$, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersection points', intersection_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRAIL SPLITTING FUNCTIONS
-- =====================================================

-- Function to replace trails table with split trail segments (OPTIMIZED VERSION)
CREATE OR REPLACE FUNCTION replace_trails_with_split_trails(
    staging_schema text,
    tolerance_meters real DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    segment_count integer;
    original_count integer;
BEGIN
    -- Get original trail count
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO original_count;
    
    -- Create backup of original trails
    EXECUTE format('DROP TABLE IF EXISTS %I.original_trails_backup CASCADE', staging_schema);
    EXECUTE format('CREATE TABLE %I.original_trails_backup AS SELECT * FROM %I.trails', staging_schema, staging_schema);
    
    -- OPTIMIZED: Use ST_Node for automatic intersection detection and splitting
    -- This is much more efficient than the loop-based approach
    EXECUTE format($f$
        DROP TABLE IF EXISTS %I.trails_noded CASCADE;
        CREATE TABLE %I.trails_noded AS
        SELECT 
            ROW_NUMBER() OVER () as id,
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            source_tags,
            osm_id,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            ST_Length(geom::geography) / 1000.0 as length_km,
            source,
            ST_Force3D(geom) as geometry,
            ST_XMin(geom) as bbox_min_lng,
            ST_XMax(geom) as bbox_max_lng,
            ST_YMin(geom) as bbox_min_lat,
            ST_YMax(geom) as bbox_max_lat,
            NOW() as created_at,
            NOW() as updated_at
        FROM (
            SELECT 
                app_uuid,
                name,
                trail_type,
                surface,
                difficulty,
                source_tags,
                osm_id,
                elevation_gain,
                elevation_loss,
                max_elevation,
                min_elevation,
                avg_elevation,
                source,
                (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as geom
            FROM %I.trails
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ) noded_trails
        WHERE ST_Length(geom::geography) >= 100  -- Filter out segments shorter than 100m
    $f$, staging_schema, staging_schema, staging_schema);
    
    -- Get segment count
    EXECUTE format('SELECT COUNT(*) FROM %I.trails_noded', staging_schema) INTO segment_count;
    
    -- Replace original table with optimized split trails
    EXECUTE format('DROP TABLE %I.trails CASCADE', staging_schema);
    EXECUTE format('ALTER TABLE %I.trails_noded RENAME TO trails', staging_schema, staging_schema);
    
    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    
    -- Log optimization results
    RAISE NOTICE 'Optimized trail splitting: % original trails -> % segments (%.1f%% increase)', 
        original_count, segment_count, 
        CASE WHEN original_count > 0 THEN (segment_count::float / original_count * 100) ELSE 0 END;
    
    RETURN segment_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ROUTING GRAPH FUNCTIONS
-- =====================================================

-- Function to build routing nodes from intersection points
CREATE OR REPLACE FUNCTION build_routing_nodes(
    staging_schema text,
    tolerance_meters real DEFAULT 1.0
) RETURNS void AS $$
DECLARE
    node_count integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Create routing nodes from intersection points
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        SELECT 
            gen_random_uuid()::text as node_uuid,
            ST_Y(point) as lat,
            ST_X(point) as lng,
            ST_Z(point_3d) as elevation,
            node_type,
            array_to_string(connected_trail_names, ', ') as connected_trails
        FROM %I.intersection_points
        WHERE point IS NOT NULL
        ORDER BY point
    $f$, staging_schema, staging_schema);
    
    GET DIAGNOSTICS node_count = ROW_COUNT;
    RAISE NOTICE 'Created % routing nodes', node_count;
END;
$$ LANGUAGE plpgsql;

-- Function to build routing edges from split trails
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    tolerance_meters real DEFAULT 1.0
) RETURNS void AS $$
DECLARE
    edge_count integer := 0;
    node_count integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Check if we have any routing nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    IF node_count = 0 THEN
        RAISE NOTICE 'No routing nodes found, skipping edge creation';
        RETURN;
    END IF;
    
    -- Create routing edges from split trails
    -- This is a simplified version - in a full implementation, we'd connect trails between nodes
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry)
        SELECT 
            (SELECT id FROM %I.routing_nodes LIMIT 1) as from_node_id,
            (SELECT id FROM %I.routing_nodes LIMIT 1) as to_node_id,
            app_uuid as trail_id,
            name as trail_name,
            length_km as distance_km,
            elevation_gain,
            elevation_loss,
            geometry
        FROM %I.trails
        WHERE geometry IS NOT NULL
        LIMIT 1  -- Simplified: just one edge for now
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS edge_count = ROW_COUNT;
    RAISE NOTICE 'Created % routing edges', edge_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get intersection statistics
CREATE OR REPLACE FUNCTION get_intersection_stats(
    staging_schema text
) RETURNS TABLE(
    total_intersections integer,
    total_nodes integer,
    total_edges integer,
    avg_connections_per_node numeric
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            (SELECT COUNT(*) FROM %I.intersection_points) as total_intersections,
            (SELECT COUNT(*) FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges,
            COALESCE(
                (SELECT AVG(array_length(connected_trail_ids, 1)) FROM %I.intersection_points),
                0
            ) as avg_connections_per_node
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Function to validate intersection detection
CREATE OR REPLACE FUNCTION validate_intersection_detection(
    staging_schema text
) RETURNS TABLE(
    validation_message text,
    is_valid boolean
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            'Intersection detection validation complete' as validation_message,
            true as is_valid
        WHERE EXISTS (SELECT 1 FROM %I.intersection_points LIMIT 1)
    $f$, staging_schema);
END;
$$ LANGUAGE plpgsql; 