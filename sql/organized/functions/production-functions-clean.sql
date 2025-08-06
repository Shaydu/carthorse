-- Carthorse Production Functions - Cleaned Version
-- Generated on: 2025-01-27
-- Database: trail_master_db
-- 
-- This file contains ONLY the functions that are actually used by the orchestrator
-- during SQLite export. All unused functions have been removed.
--

-- =============================================================================
-- CORE FUNCTIONS USED BY ORCHESTRATOR
-- =============================================================================

-- Function 1: detect_trail_intersections
-- Used by: generateRoutingGraph() in orchestrator
CREATE OR REPLACE FUNCTION public.detect_trail_intersections(
    trails_schema text,
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
        WITH noded_trails AS (
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            SELECT 
                ST_Intersection(t1.noded_geom, t2.noded_geom) as intersection_point,
                ST_Force3D(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                ST_Distance(t1.noded_geom::geography, t2.noded_geom::geography) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
            AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) = ''ST_Point''
        )
        SELECT 
            intersection_point,
            intersection_point_3d,
            connected_trail_ids,
            connected_trail_names,
            node_type,
            distance_meters
        FROM true_intersections
        WHERE distance_meters <= $1
    ', trails_schema, trails_table) USING intersection_tolerance_meters;
END;
$$ LANGUAGE plpgsql;

-- Function 2: copy_and_split_trails_to_staging_native_v16
-- Used by: copyRegionDataToStaging() in orchestrator
CREATE OR REPLACE FUNCTION public.copy_and_split_trails_to_staging_native_v16(
    staging_schema text, 
    source_table text, 
    region_filter text, 
    bbox_min_lng real DEFAULT NULL::real, 
    bbox_min_lat real DEFAULT NULL::real, 
    bbox_max_lng real DEFAULT NULL::real, 
    bbox_max_lat real DEFAULT NULL::real, 
    trail_limit integer DEFAULT NULL::integer, 
    tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text) AS $_$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
    source_query text;
    limit_clause text := '';
    full_sql text;
BEGIN
    -- Clear existing data
    EXECUTE format('DELETE FROM %I.trails', staging_schema);
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Build source query with filters
    RAISE NOTICE 'source_table: %, region_filter: %', source_table, region_filter;
    source_query := format('SELECT * FROM public.%I WHERE region = %L', source_table, region_filter);
    RAISE NOTICE 'source_query: %', source_query;
    
    -- Add bbox filter if provided
    IF bbox_min_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_max_lat IS NOT NULL THEN
        source_query := source_query || format(' AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))', bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat);
    END IF;
    
    -- Add limit
    IF trail_limit IS NOT NULL THEN
        limit_clause := format(' LIMIT %s', trail_limit);
    END IF;
    
    source_query := source_query || limit_clause;
    
    -- Build the full SQL dynamically
    full_sql := format($f$
        INSERT INTO %I.trails (
            app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
            geometry, created_at, updated_at
        )
        WITH trail_intersections AS (
            SELECT DISTINCT
                t1.app_uuid as trail1_uuid,
                t2.app_uuid as trail2_uuid,
                ST_Intersection(t1.geometry, t2.geometry) as intersection_point
            FROM (%s) t1
            JOIN (%s) t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        all_trails AS (
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).geom as split_geometry,
                (ST_Dump(ST_Split(at.geometry, ti.intersection_point))).path[1] as segment_order
            FROM all_trails at
            JOIN trail_intersections ti ON at.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
        ),
        trails_without_intersections AS (
            SELECT 
                at.id, at.app_uuid, at.osm_id, at.name, at.region, at.trail_type, at.surface, at.difficulty, at.source_tags,
                at.bbox_min_lng, at.bbox_max_lng, at.bbox_min_lat, at.bbox_max_lat,
                at.length_km, at.elevation_gain, at.elevation_loss, at.max_elevation, at.min_elevation, at.avg_elevation,
                at.source, at.created_at, at.updated_at, at.geometry,
                at.geometry as split_geometry,
                1 as segment_order
            FROM all_trails at
            WHERE at.app_uuid NOT IN (
                SELECT DISTINCT trail1_uuid FROM trail_intersections
                UNION
                SELECT DISTINCT trail2_uuid FROM trail_intersections
            )
        ),
        processed_trails AS (
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,
            osm_id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            source_tags,
            ST_XMin(split_geometry) as bbox_min_lng,
            ST_XMax(split_geometry) as bbox_max_lng,
            ST_YMin(split_geometry) as bbox_min_lat,
            ST_YMax(split_geometry) as bbox_max_lat,
            ST_Length(split_geometry::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)
          AND pt.app_uuid IS NOT NULL
    $f$, staging_schema, source_query, source_query, source_query);
    
    -- Execute the SQL
    EXECUTE full_sql;
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    -- Get original count from source query
    EXECUTE format('SELECT COUNT(*) FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)', source_query) INTO original_count_var;
    
    -- Step 2: Detect intersections between split trail segments
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
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ) AS intersections
    $f$, staging_schema, tolerance_meters, staging_schema, staging_schema);

    GET DIAGNOSTICS intersection_count_var = ROW_COUNT;

    -- Clear routing data in staging schema since it needs to be regenerated from split trails
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
        format('Successfully copied and split %s trails into %s segments with %s intersections (v16)',
               original_count_var, split_count_var, intersection_count_var) as message;

EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, 0, 0, false, 
        format('Error during copy and split (v16): %s', SQLERRM) as message;
END;
$_$ LANGUAGE plpgsql;

-- Function 3: generate_routing_nodes_native_v2_with_trail_ids
-- Used by: generateRoutingGraph() in orchestrator
CREATE OR REPLACE FUNCTION public.generate_routing_nodes_native_v2_with_trail_ids(
    staging_schema text, 
    intersection_tolerance_meters real DEFAULT 2.0
) RETURNS TABLE(node_count integer, success boolean, message text) AS $$
DECLARE
    node_count_var integer := 0;
    tolerance_degrees real := intersection_tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from actual trail endpoints and intersections with trail_ids
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
        WITH valid_trails AS (
            SELECT app_uuid, name, geometry
            FROM %I.trails 
            WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry) > 0
        ),
        trail_endpoints AS (
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM valid_trails
        ),
        all_endpoints AS (
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'endpoint' as node_type,
                name as connected_trails,
                ARRAY[app_uuid] as trail_ids
            FROM trail_endpoints
        ),
        intersection_points AS (
            SELECT 
                ip.intersection_point as point,
                COALESCE(ST_Z(ip.intersection_point_3d), 0) as elevation,
                'intersection' as node_type,
                array_to_string(ip.connected_trail_names, ',') as connected_trails,
                array_agg(t.app_uuid) as trail_ids
            FROM detect_trail_intersections($1, 'trails', $2) ip
            JOIN %I.trails t ON t.id = ANY(ip.connected_trail_ids)
            WHERE array_length(ip.connected_trail_ids, 1) > 1
            GROUP BY ip.intersection_point, ip.intersection_point_3d, ip.connected_trail_names
        ),
        all_nodes AS (
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM all_endpoints
            WHERE point IS NOT NULL
            UNION ALL
            SELECT point, elevation, node_type, connected_trails, trail_ids
            FROM intersection_points
            WHERE point IS NOT NULL
        ),
        unique_nodes AS (
            SELECT DISTINCT
                point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM all_nodes
            WHERE point IS NOT NULL
        ),
        clustered_nodes AS (
            SELECT 
                point as clustered_point,
                elevation,
                node_type,
                connected_trails,
                trail_ids
            FROM unique_nodes
            WHERE point IS NOT NULL
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            gen_random_uuid() as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            trail_ids,
            NOW() as created_at
        FROM clustered_nodes
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema)
    USING staging_schema, intersection_tolerance_meters;
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Generated %s routing nodes with trail_ids (v2, routable only, tolerance: %s m)', node_count_var, intersection_tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation with trail_ids (v2): %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql;

-- Function 4: generate_routing_edges_native_v2
-- Used by: generateRoutingGraph() in orchestrator
CREATE OR REPLACE FUNCTION generate_routing_edges_native_v2(staging_schema text, tolerance_meters real DEFAULT 1.0)
RETURNS TABLE(edge_count integer, success boolean, message text) AS $$
DECLARE
    edge_count_var integer := 0;
    node_count_var integer := 0;
    orphaned_count integer := 0;
    orphaned_edges_count integer := 0;
    tolerance_degrees real := tolerance_meters / 111000.0;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Get node count for validation
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count_var;
    
    -- Generate routing edges from actual trail geometry connectivity
    EXECUTE format($f$
        INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
        WITH trail_connectivity AS (
            SELECT DISTINCT
                t1.app_uuid as trail1_id,
                t1.name as trail1_name,
                t1.length_km as trail1_length,
                t1.elevation_gain as trail1_elevation_gain,
                t1.elevation_loss as trail1_elevation_loss,
                t1.geometry as trail1_geometry,
                t2.app_uuid as trail2_id,
                t2.name as trail2_name,
                t2.length_km as trail2_length,
                t2.elevation_gain as trail2_elevation_gain,
                t2.elevation_loss as trail2_elevation_loss,
                t2.geometry as trail2_geometry
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > 5
              AND ST_Length(t2.geometry::geography) > 5
        ),
        trail_segments AS (
            SELECT 
                t.app_uuid as trail_id,
                t.name as trail_name,
                t.length_km,
                t.elevation_gain,
                t.elevation_loss,
                t.geometry,
                start_node.id as source_node_id,
                start_node.node_uuid as source_node_uuid,
                end_node.id as target_node_id,
                end_node.node_uuid as target_node_uuid
            FROM %I.trails t
            LEFT JOIN %I.routing_nodes start_node ON 
                ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), %L)
                AND (start_node.trail_ids @> ARRAY[t.app_uuid] OR start_node.node_type = 'endpoint')
            LEFT JOIN %I.routing_nodes end_node ON 
                ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), %L)
                AND (end_node.trail_ids @> ARRAY[t.app_uuid] OR end_node.node_type = 'endpoint')
            WHERE t.geometry IS NOT NULL 
            AND ST_IsValid(t.geometry) 
            AND t.length_km > 0
            AND start_node.id IS NOT NULL 
            AND end_node.id IS NOT NULL
            AND start_node.id <> end_node.id
        )
        SELECT 
            source_node_id as source,
            target_node_id as target,
            trail_id,
            trail_name,
            length_km,
            elevation_gain,
            elevation_loss,
            geometry,
            ST_AsGeoJSON(geometry, 6, 0) as geojson
        FROM trail_segments
        WHERE source_node_id IS NOT NULL AND target_node_id IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, tolerance_degrees, staging_schema, tolerance_degrees);
    
    GET DIAGNOSTICS edge_count_var = ROW_COUNT;
    
    -- Clean up orphaned nodes (nodes that have no edges)
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.routing_edges 
            UNION 
            SELECT DISTINCT target FROM %I.routing_edges
        )
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS orphaned_count = ROW_COUNT;
    
    -- Clean up orphaned edges (edges that point to non-existent nodes)
    EXECUTE format($f$
        DELETE FROM %I.routing_edges 
        WHERE source NOT IN (SELECT id FROM %I.routing_nodes) 
        OR target NOT IN (SELECT id FROM %I.routing_nodes)
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        edge_count_var,
        true as success,
        format('Generated %s routing edges from %s nodes, cleaned up %s orphaned nodes and %s orphaned edges (v2, trail geometry connectivity, tolerance: %s m)', edge_count_var, node_count_var, orphaned_count, orphaned_edges_count, tolerance_meters) as message;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing edges generation (v2): %s', SQLERRM) as message;
END;
$$ LANGUAGE plpgsql;

-- Function 5: cleanup_orphaned_nodes
-- Used by: generateRoutingGraph() in orchestrator (called within edge generation)
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_nodes(staging_schema text)
RETURNS TABLE(success boolean, message text, cleaned_nodes integer) AS $$
DECLARE
    cleaned_count integer := 0;
BEGIN
    -- Remove nodes that have no connected edges
    EXECUTE format($f$
        DELETE FROM %I.routing_nodes 
        WHERE id NOT IN (
            SELECT DISTINCT source FROM %I.routing_edges 
            UNION 
            SELECT DISTINCT target FROM %I.routing_edges
        )
    $f$, staging_schema, staging_schema, staging_schema, staging_schema);
    
    GET DIAGNOSTICS cleaned_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        true as success,
        format('Cleaned up %s orphaned nodes', cleaned_count) as message,
        cleaned_count as cleaned_nodes;
        
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
        false as success,
        format('Error during orphaned nodes cleanup: %s', SQLERRM) as message,
        0 as cleaned_nodes;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- OPTIONAL FUNCTIONS (Route Recommendations)
-- =============================================================================

-- Function 6: generate_route_recommendations (Optional)
-- Used by: generateRouteRecommendations() in orchestrator
CREATE OR REPLACE FUNCTION public.generate_route_recommendations(staging_schema text) RETURNS integer AS $$
BEGIN
    RETURN generate_route_recommendations_configurable(staging_schema, 'unknown');
END;
$$ LANGUAGE plpgsql;

-- Function 7: find_routes_recursive_configurable (Supporting)
-- Called by: generate_route_recommendations_configurable()
CREATE OR REPLACE FUNCTION public.find_routes_recursive_configurable(staging_schema text, target_distance_km double precision, target_elevation_gain double precision, tolerance_percent double precision DEFAULT NULL::double precision, max_depth integer DEFAULT 8)
 RETURNS TABLE(route_id text, start_node integer, end_node integer, total_distance_km double precision, total_elevation_gain double precision, route_path integer[], route_edges integer[], route_shape text, trail_count integer, similarity_score double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
    config_tolerance float;
    distance_limits json;
    elevation_limits json;
BEGIN
    -- Get configurable values
    IF tolerance_percent IS NULL THEN
        config_tolerance := 20.0;  -- Default from config
    ELSE
        config_tolerance := tolerance_percent;
    END IF;
    
    distance_limits := get_route_distance_limits();
    elevation_limits := get_elevation_gain_limits();
    
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::float as total_distance_km,
                0.0::float as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.to_node_id as current_node,
                e.to_node_id as end_node,
                rs.path || e.to_node_id,
                rs.edges || e.id,
                rs.total_distance_km + e.length_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.from_node_id
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.to_node_id != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance_km < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance_km,
                total_elevation_gain,
                path,
                edges,
                -- Classify route shape
                CASE 
                    WHEN start_node = end_node THEN 'loop'
                    WHEN array_length(path, 1) = 2 THEN 'out-and-back'
                    WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
                    ELSE 'point-to-point'
                END as route_shape,
                -- Count unique trails
                array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
                -- Calculate similarity score
                calculate_route_similarity_score(
                    total_distance_km, $2,
                    total_elevation_gain, $4
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT * FROM valid_routes
        WHERE similarity_score >= get_min_route_score()
        ORDER BY similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain;
END;
$function$;

-- Function 8: generate_route_recommendations_configurable (Supporting)
-- Called by: generate_route_recommendations()
CREATE OR REPLACE FUNCTION public.generate_route_recommendations_configurable(staging_schema text, region_name text DEFAULT 'boulder')
 RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        EXECUTE format('
        INSERT INTO %I.route_recommendations (
            route_uuid,
            region,
            input_distance_km,
            input_elevation_gain,
            recommended_distance_km,
            recommended_elevation_gain,
            route_type,
            route_shape,
            trail_count,
            route_score,
            route_path,
            route_edges,
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            %L as region,
            %L,
            %L,
            r.total_distance_km,
            r.total_elevation_gain,
            ''similar_distance'' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                ''type'', ''LineString'',
                ''coordinates'', array_agg(
                    json_build_array(lng, lat, elevation)
                    ORDER BY array_position(r.route_path, id)
                )
            )::jsonb as route_path,
            -- Convert edges to JSON array
            json_agg(r.route_edges)::jsonb as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            %L,
            %L,
            %L,
            %L,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.similarity_score >= get_min_route_score()
          AND (
            r.route_shape = %L
            OR (%L = ''loop'' AND r.route_shape = ''point-to-point'')
            OR (%L = ''point-to-point'' AND r.route_shape = ''point-to-point'')
            OR (%L = ''out-and-back'' AND r.route_shape = ''point-to-point'')
          )
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges
        ', staging_schema, region_name, pattern.target_distance_km, pattern.target_elevation_gain, 
           staging_schema, pattern.target_distance_km, pattern.target_elevation_gain, pattern.tolerance_percent,
           pattern.route_shape, pattern.route_shape, pattern.route_shape, pattern.route_shape);
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
    END LOOP;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Function 9: calculate_route_similarity_score (Supporting)
-- Called by: find_routes_recursive_configurable()
CREATE OR REPLACE FUNCTION public.calculate_route_similarity_score(
    actual_distance_km double precision,
    target_distance_km double precision,
    actual_elevation_gain double precision,
    target_elevation_gain double precision
) RETURNS double precision AS $$
DECLARE
    distance_score double precision;
    elevation_score double precision;
    combined_score double precision;
BEGIN
    -- Calculate distance similarity (0-1, where 1 is perfect match)
    IF target_distance_km = 0 THEN
        distance_score := 0.0;
    ELSE
        distance_score := 1.0 - ABS(actual_distance_km - target_distance_km) / target_distance_km;
        distance_score := GREATEST(0.0, LEAST(1.0, distance_score));
    END IF;
    
    -- Calculate elevation similarity (0-1, where 1 is perfect match)
    IF target_elevation_gain = 0 THEN
        elevation_score := 0.0;
    ELSE
        elevation_score := 1.0 - ABS(actual_elevation_gain - target_elevation_gain) / target_elevation_gain;
        elevation_score := GREATEST(0.0, LEAST(1.0, elevation_score));
    END IF;
    
    -- Combine scores (weighted average)
    combined_score := (distance_score * 0.6) + (elevation_score * 0.4);
    
    RETURN combined_score;
END;
$$ LANGUAGE plpgsql;

-- Function 10: generate_route_name (Supporting)
-- Called by: generate_route_recommendations_configurable()
CREATE OR REPLACE FUNCTION public.generate_route_name(route_edges integer[], route_shape text)
RETURNS text AS $$
DECLARE
    unique_trail_names text[];
    route_name text;
BEGIN
    -- Get unique trail names from route edges
    SELECT array_agg(DISTINCT trail_name ORDER BY trail_name)
    INTO unique_trail_names
    FROM routing_edges
    WHERE id = ANY(route_edges);
    
    -- Generate route name based on shape and trail count
    IF array_length(unique_trail_names, 1) = 1 THEN
        route_name := unique_trail_names[1];
    ELSIF array_length(unique_trail_names, 1) = 2 THEN
        route_name := unique_trail_names[1] || '/' || unique_trail_names[2] || ' Route';
    ELSE
        route_name := unique_trail_names[1] || '/' || unique_trail_names[array_length(unique_trail_names, 1)] || ' Route';
    END IF;
    
    -- Add shape if not already in name
    IF route_name NOT LIKE '%' || route_shape || '%' THEN
        route_name := route_name || ' ' || route_shape;
    END IF;
    
    RETURN route_name;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- CONFIGURATION FUNCTIONS (Required by route recommendations)
-- =============================================================================

-- Configuration function: get_route_patterns
CREATE OR REPLACE FUNCTION public.get_route_patterns()
RETURNS TABLE(target_distance_km numeric, target_elevation_gain numeric, route_shape text, tolerance_percent numeric) AS $$
BEGIN
    RETURN QUERY VALUES
        -- Very short routes for small areas (like Chautauqua)
        (0.5, 25.0, 'point-to-point', 40.0),
        (0.75, 35.0, 'point-to-point', 35.0),
        (1.0, 50.0, 'point-to-point', 30.0),
        -- Short routes for small areas
        (2.0, 100.0, 'point-to-point', 25.0),
        (3.0, 150.0, 'point-to-point', 25.0),
        -- Medium routes for larger areas
        (5.0, 200.0, 'loop', 20.0),
        (5.0, 200.0, 'out-and-back', 20.0),
        (10.0, 400.0, 'loop', 20.0),
        (10.0, 400.0, 'out-and-back', 20.0);
END;
$$ LANGUAGE plpgsql;

-- Configuration function: get_min_route_score
CREATE OR REPLACE FUNCTION public.get_min_route_score()
RETURNS double precision AS $$
BEGIN
    RETURN 0.15;  -- More lenient minimum similarity score for small areas
END;
$$ LANGUAGE plpgsql;

-- Configuration function: get_max_routes_per_bin
CREATE OR REPLACE FUNCTION public.get_max_routes_per_bin()
RETURNS integer AS $$
BEGIN
    RETURN 10;  -- Maximum routes per pattern
END;
$$ LANGUAGE plpgsql;

-- Configuration function: get_route_distance_limits
CREATE OR REPLACE FUNCTION public.get_route_distance_limits()
RETURNS json AS $$
BEGIN
    RETURN '{"min": 0.3, "max": 20.0}'::json;
END;
$$ LANGUAGE plpgsql;

-- Configuration function: get_elevation_gain_limits
CREATE OR REPLACE FUNCTION public.get_elevation_gain_limits()
RETURNS json AS $$
BEGIN
    RETURN '{"min": 10.0, "max": 5000.0}'::json;
END;
$$ LANGUAGE plpgsql; 