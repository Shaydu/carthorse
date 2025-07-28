-- PostGIS Intersection Detection Functions for Carthorse
-- These functions provide optimized spatial operations for trail intersection detection

-- Function to detect trail intersections using PostGIS spatial operations
CREATE OR REPLACE FUNCTION detect_trail_intersections(
    staging_schema text,
    trails_table text,
    tolerance_meters double precision DEFAULT 2.0
) RETURNS TABLE (
    intersection_point geometry,
    intersection_point_3d geometry,
    connected_trail_ids text[],
    connected_trail_names text[],
    node_type text,
    distance_meters double precision
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH trail_geometries AS (
            SELECT id, app_uuid, name, ST_Force2D(geometry) as geometry_2d
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            SELECT 
                ST_Node(ST_Collect(geometry_2d)) as nodes
            FROM trail_geometries
        ),
        exploded_nodes AS (
            SELECT (ST_Dump(nodes)).geom as line_segment
            FROM intersection_points
        ),
        intersection_nodes AS (
            SELECT DISTINCT ST_StartPoint(line_segment) as point
            FROM exploded_nodes
            UNION
            SELECT DISTINCT ST_EndPoint(line_segment) as point
            FROM exploded_nodes
        ),
        node_connections AS (
            SELECT 
                int_nodes.point,
                array_agg(tg.app_uuid) as connected_trail_ids,
                array_agg(tg.name) as connected_trail_names,
                COUNT(*) as connection_count
            FROM intersection_nodes int_nodes
            JOIN trail_geometries tg ON ST_DWithin(int_nodes.point, tg.geometry_2d, $1)
            GROUP BY int_nodes.point
        )
        SELECT 
            point as intersection_point,
            ST_Force3D(point) as intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            CASE WHEN connection_count > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
            $1 as distance_meters
        FROM node_connections
        WHERE connection_count > 0
    $f$, staging_schema, trails_table) USING tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- Function to build routing nodes from trail intersections and endpoints
CREATE OR REPLACE FUNCTION build_routing_nodes(
    staging_schema text,
    trails_table text,
    intersection_tolerance_meters double precision DEFAULT 2.0,
    use_intersection_nodes boolean DEFAULT true
) RETURNS integer AS $$
DECLARE
    node_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Step 1: Insert intersection nodes from detect_trail_intersections result (only if enabled)
    IF use_intersection_nodes THEN
        dyn_sql := format($f$
            INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails, node_uuid)
            SELECT
                ST_Y(intersection_point),
                ST_X(intersection_point),
                COALESCE(ST_Z(intersection_point_3d), 0),
                node_type,
                array_to_string(connected_trail_names, ','),
                gen_random_uuid()
            FROM public.detect_trail_intersections('%I', '%I', $1)
            WHERE array_length(connected_trail_names, 1) > 1;
        $f$, staging_schema, staging_schema, trails_table);
        EXECUTE dyn_sql USING intersection_tolerance_meters;
    END IF;
    
    -- Step 2: Insert endpoint nodes not at intersections
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails, node_uuid)
        WITH trail_endpoints AS (
            SELECT
                ST_StartPoint(ST_Force2D(geometry)) as point,
                app_uuid
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
            UNION ALL
            SELECT
                ST_EndPoint(ST_Force2D(geometry)) as point,
                app_uuid
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        unique_endpoints AS (
            SELECT DISTINCT ON (ST_AsText(point))
                point,
                array_agg(DISTINCT app_uuid) as connected_trails
            FROM trail_endpoints
            GROUP BY point
        ),
        endpoints_not_at_intersections AS (
            SELECT ue.point, ue.connected_trails
            FROM unique_endpoints ue
            WHERE NOT EXISTS (
                SELECT 1 FROM %I.routing_nodes rn
                WHERE rn.node_type = 'intersection'
                  AND ST_DWithin(ue.point, ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326), $1)
            )
        )
        SELECT
            ST_Y(point) as lat,
            ST_X(point) as lng,
            0 as elevation,
            'endpoint' as node_type,
            array_to_string(connected_trails, ','),
            gen_random_uuid()
        FROM endpoints_not_at_intersections
        WHERE point IS NOT NULL;
    $f$, staging_schema, staging_schema, trails_table, staging_schema, trails_table, staging_schema);
    EXECUTE dyn_sql USING intersection_tolerance_meters;
    
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Function to build routing edges connecting nodes
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text,
    edge_tolerance double precision DEFAULT 20.0
) RETURNS integer AS $$
DECLARE
    edge_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, geometry)
        WITH trail_geometries AS (
            SELECT id, app_uuid, name, ST_Force2D(geometry) as geometry_2d, length_km, elevation_gain
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry) AND ST_Length(geometry::geography) > 0.1
        ),
        split_trails AS (
            SELECT 
                t.id,
                t.app_uuid,
                t.name,
                t.length_km,
                t.elevation_gain,
                (ST_Dump(ST_Node(t.geometry_2d))).geom as split_segment
            FROM trail_geometries t
        ),
        trail_segments AS (
            SELECT 
                id, app_uuid, name, length_km, elevation_gain,
                split_segment as geometry_2d,
                ST_StartPoint(split_segment) as start_point, 
                ST_EndPoint(split_segment) as end_point
            FROM split_trails
            WHERE ST_Length(split_segment::geography) > 0.1
        ),
        node_connections AS (
            SELECT ts.id as trail_id, ts.app_uuid as trail_uuid, ts.name as trail_name, ts.length_km, ts.elevation_gain, ts.geometry_2d,
                   fn.id as from_node_id, tn.id as to_node_id, fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM trail_segments ts
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %L)
                  AND n.id IS NOT NULL
                ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %L)
                  AND n.id IS NOT NULL
                ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, geometry_2d, from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
              AND from_node_id IN (SELECT id FROM %I.routing_nodes)
              AND to_node_id IN (SELECT id FROM %I.routing_nodes)
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geometry_2d::geography) / 1000) as distance_km,
                   COALESCE(elevation_gain, 0) as elevation_gain,
                   ST_Force3D(ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326))) as geometry
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid as trail_id, trail_name, distance_km, elevation_gain, geometry
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance, staging_schema, staging_schema);
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    RETURN edge_count;
END;
$$ LANGUAGE plpgsql;

-- Function to replace trails table with split trails using PostGIS native functions
CREATE OR REPLACE FUNCTION replace_trails_with_split_trails(
    staging_schema text,
    trails_table text
) RETURNS integer AS $$
DECLARE
    segment_count integer := 0;
    original_count integer := 0;
BEGIN
    -- Get count of original trails
    EXECUTE format('SELECT COUNT(*) FROM %I.%I', staging_schema, trails_table) INTO original_count;
    
    -- Create temporary table with split trails
    EXECUTE format('DROP TABLE IF EXISTS %I.temp_split_trails', staging_schema);
    EXECUTE format($f$
        CREATE TABLE %I.temp_split_trails AS
        WITH trail_geometries AS (
            SELECT id, app_uuid, name, trail_type, surface, difficulty, source_tags, osm_id,
                   elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                   length_km, source, geometry, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        -- Use ST_Node() to split all trails at intersection points (PostGIS native)
        split_trails AS (
            SELECT 
                t.id as original_trail_id,
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
                t.length_km,
                t.source,
                t.bbox_min_lng,
                t.bbox_max_lng,
                t.bbox_min_lat,
                t.bbox_max_lat,
                -- Use ST_Dump() to get individual segments from ST_Node() result
                (ST_Dump(ST_Node(ST_Force2D(t.geometry)))).geom as split_segment,
                ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY (ST_Dump(ST_Node(ST_Force2D(t.geometry)))).path) as segment_number
            FROM trail_geometries t
        )
        SELECT 
            -- Generate new unique app_uuid for each segment
            gen_random_uuid()::text as app_uuid,
            original_trail_id,
            segment_number,
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
            -- Use ST_Length() to calculate segment length
            COALESCE(length_km, ST_Length(split_segment::geography) / 1000) as length_km,
            source,
            -- Use ST_Force3D() to preserve elevation data
            ST_Force3D(split_segment) as geometry,
            -- Use ST_XMin/ST_XMax/ST_YMin/ST_YMax for bbox calculation
            ST_XMin(split_segment) as bbox_min_lng,
            ST_XMax(split_segment) as bbox_max_lng,
            ST_YMin(split_segment) as bbox_min_lat,
            ST_YMax(split_segment) as bbox_max_lat
        FROM split_trails
        -- Filter out very short segments using ST_Length()
        WHERE ST_Length(split_segment::geography) > 0.1
        ORDER BY original_trail_id, segment_number
    $f$, staging_schema, staging_schema, trails_table);
    
    -- Replace original trails table with split trails (use CASCADE to handle dependencies)
    EXECUTE format('DROP TABLE %I.%I CASCADE', staging_schema, trails_table);
    EXECUTE format('ALTER TABLE %I.temp_split_trails RENAME TO %I', staging_schema, trails_table);
    
    -- Recreate indexes on the new trails table
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_trails_geometry ON %I.%I USING GIST(geometry)', 
                   staging_schema, staging_schema, trails_table);
    
    -- Get count of created segments
    EXECUTE format('SELECT COUNT(*) FROM %I.%I', staging_schema, trails_table) INTO segment_count;
    
    RAISE NOTICE 'Replaced % original trails with % split trail segments', original_count, segment_count;
    RETURN segment_count;
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
    avg_connections_per_node numeric,
    node_to_trail_ratio numeric,
    processing_time_ms integer
) AS $$
DECLARE
    start_time timestamp;
    trail_count integer;
BEGIN
    start_time := clock_timestamp();
    
    -- Get trail count for ratio calculation
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO trail_count;
    
    RETURN QUERY EXECUTE format($f$
        SELECT 
            COUNT(*)::integer as total_nodes,
            COUNT(*) FILTER (WHERE node_type = 'intersection')::integer as intersection_nodes,
            COUNT(*) FILTER (WHERE node_type = 'endpoint')::integer as endpoint_nodes,
            (SELECT COUNT(*)::integer FROM %I.routing_edges) as total_edges,
            ROUND(AVG(array_length(string_to_array(connected_trails, ','), 1)), 2) as avg_connections_per_node,
            CASE 
                WHEN $1 > 0 THEN ROUND(COUNT(*)::numeric / $1, 4)
                ELSE 0
            END as node_to_trail_ratio,
            EXTRACT(EPOCH FROM (clock_timestamp() - $2::timestamp)) * 1000::integer as processing_time_ms
        FROM %I.routing_nodes
    $f$, staging_schema, staging_schema) USING trail_count, start_time;
END;
$$ LANGUAGE plpgsql;

-- Function to validate intersection detection quality
CREATE OR REPLACE FUNCTION validate_intersection_detection(
    staging_schema text
) RETURNS TABLE (
    validation_check text,
    status text,
    count integer,
    details text
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            'Node-to-Trail Ratio'::text as validation_check,
            CASE 
                WHEN COUNT(*)::float / (SELECT COUNT(*) FROM %I.trails) < 0.5 THEN 'PASS'::text
                ELSE 'WARN'::text
            END as status,
            COUNT(*) as count,
            'Nodes should be < 50%% of trails for efficient routing'::text as details
        FROM %I.routing_nodes
        UNION ALL
        SELECT 
            'Self-Loop Edges'::text as validation_check,
            CASE WHEN COUNT(*) = 0 THEN 'PASS'::text ELSE 'FAIL'::text END as status,
            COUNT(*) as count,
            'Edges should not connect a node to itself'::text as details
        FROM %I.routing_edges
        WHERE from_node_id = to_node_id
        UNION ALL
        SELECT 
            'Orphaned Nodes'::text as validation_check,
            CASE WHEN COUNT(*) = 0 THEN 'PASS'::text ELSE 'WARN'::text END as status,
            COUNT(*) as count,
            'Nodes should be connected by at least one edge'::text as details
        FROM %I.routing_nodes rn
        WHERE NOT EXISTS (
            SELECT 1 FROM %I.routing_edges re 
            WHERE re.from_node_id = rn.id OR re.to_node_id = rn.id
        )
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);
END;
$$ LANGUAGE plpgsql;

-- Comprehensive spatial validation function for data integrity
CREATE OR REPLACE FUNCTION public.validate_spatial_data_integrity(
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

    -- Intersection node connections (updated: count distinct trails via routing_edges)
    RETURN QUERY EXECUTE format('
        SELECT 
            ''Intersection node connections'' as validation_check,
            CASE WHEN COUNT(*) = 0 THEN ''PASS'' ELSE ''FAIL'' END as status,
            COUNT(*)::text || '' intersection nodes with <2 connected trails'' as details
        FROM %I.routing_nodes n
        LEFT JOIN %I.routing_edges e ON n.id = e.from_node_id OR n.id = e.to_node_id
        WHERE n.node_type = ''intersection''
        GROUP BY n.id
        HAVING COUNT(DISTINCT e.trail_id) < 2
    ', staging_schema, staging_schema);

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

-- The split_trails_at_intersections function is deprecated and has been removed. 