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
                    SELECT id, app_uuid, name, ST_Force2D(geometry) as geo2_2d
        FROM %I.%I
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            SELECT 
                ST_Node(ST_Collect(geo2_2d)) as nodes
            FROM trail_geometries
        ),
        exploded_nodes AS (
            SELECT (ST_Dump(nodes)).geom as point
            FROM intersection_points
        ),
        node_connections AS (
            SELECT 
                en.point,
                array_agg(tg.app_uuid) as connected_trail_ids,
                array_agg(tg.name) as connected_trail_names,
                COUNT(*) as connection_count
            FROM exploded_nodes en
            JOIN trail_geometries tg ON ST_DWithin(en.point, tg.geo2_2d, $1)
            GROUP BY en.point
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
    intersection_tolerance_meters double precision DEFAULT 2.0
) RETURNS integer AS $$
DECLARE
    node_count integer := 0;
    dyn_sql text;
BEGIN
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    dyn_sql := format($f$
        INSERT INTO %I.routing_nodes (lat, lng, elevation, node_type, connected_trails)
        WITH trail_endpoints AS (
            SELECT ST_StartPoint(geometry) as start_point, ST_EndPoint(geometry) as end_point, app_uuid, name
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_points AS (
            SELECT intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters
            FROM detect_trail_intersections('%I', '%I', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1
        ),
        all_nodes AS (
            SELECT intersection_point as point, intersection_point_3d as point_3d, connected_trail_names as connected_trails, 'intersection' as node_type FROM intersection_points
            UNION ALL
            SELECT start_point as point, ST_Force3D(start_point) as point_3d, ARRAY[name] as connected_trails, 'endpoint' as node_type FROM trail_endpoints
            UNION ALL
            SELECT end_point as point, ST_Force3D(end_point) as point_3d, ARRAY[name] as connected_trails, 'endpoint' as node_type FROM trail_endpoints
        ),
        grouped_nodes AS (
            SELECT 
                ST_X(point) as lng, 
                ST_Y(point) as lat, 
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT ct) as all_connected_trails,
                CASE WHEN array_length(array_agg(DISTINCT ct), 1) > 1 THEN 'intersection' ELSE 'endpoint' END as node_type,
                point, point_3d
            FROM all_nodes
            CROSS JOIN LATERAL unnest(connected_trails) AS ct
            GROUP BY point, point_3d
        ),
        final_nodes AS (
            SELECT DISTINCT ON (point) lng, lat, elevation, all_connected_trails, node_type
            FROM grouped_nodes
            ORDER BY point, array_length(all_connected_trails, 1) DESC
        )
        SELECT lat, lng, elevation, node_type, array_to_string(all_connected_trails, ',') as connected_trails
        FROM final_nodes
        WHERE array_length(all_connected_trails, 1) > 0
    $f$, staging_schema, staging_schema, trails_table, staging_schema, trails_table);
    RAISE NOTICE 'build_routing_nodes SQL: %', dyn_sql;
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
        WITH trail_segments AS (
            SELECT id, app_uuid, name, ST_Force2D(geometry) as geo2_2d, length_km, elevation_gain,
                   ST_StartPoint(ST_Force2D(geometry)) as start_point, ST_EndPoint(ST_Force2D(geometry)) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry) AND ST_Length(geometry) > 0.1
        ),
        node_connections AS (
            SELECT ts.id as trail_id, ts.app_uuid as trail_uuid, ts.name as trail_name, ts.length_km, ts.elevation_gain, ts.geo2_2d,
                   fn.id as from_node_id, tn.id as to_node_id, fn.lat as from_lat, fn.lng as from_lng, tn.lat as to_lat, tn.lng as to_lng
            FROM trail_segments ts
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.start_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %s)
                ORDER BY ST_Distance(ST_Force2D(ts.start_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) fn ON true
            LEFT JOIN LATERAL (
                SELECT n.id, n.lat, n.lng
                FROM %I.routing_nodes n
                WHERE ST_DWithin(ST_Force2D(ts.end_point), ST_Force2D(ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)), %s)
                ORDER BY ST_Distance(ST_Force2D(ts.end_point), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326))
                LIMIT 1
            ) tn ON true
        ),
        valid_edges AS (
            SELECT trail_id, trail_uuid, trail_name, length_km, elevation_gain, geo2_2d, from_node_id, to_node_id, from_lat, from_lng, to_lat, to_lng
            FROM node_connections
            WHERE from_node_id IS NOT NULL AND to_node_id IS NOT NULL AND from_node_id <> to_node_id
        ),
        edge_metrics AS (
            SELECT trail_id, trail_uuid, trail_name, from_node_id, to_node_id,
                   COALESCE(length_km, ST_Length(geo2_2d::geography) / 1000) as distance_km,
                   COALESCE(elevation_gain, 0) as elevation_gain,
                   ST_MakeLine(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326), ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326)) as geo2
            FROM valid_edges
        )
        SELECT from_node_id, to_node_id, trail_uuid as trail_id, trail_name, distance_km, elevation_gain, geo2
        FROM edge_metrics
        ORDER BY trail_id
    $f$, staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance);
    RAISE NOTICE 'build_routing_edges SQL: %', dyn_sql;
    EXECUTE dyn_sql;
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
    avg_connections_per_node numeric
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            COUNT(*) as total_nodes,
            COUNT(*) FILTER (WHERE node_type = 'intersection') as intersection_nodes,
            COUNT(*) FILTER (WHERE node_type = 'endpoint') as endpoint_nodes,
            (SELECT COUNT(*) FROM %I.routing_edges) as total_edges,
            ROUND(AVG(array_length(string_to_array(connected_trails, ','), 1)), 2) as avg_connections_per_node
        FROM %I.routing_nodes
    $f$, staging_schema, staging_schema);
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
        WHERE geo2 IS NOT NULL AND NOT ST_IsValid(geo2)
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

-- Function to split all trails at intersection points using ST_Node in 3D
-- Returns one row per segment with original trail id, segment number, and geometry (always 3D)
CREATE OR REPLACE FUNCTION public.split_trails_at_intersections(
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