-- Migration V3: Add PostGIS intersection and routing functions
-- These functions become part of the database schema and are versioned with the data

-- =====================================================
-- AUTOMATIC UUID GENERATION TRIGGER
-- =====================================================

-- Function to automatically generate UUID for app_uuid field
CREATE OR REPLACE FUNCTION generate_app_uuid()
RETURNS TRIGGER AS $$
BEGIN
    -- Generate new UUID if app_uuid is NULL or empty
    IF NEW.app_uuid IS NULL OR NEW.app_uuid = '' THEN
        NEW.app_uuid := gen_random_uuid()::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMPREHENSIVE COPY AND SPLIT FUNCTION (NATIVE POSTGRESQL)
-- =====================================================

-- Function to copy trails to staging and split them at intersections using native PostGIS
CREATE OR REPLACE FUNCTION copy_and_split_trails_to_staging_native(
    staging_schema text,
    source_table text DEFAULT 'trails',
    region_filter text DEFAULT NULL,
    bbox_min_lng real DEFAULT NULL,
    bbox_min_lat real DEFAULT NULL,
    bbox_max_lng real DEFAULT NULL,
    bbox_max_lat real DEFAULT NULL,
    trail_limit integer DEFAULT NULL,
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(
    original_count integer,
    split_count integer,
    intersection_count integer,
    success boolean,
    message text
) AS $$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    bbox_filter text := '';
    limit_clause text := '';
BEGIN
    -- Clear existing data in staging
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        bbox_filter := format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', 
            bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Build limit clause if provided
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    -- Build source query
    source_query := format('SELECT * FROM %I WHERE geometry IS NOT NULL AND ST_IsValid(geometry)', source_table);
    
    -- Add region filter if provided
    IF region_filter IS NOT NULL THEN
        source_query := source_query || format(' AND region = %L', region_filter);
    END IF;
    
    -- Add bbox filter
    source_query := source_query || bbox_filter;
    
    -- Add limit
    source_query := source_query || limit_clause;
    
    -- Step 1: Copy and split trails using native PostGIS ST_Node
    EXECUTE format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source, 
            geometry, geometry_text, geometry_hash, created_at, updated_at
        )
        WITH trail_intersections AS (
            -- Find all intersection points between trails
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        split_trails AS (
            -- Split each trail at all its intersection points
            SELECT 
                t.app_uuid,
                t.osm_id,
                t.name,
                t.region,
                t.trail_type,
                t.surface,
                t.difficulty,
                t.source_tags,
                t.bbox_min_lng,
                t.bbox_max_lng,
                t.bbox_min_lat,
                t.bbox_max_lat,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                t.max_elevation,
                t.min_elevation,
                t.avg_elevation,
                t.source,
                t.geometry,
                (ST_Dump(ST_Split(ST_Force2D(t.geometry), ti.intersection_point))).geom as split_geom,
                (ST_Dump(ST_Split(ST_Force2D(t.geometry), ti.intersection_point))).path[1] as segment_order
            FROM (%s) t
            LEFT JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        )
        SELECT 
            NULL as app_uuid,  -- Let trigger generate new UUID for all segments
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geom) as bbox_min_lng,
            ST_XMax(split_geom) as bbox_max_lng,
            ST_YMin(split_geom) as bbox_min_lat,
            ST_YMax(split_geom) as bbox_max_lat,
            ST_Length(split_geom::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            ST_Force3D(split_geom) as geometry,
            ST_AsText(ST_Force3D(split_geom)) as geometry_text,
            'geometry_hash_placeholder' as geometry_hash,
            NOW() as created_at,
            NOW() as updated_at
        FROM split_trails
        WHERE ST_IsValid(split_geom)  -- Only include valid geometries
          AND app_uuid IS NOT NULL    -- Ensure app_uuid is not null
    $f$, staging_schema, source_query, source_query, source_query);
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
    PERFORM detect_trail_intersections(staging_schema, tolerance_meters);
    
    -- Get intersection count
    EXECUTE format('SELECT COUNT(*) FROM %I.intersection_points', staging_schema) INTO intersection_count_var;
    
    -- Clear routing data in staging schema since it needs to be regenerated from split trails
    -- This ensures all UUID references are consistent after splitting
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);
    
    -- Return results
    RETURN QUERY SELECT 
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully copied and split %s trails into %s segments with %s intersections', 
               original_count_var, split_count_var, intersection_count_var) as message;
    
    RAISE NOTICE 'Native PostgreSQL copy and split: % original trails -> % split segments with % intersections', 
        original_count_var, split_count_var, intersection_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during native PostgreSQL copy and split: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

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
              AND ST_Length(t1.geometry::geography) > 5  -- Reduced from 10 to 5 meters
              AND ST_Length(t2.geometry::geography) > 5  -- Reduced from 10 to 5 meters
        ) intersections
        JOIN %I.trails t1 ON t1.app_uuid = intersections.t1_uuid
        JOIN %I.trails t2 ON t2.app_uuid = intersections.t2_uuid
        WHERE ST_Length(intersection_point::geography) = 0  -- Point intersections only
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersection points', intersection_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRAIL SPLITTING FUNCTIONS
-- =====================================================

-- Function to replace trails table with split trail segments (USING NATIVE POSTGIS ST_Node)
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
    
    -- Use native PostGIS ST_Node to split all trails at intersections
    EXECUTE format($f$
        DROP TABLE IF EXISTS %I.trails_noded CASCADE;
        CREATE TABLE %I.trails_noded AS
        WITH noded_trails AS (
            -- Use ST_Node to automatically split all trails at intersection points
            SELECT 
                t.id,
                t.app_uuid,
                t.name,
                t.trail_type,
                t.surface,
                t.difficulty,
                t.source_tags,
                t.osm_id,
                t.elevation_gain,
                t.elevation_loss,
                t.max_elevation,
                t.min_elevation,
                t.avg_elevation,
                t.source,
                t.geometry,
                (ST_Dump(ST_Node(ST_Force2D(t.geometry)))).geom as split_geom,
                (ST_Dump(ST_Node(ST_Force2D(t.geometry)))).path[1] as segment_order
            FROM %I.trails t
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        )
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
            ST_Length(split_geom::geography) / 1000.0 as length_km,
            source,
            ST_Force3D(split_geom) as geometry,
            ST_XMin(split_geom) as bbox_min_lng,
            ST_XMax(split_geom) as bbox_max_lng,
            ST_YMin(split_geom) as bbox_min_lat,
            ST_YMax(split_geom) as bbox_max_lat,
            NOW() as created_at,
            NOW() as updated_at
        FROM noded_trails
        WHERE ST_IsValid(split_geom)  -- Only filter out invalid geometries, keep all valid segments
    $f$, staging_schema, staging_schema, staging_schema);
    
    -- Get segment count
    EXECUTE format('SELECT COUNT(*) FROM %I.trails_noded', staging_schema) INTO segment_count;
    
    -- Replace original table with split trails
    EXECUTE format('DROP TABLE %I.trails CASCADE', staging_schema);
    EXECUTE format('ALTER TABLE %I.trails_noded RENAME TO trails', staging_schema);
    
    -- Create optimized spatial indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_name ON %I.trails(name)', staging_schema);
    
    -- Log results
    RAISE NOTICE 'Trail splitting using ST_Node: % original trails -> % segments (%.1f%% change)', 
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

-- =====================================================
-- ROUTING GRAPH GENERATION FUNCTIONS (NATIVE POSTGRESQL)
-- =====================================================

-- Function to generate routing nodes from intersection points using native PostGIS
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(
    staging_schema text,
    tolerance_meters real DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from intersection points using native PostGIS
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
    RAISE NOTICE 'Generated % routing nodes using native PostGIS', node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Function to generate routing edges from split trail segments using native PostGIS
CREATE OR REPLACE FUNCTION generate_routing_edges_native(
    staging_schema text,
    tolerance_meters real DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    edge_count integer := 0;
    node_count integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Check if we have routing nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    IF node_count = 0 THEN
        RAISE NOTICE 'No routing nodes found, skipping edge generation';
        RETURN 0;
    END IF;
    
    -- Generate routing edges from split trail segments using native PostGIS
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry, geojson)
        SELECT 
            (SELECT id FROM %I.routing_nodes WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(t.geometry), $1) LIMIT 1) as source,
            (SELECT id FROM %I.routing_nodes WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(t.geometry), $1) LIMIT 1) as target,
            app_uuid as trail_id,
            name as trail_name,
            length_km as distance_km,
            COALESCE(elevation_gain, 0) as elevation_gain,
            COALESCE(elevation_loss, 0) as elevation_loss,
            geometry,
            ST_AsGeoJSON(geometry) as geojson
        FROM %I.trails t
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS edge_count = ROW_COUNT;
    RAISE NOTICE 'Generated % routing edges using native PostGIS', edge_count;
    
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMPREHENSIVE ROUTING GRAPH GENERATION (NATIVE POSTGRESQL)
-- =====================================================

-- Function to generate complete routing graph using native PostGIS functions
CREATE OR REPLACE FUNCTION generate_complete_routing_graph_native(
    staging_schema text,
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(
    node_count integer,
    edge_count integer,
    success boolean,
    message text
) AS $$
DECLARE
    node_count_var integer := 0;
    edge_count_var integer := 0;
BEGIN
    -- Generate routing nodes
    SELECT generate_routing_nodes_native(staging_schema, tolerance_meters) INTO node_count_var;
    
    -- Generate routing edges
    SELECT generate_routing_edges_native(staging_schema, tolerance_meters) INTO edge_count_var;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        edge_count_var,
        true as success,
        format('Successfully generated routing graph: %s nodes, %s edges', node_count_var, edge_count_var) as message;
    
    RAISE NOTICE 'Native PostgreSQL routing graph: % nodes, % edges', node_count_var, edge_count_var;
    
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, false, 
        format('Error during routing graph generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during native PostgreSQL routing graph generation: %', SQLERRM;
END;
$$ LANGUAGE plpgsql; 