-- PostGIS Functions for Intersection Detection and Routing Graph Building
-- These functions abstract the complex intersection detection logic into reusable PostGIS functions

-- Enable PostGIS extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Function to detect all intersections between trails in a table
-- Returns a table of intersection points with connected trail information
CREATE OR REPLACE FUNCTION detect_trail_intersections(
    trails_table text,
    intersection_tolerance_meters float DEFAULT 2.0
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
        WITH all_trails AS (
            -- Collect all trail geometries for ST_Node analysis
            SELECT ST_Collect(geometry) as all_geometries
            FROM %I
            WHERE geometry IS NOT NULL
        ),
        intersection_nodes AS (
            -- Use ST_Node() to automatically find all intersection points
            SELECT 
                point as intersection_point,
                ST_Force3D(point) as intersection_point_3d,
                ''intersection'' as node_type,
                0 as distance_meters
            FROM (
                SELECT (ST_Dump(ST_Node(all_geometries))).geom as point
                FROM all_trails
            ) nodes
            WHERE ST_GeometryType(point) = ''ST_Point''
        ),
        near_miss_intersections AS (
            -- Find near-miss intersections using ST_ClosestPoint
            SELECT DISTINCT
                ST_ClosestPoint(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as intersection_point,
                ST_Force3D(ST_ClosestPoint(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)), 0) as intersection_point_3d,
                ''near_miss'' as node_type,
                ST_Distance(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) as distance_meters
            FROM %I t1
            JOIN %I t2 ON (
                t1.id < t2.id AND 
                NOT ST_Intersects(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)) AND
                ST_DWithin(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry), $1)
            )
        ),
        all_intersections AS (
            SELECT * FROM intersection_nodes
            UNION ALL
            SELECT * FROM near_miss_intersections
            WHERE distance_meters <= $1
        ),
        connected_trails AS (
            -- Find which trails connect to each intersection point
            SELECT 
                ai.intersection_point,
                ai.intersection_point_3d,
                ai.node_type,
                ai.distance_meters,
                array_agg(t.id) as connected_trail_ids,
                array_agg(t.name) as connected_trail_names
            FROM all_intersections ai
            JOIN %I t ON ST_DWithin(
                ai.intersection_point,
                ST_Force2D(t.geometry),
                GREATEST(0.001, $1 / 1000)  -- Use tolerance or 1mm, whichever is larger
            )
            GROUP BY ai.intersection_point, ai.intersection_point_3d, ai.node_type, ai.distance_meters
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            CASE 
                WHEN array_length(connected_trail_ids, 1) > 1 THEN ''intersection''
                ELSE ''endpoint''
            END as node_type,
            distance_meters
        FROM connected_trails
        ORDER BY distance_meters, intersection_point
    ', trails_table, trails_table, trails_table, trails_table)
    USING intersection_tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- Function to build routing nodes from intersection points
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
    
    -- Insert routing nodes from intersection detection
    EXECUTE format('
        INSERT INTO %I.routing_nodes (node_uuid, lat, lng, elevation, node_type, connected_trails)
        WITH intersection_data AS (
            SELECT * FROM detect_trail_intersections(''%I'', $1)
        ),
        grouped_intersections AS (
            -- Group nearby intersection points to avoid duplicates
            SELECT 
                ST_X(intersection_point) as lng,
                ST_Y(intersection_point) as lat,
                COALESCE(ST_Z(intersection_point_3d), 0) as elevation,
                node_type,
                array_agg(DISTINCT unnest(connected_trail_ids)) as all_connected_trails,
                array_agg(DISTINCT unnest(connected_trail_names)) as all_connected_names,
                MIN(distance_meters) as min_distance
            FROM intersection_data
            GROUP BY 
                ST_X(intersection_point),
                ST_Y(intersection_point),
                COALESCE(ST_Z(intersection_point_3d), 0),
                node_type
        ),
        trail_endpoints AS (
            -- Get start and end points of all trails
            SELECT 
                app_uuid,
                ST_X(ST_StartPoint(geometry)) as lng,
                ST_Y(ST_StartPoint(geometry)) as lat,
                COALESCE(ST_Z(ST_StartPoint(geometry)), 0) as elevation,
                ''start'' as point_type
            FROM %I.%I 
            WHERE geometry IS NOT NULL
            
            UNION ALL
            
            SELECT 
                app_uuid,
                ST_X(ST_EndPoint(geometry)) as lng,
                ST_Y(ST_EndPoint(geometry)) as lat,
                COALESCE(ST_Z(ST_EndPoint(geometry)), 0) as elevation,
                ''end'' as point_type
            FROM %I.%I 
            WHERE geometry IS NOT NULL
        ),
        all_points AS (
            -- Combine intersection points and endpoints
            SELECT 
                lng, lat, elevation, node_type, all_connected_trails, all_connected_names
            FROM grouped_intersections
            
            UNION ALL
            
            -- Add endpoints only if they''re not already covered by intersections
            SELECT 
                te.lng, te.lat, te.elevation, 
                ''endpoint'' as node_type,
                ARRAY[te.app_uuid] as all_connected_trails,
                ARRAY[''Unknown Trail''] as all_connected_names
            FROM trail_endpoints te
            WHERE NOT EXISTS (
                SELECT 1 FROM grouped_intersections gi 
                WHERE ST_DWithin(
                    ST_SetSRID(ST_Point(te.lng, te.lat), 4326), 
                    ST_SetSRID(ST_Point(gi.lng, gi.lat), 4326), 
                    0.001
                )
            )
        ),
        final_nodes AS (
            -- Final grouping to determine node types
            SELECT 
                lng, lat, elevation,
                CASE 
                    WHEN array_length(array_agg(DISTINCT unnest(all_connected_trails)), 1) > 1 THEN ''intersection''
                    ELSE ''endpoint''
                END as node_type,
                array_agg(DISTINCT unnest(all_connected_trails)) as connected_trails,
                array_agg(DISTINCT unnest(all_connected_names)) as connected_names
            FROM all_points
            GROUP BY lng, lat, elevation
        )
        SELECT 
            gen_random_uuid()::text as node_uuid,
            lat,
            lng,
            elevation,
            node_type,
            array_to_string(connected_trails, '','') as connected_trails
        FROM final_nodes
    ', staging_schema, trails_table, staging_schema, trails_table, staging_schema, trails_table)
    USING intersection_tolerance_meters;
    
    -- Get the count of inserted nodes
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    RETURN node_count;
END;
$$ LANGUAGE plpgsql;

-- Function to build routing edges from trail segments
CREATE OR REPLACE FUNCTION build_routing_edges(
    staging_schema text,
    trails_table text
) RETURNS integer AS $$
DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Insert routing edges using PostGIS network analysis
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain)
        WITH merged_network AS (
            -- Create a unified network using PostGIS functions
            SELECT ST_LineMerge(ST_UnaryUnion(ST_Collect(geometry))) as network
            FROM %I.%I
            WHERE geometry IS NOT NULL
        ),
        network_edges AS (
            -- Extract individual edges from the merged network
            SELECT 
                (ST_Dump(network)).geom as edge_geometry
            FROM merged_network
            WHERE ST_GeometryType(network) = ''ST_LineString''
        ),
        edge_nodes AS (
            -- Find which nodes connect to each edge
            SELECT 
                ne.edge_geometry,
                n1.id as from_node_id,
                n2.id as to_node_id
            FROM network_edges ne
            JOIN %I.routing_nodes n1 ON ST_DWithin(
                ST_StartPoint(ne.edge_geometry), 
                ST_SetSRID(ST_Point(n1.lng, n1.lat), 4326), 
                0.001
            )
            JOIN %I.routing_nodes n2 ON ST_DWithin(
                ST_EndPoint(ne.edge_geometry), 
                ST_SetSRID(ST_Point(n2.lng, n2.lat), 4326), 
                0.001
            )
            WHERE n1.id != n2.id
        ),
        trail_mapping AS (
            -- Map edges back to original trails
            SELECT 
                en.from_node_id,
                en.to_node_id,
                t.app_uuid as trail_id,
                t.name as trail_name,
                t.length_km,
                t.elevation_gain
            FROM edge_nodes en
            JOIN %I.%I t ON ST_DWithin(en.edge_geometry, t.geometry, 0.001)
        )
        SELECT DISTINCT
            from_node_id,
            to_node_id,
            trail_id,
            trail_name,
            length_km as distance_km,
            elevation_gain
        FROM trail_mapping
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema, staging_schema, trails_table);
    
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

-- Function to validate intersection detection results
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

-- Example usage:
-- SELECT * FROM detect_trail_intersections('staging_boulder_1234567890.trails', 2.0);
-- SELECT build_routing_nodes('staging_boulder_1234567890', 'trails', 2.0);
-- SELECT build_routing_edges('staging_boulder_1234567890', 'trails');
-- SELECT * FROM get_intersection_stats('staging_boulder_1234567890');
-- SELECT * FROM validate_intersection_detection('staging_boulder_1234567890'); 