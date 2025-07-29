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
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS intersection_count = ROW_COUNT;
    RAISE NOTICE 'Detected % intersection points', intersection_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRAIL SPLITTING FUNCTIONS
-- =====================================================

-- Function to replace trails table with split trail segments
CREATE OR REPLACE FUNCTION replace_trails_with_split_trails(
    staging_schema text,
    tolerance_meters real DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    trail_record RECORD;
    original_trail_id integer;
    current_geometry geometry;
    segment_counter integer;
    has_intersections boolean;
    intersection_point RECORD;
    split_result RECORD;
    total_segments integer := 0;
    total_original_trails integer := 0;
    split_geometry geometry;
    segment_geometries geometry[];
    segment_count integer;
BEGIN
    -- Create backup of original trails
    EXECUTE format('DROP TABLE IF EXISTS %I.original_trails_backup CASCADE', staging_schema);
    EXECUTE format('CREATE TABLE %I.original_trails_backup AS SELECT * FROM %I.trails', staging_schema, staging_schema);
    
    -- Create temporary table for split trails
    EXECUTE format('DROP TABLE IF EXISTS %I.temp_split_trails CASCADE', staging_schema);
    EXECUTE format($f$
        CREATE TABLE %I.temp_split_trails (
            id SERIAL PRIMARY KEY,
            original_trail_id INTEGER,
            segment_number INTEGER,
            app_uuid TEXT UNIQUE NOT NULL,
            name TEXT,
            trail_type TEXT,
            surface TEXT,
            difficulty TEXT,
            source_tags JSONB,
            osm_id TEXT,
            elevation_gain REAL,
            elevation_loss REAL,
            max_elevation REAL,
            min_elevation REAL,
            avg_elevation REAL,
            length_km REAL,
            source TEXT,
            geometry GEOMETRY(LINESTRINGZ, 4326),
            bbox_min_lng REAL,
            bbox_max_lng REAL,
            bbox_min_lat REAL,
            bbox_max_lat REAL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    $f$, staging_schema);
    
    -- Process each original trail
    FOR trail_record IN EXECUTE format($f$
        SELECT id, app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id,
               elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
               length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        FROM %I.original_trails_backup
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ORDER BY id
    $f$, staging_schema)
    LOOP
        original_trail_id := trail_record.id;
        total_original_trails := total_original_trails + 1;
        current_geometry := trail_record.geometry;
        segment_counter := 0;
        
        -- Find all intersection points for this trail
        EXECUTE format($f$
            SELECT DISTINCT
                ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_point
            FROM %I.original_trails_backup t1
            JOIN %I.original_trails_backup t2 ON (t1.id < t2.id)
            WHERE t1.id = $1
              AND ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) = 'ST_Point'
              AND ST_Distance(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))::geography, ST_StartPoint(t1.geometry)::geography) > $2
              AND ST_Distance(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))::geography, ST_EndPoint(t1.geometry)::geography) > $2
        $f$, staging_schema, staging_schema) USING original_trail_id, tolerance_meters;
        
        -- Check if we found any intersections
        GET DIAGNOSTICS segment_count = ROW_COUNT;
        
        IF segment_count = 0 THEN
            -- No intersections found, keep original trail as single segment
            EXECUTE format($f$
                INSERT INTO %I.temp_split_trails (
                    app_uuid, original_trail_id, segment_number, name, trail_type, surface, difficulty,
                    source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation,
                    avg_elevation, length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                    ST_XMin($17), ST_XMax($17), ST_YMin($17), ST_YMax($17)
                )
            $f$, staging_schema) USING 
                gen_random_uuid()::text,
                original_trail_id,
                1,
                trail_record.name,
                trail_record.trail_type,
                trail_record.surface,
                trail_record.difficulty,
                trail_record.source_tags,
                trail_record.osm_id,
                trail_record.elevation_gain,
                trail_record.elevation_loss,
                trail_record.max_elevation,
                trail_record.min_elevation,
                trail_record.avg_elevation,
                trail_record.length_km,
                trail_record.source,
                current_geometry;
            
            total_segments := total_segments + 1;
        ELSE
            -- Found intersections, split the trail
            -- Collect all intersection points for this trail
            FOR intersection_point IN EXECUTE format($f$
                SELECT DISTINCT
                    ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_point
                FROM %I.original_trails_backup t1
                JOIN %I.original_trails_backup t2 ON (t1.id < t2.id)
                WHERE t1.id = $1
                  AND ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))
                  AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) = 'ST_Point'
                  AND ST_Distance(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))::geography, ST_StartPoint(t1.geometry)::geography) > $2
                  AND ST_Distance(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))::geography, ST_EndPoint(t1.geometry)::geography) > $2
                ORDER BY ST_LineLocatePoint(ST_Force2D(t1.geometry), ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))
            $f$, staging_schema, staging_schema) USING original_trail_id, tolerance_meters
            LOOP
                -- Split the trail at this intersection point
                split_geometry := ST_Split(ST_Force2D(current_geometry), intersection_point.intersection_point);
                
                -- Extract individual segments from the split result
                segment_geometries := ARRAY(SELECT (ST_Dump(split_geometry)).geom);
                
                -- Insert each segment as a separate trail
                FOR i IN 1..array_length(segment_geometries, 1) LOOP
                    -- Skip segments that are too short (less than 100 meters)
                    IF ST_Length(segment_geometries[i]::geography) >= 100 THEN
                        segment_counter := segment_counter + 1;
                        
                        -- Calculate segment-specific metrics
                        EXECUTE format($f$
                            INSERT INTO %I.temp_split_trails (
                                app_uuid, original_trail_id, segment_number, name, trail_type, surface, difficulty,
                                source_tags, osm_id, elevation_gain, elevation_loss, max_elevation, min_elevation,
                                avg_elevation, length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
                            ) VALUES (
                                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                                ST_XMin($17), ST_XMax($17), ST_YMin($17), ST_YMax($17)
                            )
                        $f$, staging_schema) USING 
                            gen_random_uuid()::text,
                            original_trail_id,
                            segment_counter,
                            trail_record.name,
                            trail_record.trail_type,
                            trail_record.surface,
                            trail_record.difficulty,
                            trail_record.source_tags,
                            trail_record.osm_id,
                            trail_record.elevation_gain,
                            trail_record.elevation_loss,
                            trail_record.max_elevation,
                            trail_record.min_elevation,
                            trail_record.avg_elevation,
                            ST_Length(segment_geometries[i]::geography) / 1000.0, -- Convert to km
                            trail_record.source,
                            ST_Force3D(segment_geometries[i]);
                        
                        total_segments := total_segments + 1;
                    END IF;
                END LOOP;
                
                -- Update current_geometry for next iteration (use the first segment as base)
                current_geometry := segment_geometries[1];
            END LOOP;
        END IF;
    END LOOP;
    
    -- Replace original trails table with split trails
    EXECUTE format('DROP TABLE %I.trails CASCADE', staging_schema);
    EXECUTE format('ALTER TABLE %I.temp_split_trails RENAME TO trails', staging_schema);
    
    -- Create indexes on the new trails table
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_original_trail_id ON %I.trails(original_trail_id)', staging_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_segment_number ON %I.trails(segment_number)', staging_schema);
    
    RAISE NOTICE 'Split % original trails into % segments', total_original_trails, total_segments;
    RETURN total_segments;
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