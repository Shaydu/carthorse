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
    trails_schema text,
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
            FROM %I.%I
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
    ', trails_schema, trails_table)
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
    dyn_sql text;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);

    -- Build the dynamic SQL
    dyn_sql := format(
        'INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
         WITH trail_endpoints AS (
             SELECT 
                 ST_StartPoint(ST_Force2D(geometry)) as start_point,
                 ST_EndPoint(ST_Force2D(geometry)) as end_point,
                 app_uuid,
                 name
             FROM %I.%I
             WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
         ),
         intersection_points AS (
             SELECT 
                 intersection_point,
                 intersection_point_3d,
                 connected_trail_ids,
                 connected_trail_names,
                 node_type,
                 distance_meters
             FROM %I.detect_trail_intersections(''%I'', ''%I'', GREATEST($1, 0.001))
             WHERE array_length(connected_trail_ids, 1) > 1
         ),
         all_nodes AS (
             SELECT 
                 intersection_point as point,
                 intersection_point_3d as point_3d,
                 connected_trail_names as connected_trails,
                 ''intersection'' as node_type
             FROM intersection_points
             UNION ALL
             SELECT 
                 start_point as point,
                 ST_Force3D(start_point) as point_3d,
                 ARRAY[name] as connected_trails,
                 ''endpoint'' as node_type
             FROM trail_endpoints
             UNION ALL
             SELECT 
                 end_point as point,
                 ST_Force3D(end_point) as point_3d,
                 ARRAY[name] as connected_trails,
                 ''endpoint'' as node_type
             FROM trail_endpoints
         ),
         grouped_nodes AS (
             SELECT 
                 ST_X(point) as lng,
                 ST_Y(point) as lat,
                 COALESCE(ST_Z(point_3d), 0) as elevation,
                 array_agg(DISTINCT ct) as all_connected_trails,
                 CASE 
                     WHEN array_length(array_agg(DISTINCT ct), 1) > 1 THEN ''intersection''
                     ELSE ''endpoint''
                 END as node_type,
                 point,
                 point_3d
             FROM all_nodes
             CROSS JOIN LATERAL unnest(connected_trails) AS ct
             GROUP BY point, point_3d
         ),
         final_nodes AS (
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
         WHERE array_length(all_connected_trails, 1) > 0',
        staging_schema, staging_schema, trails_table, staging_schema, staging_schema, trails_table
    );
    RAISE NOTICE 'build_routing_nodes SQL: %', dyn_sql;
    EXECUTE dyn_sql USING intersection_tolerance_meters;

    -- Get the count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;

    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Enhanced function to build routing edges using optimized spatial operations
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text,
    tolerance_meters float DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    edge_count integer;
    dyn_sql text;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);

    -- Build the dynamic SQL
    dyn_sql := format(
        'INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
         WITH trail_segments AS (
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
               AND ST_Length(geometry) > 0.1
         ),
         node_connections AS (
             SELECT 
                 ts.id as trail_id,
                 ts.app_uuid as trail_uuid,
                 ts.name as trail_name,
                 ts.length_km,
                 ts.elevation_gain,
                 ts.geometry,
                 (SELECT n.id FROM %I.routing_nodes n WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)), GREATEST($1, 0.001)) ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326))) LIMIT 1) as from_node_id,
                 (SELECT n.id FROM %I.routing_nodes n WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326)), GREATEST($1, 0.001)) ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_Point(n.lng, n.lat), 4326))) LIMIT 1) as to_node_id
             FROM trail_segments ts
         ),
         valid_edges AS (
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
                 COALESCE(elevation_gain, 0) as elevation_gain
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
         ORDER BY trail_id',
        staging_schema, staging_schema, trails_table, staging_schema, staging_schema
    );
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql USING tolerance_meters;

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
    
    -- Get node and edge counts, cast all COUNT(*) to integer
    RETURN QUERY EXECUTE format('
        SELECT 
            (SELECT COUNT(*)::integer FROM %I.routing_nodes) as total_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_nodes WHERE node_type = ''intersection'') as intersection_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_nodes WHERE node_type = ''endpoint'') as endpoint_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_edges) as total_edges,
            CASE 
                WHEN $1 > 0 THEN (SELECT COUNT(*) FROM %I.routing_nodes)::float / $1
                ELSE 0
            END as node_to_trail_ratio,
            (EXTRACT(EPOCH FROM (clock_timestamp() - $2::timestamp)) * 1000)::integer as processing_time_ms
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
    details text
) AS $$
BEGIN
    -- Geometry validity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Geometry validity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' invalid geometries found'' as details
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry)
    ', staging_schema);

    -- Coordinate system consistency (SRID 4326)
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Coordinate system consistency'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' geometries with wrong SRID'' as details
        FROM %I.trails 
        WHERE geometry IS NOT NULL AND ST_SRID(geometry) != 4326
    ', staging_schema);

    -- Intersection node connections
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Intersection node connections'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' intersection nodes with <2 connected trails'' as details
        FROM %I.routing_nodes 
        WHERE node_type = ''intersection'' AND 
              array_length(string_to_array(connected_trails, '',''), 1) < 2
    ', staging_schema);

    -- Edge connectivity
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Edge connectivity'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' edges with invalid node connections'' as details
        FROM %I.routing_edges e
        LEFT JOIN %I.routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN %I.routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
    ', staging_schema, staging_schema, staging_schema);

    -- Spatial containment (move aggregates to a subquery)
    RETURN QUERY EXECUTE format('
        WITH bbox AS (
            SELECT 
                MIN(bbox_min_lng) AS min_lng,
                MIN(bbox_min_lat) AS min_lat,
                MAX(bbox_max_lng) AS max_lng,
                MAX(bbox_max_lat) AS max_lat
            FROM %I.trails
        )
        SELECT 
            ''Spatial containment'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''WARNING'' END as status,
            COUNT(*)::text || '' trails outside region bbox'' as details
        FROM %I.trails t, bbox
        WHERE t.geometry IS NOT NULL AND NOT ST_Within(
            t.geometry, 
            ST_MakeEnvelope(bbox.min_lng, bbox.min_lat, bbox.max_lng, bbox.max_lat, 4326)
        )
    ', staging_schema, staging_schema);
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

-- Example usage of ST_UnaryUnion for advanced geometry union operations:
-- SELECT ST_UnaryUnion(geometry) FROM trails WHERE region = 'boulder';

-- Example usage of ST_Collect for geometry collection:
-- SELECT ST_Collect(geometry) FROM trails WHERE region = 'boulder';
-- Example usage of ST_ClosestPoint for finding the closest point on a geometry:
-- SELECT ST_ClosestPoint(trail1.geometry, trail2.geometry) FROM trails trail1, trails trail2 WHERE trail1.id != trail2.id;

-- In detect_trail_intersections, you can add a CTE for bbox pre-filtering using ST_Envelope if needed.
-- Example usage:
-- SELECT * FROM detect_trail_intersections('staging_boulder_1234567890.trails', 2.0);
-- SELECT build_routing_nodes('staging_boulder_1234567890', 'trails', 2.0);
-- SELECT build_routing_edges('staging_boulder_1234567890', 'trails');
-- SELECT * FROM get_intersection_stats('staging_boulder_1234567890');
-- SELECT * FROM validate_intersection_detection('staging_boulder_1234567890');
-- SELECT * FROM validate_spatial_data_integrity('staging_boulder_1234567890'); 

-- Function to split all trails at intersection points using ST_Node in 3D
-- Returns one row per segment with original trail id, segment number, and geometry (always 3D)
CREATE OR REPLACE FUNCTION split_trails_at_intersections(
    trails_schema text,
    trails_table text
) RETURNS TABLE (
    original_trail_id integer,
    segment_number integer,
    geometry geometry
) AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT 
            t.id as original_trail_id,
            row_number() OVER (PARTITION BY t.id ORDER BY (ST_Dump(ST_Node(ST_Force3D(t.geometry)))).geom)::integer as segment_number,
            (ST_Dump(ST_Node(ST_Force3D(t.geometry)))).geom as geometry
        FROM %I.%I t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
    ', trails_schema, trails_table);
END;
$$ LANGUAGE plpgsql; 