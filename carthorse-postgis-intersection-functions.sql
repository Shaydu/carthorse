-- PostGIS Functions for Intersection Detection and Routing Graph Building
-- These functions abstract the complex intersection detection logic into reusable PostGIS functions

-- Function to detect all intersections
-- Example usage:
-- SELECT * FROM detect_trail_intersections('staging_boulder_1234567890.trails', 2.0);
-- SELECT build_routing_nodes('staging_boulder_1234567890', 'trails', 2.0);
-- SELECT build_routing_edges('staging_boulder_1234567890', 'trails');
-- SELECT * FROM get_intersection_stats('staging_boulder_1234567890');
-- SELECT * FROM validate_intersection_detection('staging_boulder_1234567890');
-- SELECT * FROM validate_spatial_data_integrity('staging_boulder_1234567890');

-- Enable PostGIS extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enhanced function to detect all intersections between trails in a table
-- Only returns points where two distinct trails cross/touch (true intersection)
-- or where endpoints are within a tight threshold (default 1.0 meter)
CREATE OR REPLACE FUNCTION detect_trail_intersections(
    trails_table text,
    intersection_tolerance_meters float DEFAULT 1.0
) RETURNS TABLE (
    intersection_point geometry,
    intersection_point_3d geometry,
    connected_trail_ids integer[],
    connected_trail_names text[],
    node_type text,
    distance_meters float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH noded_trails AS (
            -- Use ST_Node to split all trails at intersections (network topology)
            SELECT id, name, (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as noded_geom
            FROM %I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            -- True geometric intersections (where two trails cross/touch)
            SELECT 
                ST_Intersection(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom)) as intersection_point,
                ST_Force3D(ST_Intersection(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom))) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                0.0 as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_Intersects(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom))
              AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.noded_geom), ST_Force2D(t2.noded_geom))) = ''ST_Point''
        ),
        endpoint_near_miss AS (
            -- Endpoints within a tight threshold (1.0 meter)
            SELECT 
                ST_EndPoint(ST_Force2D(t1.noded_geom)) as intersection_point,
                ST_Force3D(ST_EndPoint(ST_Force2D(t1.noded_geom))) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''endpoint_near_miss'' as node_type,
                ST_Distance(ST_EndPoint(ST_Force2D(t1.noded_geom)), ST_EndPoint(ST_Force2D(t2.noded_geom))) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_DWithin(ST_EndPoint(ST_Force2D(t1.noded_geom)), ST_EndPoint(ST_Force2D(t2.noded_geom)), GREATEST($1, 0.001))
        ),
        all_intersections AS (
            SELECT * FROM true_intersections
            UNION ALL
            SELECT * FROM endpoint_near_miss
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            node_type,
            distance_meters
        FROM all_intersections
        ORDER BY distance_meters, intersection_point
    ', trails_table)
    USING intersection_tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- Enhanced function to build routing nodes using optimized spatial operations
CREATE OR REPLACE FUNCTION build_routing_nodes(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters float DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Insert routing nodes using optimized PostGIS spatial functions
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            -- Extract start and end points of all trails using PostGIS functions
            SELECT 
                ST_StartPoint(ST_Force2D(geometry)) as start_point,
                ST_EndPoint(ST_Force2D(geometry)) as end_point,
                app_uuid,
                name
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            -- Use the enhanced intersection detection function
            SELECT 
                intersection_point,
                intersection_point_3d,
                connected_trail_ids,
                connected_trail_names,
                node_type,
                distance_meters
            FROM detect_trail_intersections(''%I.%I'', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1  -- Only true intersections
        ),
        all_nodes AS (
            -- Combine intersection points and trail endpoints
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                connected_trail_names as connected_trails,
                ''intersection'' as node_type
            FROM intersection_points
            
            UNION ALL
            
            -- Trail start points
            SELECT 
                start_point as point,
                ST_Force3D(start_point) as point_3d,
                ARRAY[name] as connected_trails,
                ''endpoint'' as node_type
            FROM trail_endpoints
            
            UNION ALL
            
            -- Trail end points
            SELECT 
                end_point as point,
                ST_Force3D(end_point) as point_3d,
                ARRAY[name] as connected_trails,
                ''endpoint'' as node_type
            FROM trail_endpoints
        ),
        grouped_nodes AS (
            -- Group nearby nodes to avoid duplicates using spatial clustering
            SELECT 
                ST_X(point) as lng,
                ST_Y(point) as lat,
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT unnest(connected_trails)) as all_connected_trails,
                CASE 
                    WHEN array_length(array_agg(DISTINCT unnest(connected_trails)), 1) > 1 THEN ''intersection''
                    ELSE ''endpoint''
                END as node_type,
                point,
                point_3d
            FROM all_nodes
            GROUP BY point, point_3d
        ),
        final_nodes AS (
            -- Remove duplicate nodes within tolerance distance
            SELECT DISTINCT ON (ST_SnapToGrid(point, GREATEST($1, 0.001)/1000))
                lng,
                lat,
                elevation,
                all_connected_trails,
                node_type
            FROM grouped_nodes
            ORDER BY ST_SnapToGrid(point, GREATEST($1, 0.001)/1000), array_length(all_connected_trails, 1) DESC
        )
        SELECT 
            gen_random_uuid()::text as node_uuid,
            lat,
            lng,
            elevation,
            node_type,
            array_to_string(all_connected_trails, '','') as connected_trails
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    ', staging_schema, staging_schema, trails_table, staging_schema, trails_table)
    USING intersection_tolerance_meters;
    
    -- Get the count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Enhanced function to build routing edges using optimized spatial operations
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text
) RETURNS integer AS $$
DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Insert routing edges using optimized PostGIS spatial functions
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
        WITH trail_segments AS (
            -- Get all trail segments with validated geometry
            SELECT 
                id,
                app_uuid,
                name,
                ST_Force2D(geometry) as geometry,
                length_km,
                elevation_gain,
                ST_StartPoint(ST_Force2D(geometry)) as start_point,
                ST_EndPoint(ST_Force2D(geometry)) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        node_connections AS (
            -- Find which nodes connect to each trail segment using spatial functions
            SELECT 
                ts.id as trail_id,
                ts.app_uuid as trail_uuid,
                ts.name as trail_name,
                ts.length_km,
                ts.elevation_gain,
                ts.geometry,
                -- Find start node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)))
                 LIMIT 1) as from_node_id,
                -- Find end node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)))
                 LIMIT 1) as to_node_id
            FROM trail_segments ts
        ),
        valid_edges AS (
            -- Only include edges where both nodes are found
            SELECT 
                trail_id,
                trail_uuid,
                trail_name,
                length_km,
                elevation_gain,
                geometry,
                from_node_id,
                to_node_id
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL
        ),
        edge_metrics AS (
            -- Calculate accurate distances and validate spatial relationships
            SELECT 
                trail_id,
                trail_uuid,
                trail_name,
                from_node_id,
                to_node_id,
                COALESCE(length_km, ST_Length(geometry::geography) / 1000) as distance_km,
                COALESCE(elevation_gain, 0) as elevation_gain,
                -- Validate that nodes are actually connected to the trail
                ST_DWithin(
                    ST_Force2D(ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = from_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = from_node_id)
                    ), 4326)),
                    geometry,
                    GREATEST(0.001, 0.001)
                ) as start_connected,
                ST_DWithin(
                    ST_Force2D(ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = to_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = to_node_id)
                    ), 4326)),
                    geometry,
                    GREATEST(0.001, 0.001)
                ) as end_connected
            FROM valid_edges
        )
        SELECT 
            from_node_id,
            to_node_id,
            trail_uuid as trail_id,
            trail_name,
            distance_km,
            elevation_gain
        FROM edge_metrics
        WHERE start_connected AND end_connected
        ORDER BY trail_id
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema, staging_schema, staging_schema);
    
    -- Get the count of inserted edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get intersection statistics
CREATE OR REPLACE FUNCTION get_intersection_stats(
    staging_schema text
) RETURNS TABLE (
    total_nodes integer,
    intersection_nodes integer,
    endpoint_nodes integer,
    total_edges integer,
    node_to_trail_ratio float,
    processing_time_ms integer
) AS $$
DECLARE
    start_time timestamp;
    end_time timestamp;
    trail_count integer;
BEGIN
    start_time := clock_timestamp();
    
    -- Get trail count
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO trail_count;
    
    -- Get node and edge counts
    RETURN QUERY EXECUTE format('
        SELECT 
            (SELECT COUNT(*) FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*) FROM %I.routing_nodes WHERE node_type = ''intersection'') as intersection_nodes,
            (SELECT COUNT(*) FROM %I.routing_nodes WHERE node_type = ''endpoint'') as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges,
            CASE 
                WHEN $1 > 0 THEN (SELECT COUNT(*) FROM %I.routing_nodes)::float / $1
                ELSE 0
            END as node_to_trail_ratio,
            EXTRACT(EPOCH FROM (clock_timestamp() - $2::timestamp)) * 1000 as processing_time_ms
    ', staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING trail_count, start_time;
    
    end_time := clock_timestamp();
END;
$$ LANGUAGE plpgsql;

-- Enhanced function to validate intersection detection results with comprehensive spatial checks
CREATE OR REPLACE FUNCTION validate_intersection_detection(
    staging_schema text
) RETURNS TABLE (
    validation_check text,
    status text,
    details text
) AS $$
BEGIN
    -- Check if nodes exist
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Nodes exist'' as validation_check,
            CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' nodes found'' as details
        FROM %I.routing_nodes
    ', staging_schema);
    
    -- Check if edges exist
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edges exist'' as validation_check,
            CASE WHEN COUNT(*) > 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges found'' as details
        FROM %I.routing_edges
    ', staging_schema);
    
    -- Check node types
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node types valid'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid node types found'' as details
        FROM %I.routing_nodes 
        WHERE node_type NOT IN (''intersection'', ''endpoint'')
    ', staging_schema);
    
    -- Check for self-loops
    RETURN QUERY EXECUTE format('
        SELECT 
            ''No self-loops'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' self-loops found'' as details
        FROM %I.routing_edges 
        WHERE from_node_id = to_node_id
    ', staging_schema);
    
    -- Check node-to-trail ratio
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node-to-trail ratio'' as validation_check,
            CASE 
                WHEN ratio <= 0.5 THEN ''PASS''
                WHEN ratio <= 1.0 THEN ''WARNING''
                ELSE ''FAIL''
            END as status,
            ROUND(ratio * 100, 1)::text || ''%% ratio (target: <50%%)'' as details
        FROM (
            SELECT 
                (SELECT COUNT(*) FROM %I.routing_nodes)::float / 
                (SELECT COUNT(*) FROM %I.trails) as ratio
        ) ratios
    ', staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Comprehensive spatial validation function for data integrity
CREATE OR REPLACE FUNCTION validate_spatial_data_integrity(
    staging_schema text
) RETURNS TABLE (
    validation_check text,
    status text,
    details text,
    severity text
) AS $$
BEGIN
    -- Validate all geometries are valid using ST_IsValid()
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Geometry validity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid geometries found'' as details,
            ''ERROR'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)
    ', staging_schema);
    
    -- Ensure coordinate system consistency (SRID 4326)
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Coordinate system consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' geometries with wrong SRID'' as details,
            ''ERROR'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_SRID(geometry) != 4326
    ', staging_schema);
    
    -- Validate intersection nodes have proper trail connections
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Intersection node connections'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' intersection nodes with <2 connected trails'' as details,
            ''ERROR'' as severity
        FROM %I.routing_nodes 
        WHERE node_type = ''intersection'' AND 
              array_length(string_to_array(connected_trails, '',''), 1) < 2
    ', staging_schema);
    
    -- Check for spatial containment issues
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Spatial containment'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails outside region bbox'' as details,
            ''WARNING'' as severity
        FROM %I.trails t
        WHERE geometry IS NOT NULL AND NOT ST_Within(
            geometry, 
            ST_MakeEnvelope(
                MIN(bbox_min_lng), MIN(bbox_min_lat), 
                MAX(bbox_max_lng), MAX(bbox_max_lat), 4326
            )
        )
    ', staging_schema);
    
    -- Validate elevation data consistency
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Elevation data consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails with inconsistent elevation data'' as details,
            ''WARNING'' as severity
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 3 AND
              (elevation_gain IS NULL OR elevation_loss IS NULL OR 
               max_elevation IS NULL OR min_elevation IS NULL)
    ', staging_schema);
    
    -- Check for duplicate nodes within tolerance
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Node uniqueness'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' duplicate nodes within tolerance'' as details,
            ''WARNING'' as severity
        FROM (
            SELECT COUNT(*) as dup_count
            FROM %I.routing_nodes n1
            JOIN %I.routing_nodes n2 ON (
                n1.id != n2.id AND
                ST_DWithin(
                    ST_SetSRID(ST_Point(n1.lng, n1.lat), 4326),
                    ST_SetSRID(ST_Point(n2.lng, n2.lat), 4326),
                    0.001
                )
            )
        ) duplicates
        WHERE dup_count > 0
    ', staging_schema, staging_schema);
    
    -- Validate edge connectivity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edge connectivity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges with invalid node connections'' as details,
            ''ERROR'' as severity
        FROM %I.routing_edges e
        LEFT JOIN %I.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN %I.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
    ', staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Add spatial index creation statements for geometry columns and routing nodes
-- These should be run after table creation in your schema setup
-- Example:
-- CREATE INDEX IF NOT EXISTS idx_trails_geometry ON trails USING GIST(geometry);
-- CREATE INDEX IF NOT EXISTS idx_routing_nodes_geometry ON routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));

-- Example usage of ST_Envelope for efficient bbox calculations:
-- SELECT * FROM trails WHERE ST_Within(geometry, ST_Envelope(ST_MakeEnvelope(-105.8, 39.7, -105.1, 40.7, 4326)));

-- Example usage of ST_LineMerge after node splitting:
-- SELECT ST_LineMerge(ST_Node(geometry)) FROM trails WHERE ...;

-- In detect_trail_intersections, you can add a CTE for bbox pre-filtering using ST_Envelope if needed.
-- Example usage:
-- SELECT * FROM detect_trail_intersections('staging_boulder_1234567890.trails', 2.0);
-- SELECT build_routing_nodes('staging_boulder_1234567890', 'trails', 2.0);
-- SELECT build_routing_edges('staging_boulder_1234567890', 'trails');
-- SELECT * FROM get_intersection_stats('staging_boulder_1234567890');
-- SELECT * FROM validate_intersection_detection('staging_boulder_1234567890');
-- SELECT * FROM validate_spatial_data_integrity('staging_boulder_1234567890'); 