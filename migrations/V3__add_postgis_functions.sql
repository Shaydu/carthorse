-- =====================================================
-- CARTHORSE POSTGIS FUNCTIONS - V3
-- =====================================================

-- UUID generation trigger for trails table
CREATE OR REPLACE FUNCTION generate_app_uuid()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.app_uuid IS NULL OR NEW.app_uuid = '' THEN
        NEW.app_uuid := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to recalculate elevation data for a trail geometry
CREATE OR REPLACE FUNCTION recalculate_elevation_data(
    trail_geometry geometry
) RETURNS TABLE(
    elevation_gain double precision,
    elevation_loss double precision,
    max_elevation double precision,
    min_elevation double precision,
    avg_elevation double precision
) AS $$
DECLARE
    points record;
    prev_elevation double precision := NULL;
    current_elevation double precision;
    total_gain double precision := 0;
    total_loss double precision := 0;
    max_elev double precision := -9999;
    min_elev double precision := 9999;
    total_elev double precision := 0;
    point_count integer := 0;
BEGIN
    -- Extract all points from the geometry
    FOR points IN 
        SELECT (ST_DumpPoints(trail_geometry)).geom as point
    LOOP
        -- Get elevation from the point (Z coordinate)
        current_elevation := ST_Z(points.point);
        
        -- Skip if no elevation data
        IF current_elevation IS NULL THEN
            CONTINUE;
        END IF;
        
        -- Update min/max elevation
        IF current_elevation > max_elev THEN
            max_elev := current_elevation;
        END IF;
        IF current_elevation < min_elev THEN
            min_elev := current_elevation;
        END IF;
        
        -- Calculate gain/loss
        IF prev_elevation IS NOT NULL THEN
            IF current_elevation > prev_elevation THEN
                total_gain := total_gain + (current_elevation - prev_elevation);
            ELSIF current_elevation < prev_elevation THEN
                total_loss := total_loss + (prev_elevation - current_elevation);
            END IF;
        END IF;
        
        -- Update running totals
        total_elev := total_elev + current_elevation;
        point_count := point_count + 1;
        prev_elevation := current_elevation;
    END LOOP;
    
    -- Return calculated elevation data
    RETURN QUERY SELECT 
        total_gain,
        total_loss,
        CASE WHEN max_elev = -9999 THEN NULL ELSE max_elev END,
        CASE WHEN min_elev = 9999 THEN NULL ELSE min_elev END,
        CASE WHEN point_count = 0 THEN NULL ELSE total_elev / point_count END;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRAIL SPLITTING AND COPYING FUNCTIONS
-- =====================================================

-- Function to copy and split trails to staging using native PostgreSQL
CREATE OR REPLACE FUNCTION copy_and_split_trails_to_staging_native(
    staging_schema text,
    source_table text,
    region_filter text,
    bbox_min_lng real DEFAULT NULL,
    bbox_min_lat real DEFAULT NULL,
    bbox_max_lng real DEFAULT NULL,
    bbox_max_lat real DEFAULT NULL,
    trail_limit integer DEFAULT NULL,
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text) AS $$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
BEGIN
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters
    source_query := format('SELECT * FROM %I WHERE region = %L', source_table, region_filter);
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    -- Add limit
    source_query := source_query || limit_clause;
    
    -- Step 1: Copy and split trails using native PostGIS ST_Split
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
        ),
        elevation_calculated AS (
            -- Calculate elevation data for each split segment
            SELECT 
                st.*,
                (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(st.split_geom))) as new_elevation_gain,
                (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(st.split_geom))) as new_elevation_loss,
                (SELECT max_elevation FROM recalculate_elevation_data(ST_Force3D(st.split_geom))) as new_max_elevation,
                (SELECT min_elevation FROM recalculate_elevation_data(ST_Force3D(st.split_geom))) as new_min_elevation,
                (SELECT avg_elevation FROM recalculate_elevation_data(ST_Force3D(st.split_geom))) as new_avg_elevation
            FROM split_trails st
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
            -- Use recalculated elevation data for split segments
            COALESCE(new_elevation_gain, elevation_gain) as elevation_gain,
            COALESCE(new_elevation_loss, elevation_loss) as elevation_loss,
            COALESCE(new_max_elevation, max_elevation) as max_elevation,
            COALESCE(new_min_elevation, min_elevation) as min_elevation,
            COALESCE(new_avg_elevation, avg_elevation) as avg_elevation,
            source,
            ST_Force3D(split_geom) as geometry,
            ST_AsText(ST_Force3D(split_geom)) as geometry_text,
            'geometry_hash_placeholder' as geometry_hash,
            NOW() as created_at,
            NOW() as updated_at
        FROM elevation_calculated
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
-- ROUTING GRAPH GENERATION FUNCTIONS
-- =====================================================

-- Function to generate routing nodes from trail start and end points
CREATE OR REPLACE FUNCTION generate_routing_nodes_native(
    staging_schema text,
    tolerance_meters real DEFAULT 1.0
) RETURNS TABLE(node_count integer, success boolean, message text) AS $$
DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail start and end points
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        SELECT DISTINCT
            gen_random_uuid() as node_uuid,
            ST_Y(point) as lat,
            ST_X(point) as lng,
            ST_Z(point) as elevation,
            'trail_endpoint' as node_type,
            'trail_endpoint' as connected_trails
        FROM (
            -- Start points of all trails
            SELECT ST_StartPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
            UNION
            -- End points of all trails
            SELECT ST_EndPoint(geometry) as point FROM %I.trails WHERE geometry IS NOT NULL
        ) trail_points
        WHERE point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes from trail endpoints', node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing nodes from trail endpoints', node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Function to generate routing edges from trail segments
CREATE OR REPLACE FUNCTION generate_routing_edges_native(
    staging_schema text,
    tolerance_meters real DEFAULT 1.0
) RETURNS TABLE(edge_count integer, success boolean, message text) AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from trail segments
    -- Use exact point matching instead of ST_DWithin with LIMIT 1
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
            -- If existing elevation data is NULL, calculate from geometry
            -- If calculation fails, preserve NULL (don''t default to 0)
            SELECT 
                t.*,
                CASE 
                    WHEN t.elevation_gain IS NOT NULL THEN t.elevation_gain
                    ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(t.geometry)))
                END as calculated_elevation_gain,
                CASE 
                    WHEN t.elevation_loss IS NOT NULL THEN t.elevation_loss
                    ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(t.geometry)))
                END as calculated_elevation_loss
            FROM %I.trails t
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry) AND t.length_km > 0
        )
        SELECT 
            source_node.id as source,
            target_node.id as target,
            ec.app_uuid as trail_id,
            ec.name as trail_name,
            ec.length_km as distance_km,
            -- Preserve NULL elevation values - don''t default to 0
            ec.calculated_elevation_gain as elevation_gain,
            ec.calculated_elevation_loss as elevation_loss,
            ec.geometry,
            ST_AsGeoJSON(ec.geometry, 6, 0) as geojson
        FROM elevation_calculated ec
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry), $1)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_StartPoint(ec.geometry))
            LIMIT 1
        ) source_node
        CROSS JOIN LATERAL (
            SELECT id FROM %I.routing_nodes 
            WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(ec.geometry), $1)
            ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_EndPoint(ec.geometry))
            LIMIT 1
        ) target_node
        WHERE source_node.id IS NOT NULL
          AND target_node.id IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Successfully generated %s routing edges from %s nodes', edge_count_var, node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing edges from % nodes', edge_count_var, node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing edges generation: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- VALIDATION FUNCTIONS
-- =====================================================

-- Function to validate intersection detection
CREATE OR REPLACE FUNCTION validate_intersection_detection(
    staging_schema text
) RETURNS TABLE(total_intersections integer, total_nodes integer, total_edges integer, avg_connections real, has_intersections boolean) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            (SELECT COUNT(*)::integer FROM %I.intersection_points) as total_intersections,
            (SELECT COUNT(*)::integer FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_edges) as total_edges,
            (SELECT AVG(array_length(connected_trail_ids, 1))::real FROM %I.intersection_points),
            (SELECT EXISTS (SELECT 1 FROM %I.intersection_points LIMIT 1))
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql; 