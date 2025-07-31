-- Carthorse Production Database Schema
-- Generated: 2025-07-31T20:30:18.439Z
-- Database: trail_master_db
-- Schema: public

-- ========================================
-- CARTHORSE CORE FUNCTIONS
-- ========================================

-- Routing Functions
-- ========================================

-- Function: build_routing_edges
-- Type: FUNCTION
-- Returns: integer

DECLARE
    edge_count integer;
BEGIN
    -- Clear existing routing edges
    EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
    
    -- Insert routing edges using optimized PostGIS spatial functions
    EXECUTE format('
        INSERT INTO %I.routing_edges (from_node_id, to_node_id, trail_id, trail_name, distance_km, elevation_gain, elevation_loss)
        WITH trail_segments AS (
            -- Get all trail segments with validated geometry
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                id,
                app_uuid,
                name,
                geometry,
                length_km,
                elevation_gain,
                elevation_loss,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        elevation_calculated AS (
            -- Calculate elevation data from geometry using PostGIS function
            -- If existing elevation data is NULL, calculate from geometry
            -- If calculation fails, preserve NULL (don''t default to 0)
            SELECT 
                ts.*,
                CASE 
                    WHEN ts.elevation_gain IS NOT NULL THEN ts.elevation_gain
                    ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(ts.geometry)))
                END as calculated_elevation_gain,
                CASE 
                    WHEN ts.elevation_loss IS NOT NULL THEN ts.elevation_loss
                    ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(ts.geometry)))
                END as calculated_elevation_loss
            FROM trail_segments ts
        ),
        node_connections AS (
            -- Find which nodes connect to each trail segment using spatial functions
            SELECT 
                ec.id as trail_id,
                ec.app_uuid as trail_uuid,
                ec.name as trail_name,
                ec.length_km,
                ec.calculated_elevation_gain as elevation_gain,
                ec.calculated_elevation_loss as elevation_loss,
                ec.geometry,
                -- Find start node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ec.start_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ec.start_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326))
                 LIMIT 1) as from_node_id,
                -- Find end node using spatial proximity
                (SELECT n.id 
                 FROM %I.routing_nodes n 
                 WHERE ST_DWithin(ec.end_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326), GREATEST(0.001, 0.001))
                 ORDER BY ST_Distance(ec.end_point, ST_SetSRID(ST_Point(n.lng, n.lat), 4326))
                 LIMIT 1) as to_node_id
            FROM elevation_calculated ec
        ),
        valid_edges AS (
            -- Only include edges where both nodes are found
            SELECT 
                trail_id,
                trail_uuid,
                trail_name,
                length_km,
                elevation_gain,
                elevation_loss,
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
                -- Preserve NULL elevation values - don''t default to 0
                elevation_gain,
                elevation_loss,
                -- Validate that nodes are actually connected to the trail
                ST_DWithin(
                    ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = from_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = from_node_id)
                    ), 4326),
                    geometry,
                    GREATEST(0.001, 0.001)
                ) as start_connected,
                ST_DWithin(
                    ST_SetSRID(ST_Point(
                        (SELECT lng FROM %I.routing_nodes WHERE id = to_node_id),
                        (SELECT lat FROM %I.routing_nodes WHERE id = to_node_id)
                    ), 4326),
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
            elevation_gain,
            elevation_loss
        FROM edge_metrics
        WHERE start_connected AND end_connected
        ORDER BY trail_id
    ', staging_schema, staging_schema, trails_table, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema);
    
    -- Get the count of inserted edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    RETURN edge_count;
END;
;

-- Function: build_routing_edges_fixed
-- Type: FUNCTION
-- Returns: integer
 DECLARE edge_count integer := 0; BEGIN EXECUTE format('DELETE FROM %I.routing_edges', staging_schema); EXECUTE format('INSERT INTO %I.routing_edges (source, target, trail_id, trail_name, distance_km, elevation_gain, elevation_loss, geometry) SELECT from_node_id, to_node_id, trail_uuid, trail_name, distance_km, elevation_gain, elevation_loss, geo2 FROM (SELECT ec.id as trail_id, ec.app_uuid as trail_uuid, ec.name as trail_name, ec.length_km, ec.elevation_gain, ec.elevation_loss, fn.id as from_node_id, tn.id as to_node_id, COALESCE(ec.length_km, ST_Length(ec.geometry::geography) / 1000) as distance_km, ec.geometry as geo2 FROM %I.%I ec LEFT JOIN LATERAL (SELECT n.id FROM %I.routing_nodes n WHERE ST_DWithin(ST_StartPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s) ORDER BY ST_Distance(ST_StartPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)) LIMIT 1) fn ON true LEFT JOIN LATERAL (SELECT n.id FROM %I.routing_nodes n WHERE ST_DWithin(ST_EndPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326), %s) ORDER BY ST_Distance(ST_EndPoint(ec.geometry), ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326)) LIMIT 1) tn ON true WHERE ec.geometry IS NOT NULL AND ST_IsValid(ec.geometry) AND ST_Length(ec.geometry) > 0.1 AND fn.id IS NOT NULL AND tn.id IS NOT NULL AND fn.id <> tn.id) edges', staging_schema, staging_schema, trails_table, staging_schema, edge_tolerance, staging_schema, edge_tolerance); EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count; RETURN edge_count; END; ;

-- Function: build_routing_nodes
-- Type: FUNCTION
-- Returns: integer

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
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
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
            FROM detect_trail_intersections(''%I'', ''%I'', GREATEST($1, 0.001))
            WHERE array_length(connected_trail_ids, 1) > 1  -- Only true intersections
        ),
        all_nodes AS (
            -- Combine intersection points and trail endpoints
            SELECT 
                intersection_point as point,
                intersection_point_3d as point_3d,
                unnest(connected_trail_names) as connected_trail,
                ''intersection'' as node_type
            FROM intersection_points
            
            UNION ALL
            
            -- Trail start points
            SELECT 
                start_point as point,
                ST_Force3D(start_point) as point_3d,
                name as connected_trail,
                ''endpoint'' as node_type
            FROM trail_endpoints
            
            UNION ALL
            
            -- Trail end points
            SELECT 
                end_point as point,
                ST_Force3D(end_point) as point_3d,
                name as connected_trail,
                ''endpoint'' as node_type
            FROM trail_endpoints
        ),
        grouped_nodes AS (
            -- Group nearby nodes to avoid duplicates using spatial clustering
            SELECT 
                ST_X(point) as lng,
                ST_Y(point) as lat,
                COALESCE(ST_Z(point_3d), 0) as elevation,
                array_agg(DISTINCT connected_trail) as all_connected_trails,
                CASE 
                    WHEN array_length(array_agg(DISTINCT connected_trail), 1) > 1 THEN ''intersection''
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
;

-- Function: calculate_route_connectivity_score
-- Type: FUNCTION
-- Returns: real

DECLARE
    connectivity_score REAL;
BEGIN
    -- Return NULL if required parameters are NULL
    IF trail_count IS NULL OR route_distance_km IS NULL OR route_distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    
    -- Calculate connectivity score based on trail density
    -- Higher score = better connectivity (more trails per km)
    connectivity_score := trail_count::REAL / route_distance_km;
    
    -- Normalize to 0-1 range (cap at 5 trails per km for max score)
    connectivity_score := LEAST(1.0, connectivity_score / 5.0);
    
    RETURN connectivity_score;
END;
;

-- Function: calculate_route_cost
-- Type: FUNCTION
-- Returns: double precision

DECLARE
    weights json;
BEGIN
    weights := get_cost_weights();
    
    RETURN (steepness_m_per_km * (weights ->> 'steepness_weight')::float) + 
           (distance_km * (weights ->> 'distance_weight')::float);
END;
;

-- Function: calculate_route_difficulty
-- Type: FUNCTION
-- Returns: text

BEGIN
    -- Return NULL if gain rate is NULL
    IF elevation_gain_rate IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Difficulty classification based on gain rate (m/km)
    IF elevation_gain_rate < 50 THEN
        RETURN 'easy';
    ELSIF elevation_gain_rate < 100 THEN
        RETURN 'moderate';
    ELSIF elevation_gain_rate < 150 THEN
        RETURN 'hard';
    ELSE
        RETURN 'expert';
    END IF;
END;
;

-- Function: calculate_route_elevation_stats
-- Type: FUNCTION
-- Returns: record

DECLARE
    edge_record RECORD;
    min_elev REAL := 9999;
    max_elev REAL := -9999;
    total_elev REAL := 0;
    edge_count INTEGER := 0;
BEGIN
    -- Extract elevation data from route edges
    FOR edge_record IN 
        SELECT 
            (edge->>'min_elevation')::REAL as min_elev,
            (edge->>'max_elevation')::REAL as max_elev,
            (edge->>'avg_elevation')::REAL as avg_elev
        FROM jsonb_array_elements(route_edges_json) as edge
        WHERE edge->>'min_elevation' IS NOT NULL
          AND edge->>'max_elevation' IS NOT NULL
          AND edge->>'avg_elevation' IS NOT NULL
    LOOP
        -- Update min/max elevation
        IF edge_record.min_elev < min_elev THEN
            min_elev := edge_record.min_elev;
        END IF;
        IF edge_record.max_elev > max_elev THEN
            max_elev := edge_record.max_elev;
        END IF;
        
        -- Accumulate for average
        total_elev := total_elev + edge_record.avg_elev;
        edge_count := edge_count + 1;
    END LOOP;
    
    -- Return NULL if no valid elevation data found
    IF edge_count = 0 THEN
        RETURN QUERY SELECT NULL::REAL, NULL::REAL, NULL::REAL;
        RETURN;
    END IF;
    
    -- Return calculated statistics
    RETURN QUERY SELECT 
        CASE WHEN min_elev = 9999 THEN NULL ELSE min_elev END,
        CASE WHEN max_elev = -9999 THEN NULL ELSE max_elev END,
        total_elev / edge_count;
END;
;

-- Function: calculate_route_estimated_time
-- Type: FUNCTION
-- Returns: real

DECLARE
    base_speed_kmh REAL := 4.0; -- Base hiking speed on flat terrain
    elevation_factor REAL;
    estimated_hours REAL;
BEGIN
    -- Return NULL if distance is NULL or 0
    IF distance_km IS NULL OR distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    
    -- Calculate elevation factor (slower on steep terrain)
    IF elevation_gain_rate IS NULL OR elevation_gain_rate < 50 THEN
        elevation_factor := 1.0; -- No penalty for easy terrain
    ELSIF elevation_gain_rate < 100 THEN
        elevation_factor := 0.8; -- 20% slower for moderate terrain
    ELSIF elevation_gain_rate < 150 THEN
        elevation_factor := 0.6; -- 40% slower for hard terrain
    ELSE
        elevation_factor := 0.4; -- 60% slower for expert terrain
    END IF;
    
    -- Calculate estimated time
    estimated_hours := distance_km / (base_speed_kmh * elevation_factor);
    
    -- Return minimum 0.5 hours and maximum 24 hours
    RETURN GREATEST(0.5, LEAST(24.0, estimated_hours));
END;
;

-- Function: calculate_route_gain_rate
-- Type: FUNCTION
-- Returns: real

BEGIN
    -- Return NULL if distance is 0 or NULL to avoid division by zero
    IF route_distance_km IS NULL OR route_distance_km <= 0 THEN
        RETURN NULL;
    END IF;
    
    -- Return NULL if elevation gain is NULL
    IF route_elevation_gain IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Calculate gain rate: elevation gain / distance
    RETURN route_elevation_gain / route_distance_km;
END;
;

-- Function: calculate_route_parametric_metrics
-- Type: FUNCTION
-- Returns: record

DECLARE
    gain_rate REAL;
    route_difficulty TEXT;
    estimated_time REAL;
    connectivity REAL;
    elevation_stats RECORD;
BEGIN
    -- Calculate route gain rate
    gain_rate := calculate_route_gain_rate(route_distance_km, route_elevation_gain);
    
    -- Calculate difficulty
    route_difficulty := calculate_route_difficulty(gain_rate);
    
    -- Calculate estimated time
    estimated_time := calculate_route_estimated_time(route_distance_km, gain_rate);
    
    -- Calculate connectivity score
    connectivity := calculate_route_connectivity_score(route_trail_count, route_distance_km);
    
    -- Calculate elevation statistics
    SELECT * INTO elevation_stats FROM calculate_route_elevation_stats(route_edges_json);
    
    -- Return all calculated metrics
    RETURN QUERY SELECT 
        gain_rate,
        route_difficulty,
        estimated_time,
        connectivity,
        elevation_stats.min_elevation,
        elevation_stats.max_elevation,
        elevation_stats.avg_elevation;
END;
;

-- Function: calculate_route_similarity_score
-- Type: FUNCTION
-- Returns: double precision

BEGIN
    -- Calculate distance similarity (0-1)
    DECLARE
        distance_similarity double precision;
        elevation_similarity double precision;
    BEGIN
        -- Distance similarity (closer to target = higher score)
        distance_similarity := 1.0 - ABS(actual_distance - target_distance) / GREATEST(target_distance, 1.0);
        distance_similarity := GREATEST(0.0, LEAST(1.0, distance_similarity));
        
        -- Elevation similarity (closer to target = higher score)
        elevation_similarity := 1.0 - ABS(actual_elevation - target_elevation) / GREATEST(target_elevation, 1.0);
        elevation_similarity := GREATEST(0.0, LEAST(1.0, elevation_similarity));
        
        -- Return weighted average (distance more important than elevation)
        RETURN (distance_similarity * 0.7) + (elevation_similarity * 0.3);
    END;
END;
;

-- Function: cleanup_routing_graph
-- Type: FUNCTION
-- Returns: record

DECLARE
  self_loops_count integer := 0;
  orphaned_nodes_count integer := 0;
  orphaned_edges_count integer := 0;
BEGIN
  -- Remove self-loops (edges where source = target)
  EXECUTE format('DELETE FROM %I.routing_edges WHERE source = target', staging_schema);
  GET DIAGNOSTICS self_loops_count = ROW_COUNT;
  
  -- Remove orphaned edges (edges pointing to non-existent nodes)
  EXECUTE format('
    DELETE FROM %I.routing_edges e
    WHERE NOT EXISTS (
      SELECT 1 FROM %I.routing_nodes n WHERE n.id = e.source
    ) OR NOT EXISTS (
      SELECT 1 FROM %I.routing_nodes n WHERE n.id = e.target
    )', staging_schema, staging_schema, staging_schema);
  GET DIAGNOSTICS orphaned_edges_count = ROW_COUNT;
  
  -- Remove orphaned nodes (nodes not connected to any edges)
  EXECUTE format('
    DELETE FROM %I.routing_nodes n
    WHERE NOT EXISTS (
      SELECT 1 FROM %I.routing_edges e WHERE e.source = n.id OR e.target = n.id
    )', staging_schema, staging_schema);
  GET DIAGNOSTICS orphaned_nodes_count = ROW_COUNT;
  
  -- Return results
  IF self_loops_count > 0 OR orphaned_edges_count > 0 OR orphaned_nodes_count > 0 THEN
    RETURN QUERY SELECT 
      true as success,
      'Cleaned routing graph: ' || self_loops_count || ' self-loops, ' || 
      orphaned_edges_count || ' orphaned edges, ' || orphaned_nodes_count || ' orphaned nodes' as message,
      (self_loops_count + orphaned_edges_count) as cleaned_edges,
      orphaned_nodes_count as cleaned_nodes;
  ELSE
    RETURN QUERY SELECT 
      true as success,
      'Routing graph is clean - no issues found' as message,
      0 as cleaned_edges,
      0 as cleaned_nodes;
  END IF;
END;
;

-- Function: find_routes_for_criteria
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY EXECUTE format($f$
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_shape,
            trail_count,
            similarity_score,
            route_path,
            route_edges
        FROM find_routes_recursive($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC
        LIMIT $5
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, desired_route_shape, max_routes;
END;
;

-- Function: find_routes_for_criteria_configurable
-- Type: FUNCTION
-- Returns: record

DECLARE
    config_max_routes integer;
BEGIN
    IF max_routes IS NULL THEN
        config_max_routes := get_max_routes_per_bin();
    ELSE
        config_max_routes := max_routes;
    END IF;
    
    RETURN QUERY EXECUTE format($f$
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_shape,
            trail_count,
            similarity_score,
            route_path,
            route_edges
        FROM find_routes_recursive_configurable($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC
        LIMIT $5
    $f$, staging_schema)
    USING staging_schema, target_distance_km, target_elevation_gain, desired_route_shape, config_max_routes;
END;
;

-- Function: find_routes_recursive
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH RECURSIVE route_search AS (
            -- Start with all intersection nodes as potential starting points
            SELECT 
                id as start_node,
                id as current_node,
                id as end_node,
                ARRAY[id] as path,
                ARRAY[]::integer[] as edges,
                0.0::double precision as total_distance,
                0.0::double precision as total_elevation_gain,
                0 as depth,
                ARRAY[]::text[] as trail_names
            FROM %I.routing_nodes
            WHERE node_type IN ('intersection', 'endpoint')
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                (rs.total_distance + e.distance_km)::double precision,
                (rs.total_elevation_gain + COALESCE(e.elevation_gain, 0))::double precision,
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
              AND rs.total_distance < $2 * (1 + $3 / 100.0)  -- Distance tolerance
              AND rs.total_elevation_gain < $4 * (1 + $3 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
            -- Filter to routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                start_node,
                end_node,
                total_distance as total_distance_km,
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
                -- Calculate similarity score (0-1)
                calculate_route_similarity_score(total_distance, $2, total_elevation_gain, $4) as similarity_score
            FROM route_search
            WHERE total_distance >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_distance <= $2 * (1 + $3 / 100.0)  -- Maximum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)  -- Maximum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
            GROUP BY start_node, end_node, total_distance, total_elevation_gain, path, edges
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            path,
            edges,
            route_shape,
            trail_count,
            similarity_score
        FROM valid_routes
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT get_max_routes_per_bin()  -- Limit results
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, tolerance_percent, target_elevation_gain;
END;
;

-- Function: find_routes_recursive_configurable
-- Type: FUNCTION
-- Returns: record

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
            WHERE node_type = 'intersection'
            
            UNION ALL
            
            -- Recursively explore connected nodes
            SELECT 
                rs.start_node,
                e.target as current_node,
                e.target as end_node,
                rs.path || e.target,
                rs.edges || e.id,
                rs.total_distance_km + e.distance_km,
                rs.total_elevation_gain + COALESCE(e.elevation_gain, 0),
                rs.depth + 1,
                rs.trail_names || e.trail_name
            FROM route_search rs
            JOIN %I.routing_edges e ON rs.current_node = e.source
            WHERE rs.depth < $1  -- Limit depth to prevent infinite loops
              AND e.target != ALL(rs.path)  -- Avoid cycles
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
                -- Calculate similarity score using configurable weights
                calculate_route_similarity_score(
                    total_distance_km, $2,
                    total_elevation_gain, $4
                ) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_distance_km <= $2 * (1 + $3 / 100.0)  -- Maximum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)  -- Maximum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
              -- Apply configurable limits
              AND total_distance_km >= ($5 ->> 'min_km')::float
              AND total_distance_km <= ($5 ->> 'max_km')::float
              AND total_elevation_gain >= ($6 ->> 'min_meters')::float
              AND total_elevation_gain <= ($6 ->> 'max_meters')::float
            GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges
        )
        SELECT 
            route_id,
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            path,
            edges,
            route_shape,
            trail_count,
            similarity_score
        FROM valid_routes
        WHERE similarity_score >= get_min_route_score()  -- Use configurable minimum score
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT get_max_routes_per_bin()  -- Use configurable limit
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain, 
          distance_limits, elevation_limits;
END;
;

-- Function: find_routes_with_cost_configurable
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH route_costs AS (
            SELECT 
                r.route_id,
                r.total_distance_km,
                r.total_elevation_gain,
                r.route_shape,
                r.similarity_score,
                -- Calculate steepness (elevation gain per km)
                CASE 
                    WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                    ELSE 0
                END as steepness_m_per_km,
                -- Calculate route cost using configurable weights
                calculate_route_cost(
                    CASE 
                        WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                        ELSE 0
                    END,
                    r.total_distance_km
                ) as route_cost
            FROM find_routes_recursive_configurable($1, $2::float, $3::float, 20.0, 8) r
        )
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            route_cost,
            steepness_m_per_km,
            similarity_score,
            route_shape
        FROM route_costs
        WHERE ($4 IS NULL OR route_cost <= $4)
        ORDER BY route_cost ASC, similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, max_cost;
END;
;

-- Function: generate_route_recommendations
-- Type: FUNCTION
-- Returns: integer

DECLARE
    route_count integer := 0;
    pattern record;
BEGIN
    -- Define common route patterns
    CREATE TEMP TABLE route_patterns (
        pattern_name text,
        target_distance_km float,
        target_elevation_gain float,
        route_shape text,
        tolerance_percent float
    );
    
    -- Insert common route patterns
    INSERT INTO route_patterns VALUES
        ('Short Loop', 3.0, 150.0, 'loop', 30.0),
        ('Medium Loop', 5.0, 250.0, 'loop', 30.0),
        ('Short Out-and-Back', 2.5, 100.0, 'out-and-back', 30.0),
        ('Medium Out-and-Back', 4.0, 200.0, 'out-and-back', 30.0),
        ('Short Point-to-Point', 3.5, 180.0, 'point-to-point', 30.0),
        ('Medium Point-to-Point', 5.5, 300.0, 'point-to-point', 30.0);
    
    -- Generate recommendations for each pattern
    FOR pattern IN SELECT * FROM route_patterns LOOP
        INSERT INTO route_recommendations (
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
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.path, n.id)
                )
            )::text as route_path,
            -- Convert edges to JSON array
            json_agg(r.edges)::text as route_edges,
            NOW() as created_at
        FROM find_routes_recursive(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Only good matches
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.edges;
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    DROP TABLE route_patterns;
    RETURN route_count;
END;
;

-- Function: generate_route_recommendations_configurable
-- Type: FUNCTION
-- Returns: integer

DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
BEGIN
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        INSERT INTO route_recommendations (
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
            created_at
        )
        SELECT 
            r.route_id,
            'boulder' as region,  -- TODO: Make this dynamic
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified)
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.path, n.id)
                )
            )::text as route_path,
            -- Convert edges to JSON array
            json_agg(r.edges)::text as route_edges,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.edges;
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
;

-- Function: generate_routing_edges_native
-- Type: FUNCTION
-- Returns: record

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
          AND source_node.id <> target_node.id  -- Prevent self-loops
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
;

-- Function: generate_routing_graph
-- Type: FUNCTION
-- Returns: record

BEGIN
  -- Drop existing tables
  DROP TABLE IF EXISTS public.routing_edges CASCADE;
  DROP TABLE IF EXISTS public.routing_nodes CASCADE;
  
  -- Create routing edges (one edge per trail)
  CREATE TABLE public.routing_edges AS
  SELECT
    id,
    app_uuid,
    name,
    trail_type,
    length_km,
    elevation_gain,
    elevation_loss,
    -- Use simplified geometry for routing
    ST_SimplifyPreserveTopology(ST_Force2D(geometry), 0.0001) AS geom
  FROM public.trails
  WHERE geometry IS NOT NULL;

  -- Add routing topology columns
  ALTER TABLE public.routing_edges ADD COLUMN source INTEGER;
  ALTER TABLE public.routing_edges ADD COLUMN target INTEGER;

  -- Create topology using pgRouting
  PERFORM pgr_createTopology('public.routing_edges', 0.0001, 'geom', 'id');

  -- Create nodes table from topology
  CREATE TABLE public.routing_nodes AS
  SELECT 
    id,
    the_geom,
    cnt,
    ST_X(the_geom) as lng,
    ST_Y(the_geom) as lat,
    ST_Z(the_geom) as elevation
  FROM public.routing_edges_vertices_pgr;

  -- Add spatial indexes for performance
  CREATE INDEX IF NOT EXISTS idx_routing_edges_geom ON public.routing_edges USING GIST (geom);
  CREATE INDEX IF NOT EXISTS idx_routing_nodes_geom ON public.routing_nodes USING GIST (the_geom);

  -- Return counts
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM public.routing_edges) as edges_count,
    (SELECT COUNT(*)::INTEGER FROM public.routing_nodes) as nodes_count;
END;
;

-- Function: generate_routing_nodes_native
-- Type: FUNCTION
-- Returns: record

DECLARE
    count_result integer;
BEGIN
    -- Call the build_routing_nodes function
    SELECT build_routing_nodes(staging_schema, 'trails', intersection_tolerance_meters) INTO count_result;
    
    -- Return success result
    RETURN QUERY SELECT 
        count_result as node_count,
        true as success,
        format('Generated %s routing nodes from trail endpoints and intersections', count_result) as message;
END;
;

-- Function: generate_routing_nodes_native
-- Type: FUNCTION
-- Returns: record

DECLARE
    node_count_var integer := 0;
BEGIN
    -- Clear existing routing nodes
    EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
    
    -- Generate routing nodes from trail endpoints and intersections
    EXECUTE format($f$
        INSERT INTO %I.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, created_at)
        WITH trail_endpoints AS (
            -- Get all trail start and end points with 3D coordinates
            SELECT 
                app_uuid,
                name,
                ST_StartPoint(geometry) as start_point,
                ST_EndPoint(geometry) as end_point,
                ST_Z(ST_StartPoint(geometry)) as start_elevation,
                ST_Z(ST_EndPoint(geometry)) as end_elevation
            FROM %I.trails 
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        all_points AS (
            -- Combine start and end points
            SELECT 
                app_uuid,
                name,
                start_point as point,
                start_elevation as elevation,
                'start' as point_type
            FROM trail_endpoints
            UNION ALL
            SELECT 
                app_uuid,
                name,
                end_point as point,
                end_elevation as elevation,
                'end' as point_type
            FROM trail_endpoints
        ),
        intersection_points AS (
            -- Find intersection points between trails
            SELECT DISTINCT
                ST_Intersection(t1.geometry, t2.geometry) as point,
                ST_Z(ST_Intersection(t1.geometry, t2.geometry)) as elevation
            FROM %I.trails t1
            JOIN %I.trails t2 ON t1.app_uuid < t2.app_uuid
            WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
            AND t1.geometry IS NOT NULL AND t2.geometry IS NOT NULL
            AND ST_IsValid(t1.geometry) AND ST_IsValid(t2.geometry)
        ),
        clustered_points AS (
            -- Cluster nearby points using ST_ClusterWithin
            SELECT 
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Z(ST_Centroid(ST_Collect(point))) as elevation,
                COUNT(*) as point_count,
                STRING_AGG(DISTINCT app_uuid, ',' ORDER BY app_uuid) as connected_trails
            FROM all_points
            GROUP BY ST_ClusterWithin(point, $1)
        ),
        intersection_clusters AS (
            -- Cluster intersection points
            SELECT 
                ST_Centroid(ST_Collect(point)) as clustered_point,
                ST_Z(ST_Centroid(ST_Collect(point))) as elevation,
                COUNT(*) as point_count,
                'intersection' as node_type
            FROM intersection_points
            GROUP BY ST_ClusterWithin(point, $1)
        ),
        all_clusters AS (
            SELECT 
                clustered_point,
                elevation,
                point_count,
                CASE 
                    WHEN point_count > 1 THEN 'intersection'
                    ELSE 'endpoint'
                END as node_type,
                connected_trails
            FROM clustered_points
            UNION ALL
            SELECT 
                clustered_point,
                elevation,
                point_count,
                node_type,
                NULL as connected_trails
            FROM intersection_clusters
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY ST_X(clustered_point), ST_Y(clustered_point)) as id,
            md5(ST_AsText(clustered_point)) as node_uuid,
            ST_Y(clustered_point) as lat,
            ST_X(clustered_point) as lng,
            elevation,
            node_type,
            connected_trails,
            NOW() as created_at
        FROM all_clusters
        WHERE clustered_point IS NOT NULL
    $f$, staging_schema, staging_schema, staging_schema, staging_schema) USING tolerance_meters;
    
    GET DIAGNOSTICS node_count_var = ROW_COUNT;
    
    -- Return results
    RETURN QUERY SELECT 
        node_count_var,
        true as success,
        format('Successfully generated %s routing nodes (endpoints and intersections)', node_count_var) as message;
    
    RAISE NOTICE 'Generated % routing nodes', node_count_var;
        
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT 
        0, false, 
        format('Error during routing nodes generation: %s', SQLERRM) as message;
    
    RAISE NOTICE 'Error during routing nodes generation: %', SQLERRM;
END;
;

-- Function: get_max_routes_per_bin
-- Type: FUNCTION
-- Returns: integer

BEGIN
    RETURN (get_carthorse_config() ->> 'max_routes_per_bin')::integer;
END;
;

-- Function: get_min_route_score
-- Type: FUNCTION
-- Returns: double precision

BEGIN
    RETURN (get_carthorse_config() ->> 'min_route_score')::float;
END;
;

-- Function: get_route_distance_limits
-- Type: FUNCTION
-- Returns: json

BEGIN
    RETURN json_build_object(
        'min_km', (get_carthorse_config() ->> 'min_route_distance_km')::float,
        'max_km', (get_carthorse_config() ->> 'max_route_distance_km')::float
    );
END;
;

-- Function: get_route_patterns
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY SELECT 
        rp.pattern_name,
        rp.target_distance_km,
        rp.target_elevation_gain,
        rp.route_shape,
        rp.tolerance_percent
    FROM route_patterns rp
    ORDER BY rp.target_distance_km, rp.target_elevation_gain;
END;
;

-- Function: prep_routing_network
-- Type: FUNCTION
-- Returns: record

DECLARE
    trail_count integer := 0;
    node_count integer := 0;
    edge_count integer := 0;
BEGIN
    -- Step 1: Add source and target columns to trails table (required by pgRouting)
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS source INTEGER, ADD COLUMN IF NOT EXISTS target INTEGER;', staging_schema, trails_table);
    
    -- Step 2: Call pgr_createTopology to detect intersections and split trails automatically
    EXECUTE format('SELECT pgr_createTopology(''%I.%I'', %s, ''the_geom'', ''id'')', staging_schema, trails_table, node_tolerance_meters);
    
    -- Step 3: Create routing_edges from the pgRouting-processed trails
    EXECUTE format('
        DROP TABLE IF EXISTS %I.routing_edges CASCADE;
        CREATE TABLE %I.routing_edges AS
        SELECT
            id,
            source,
            target,
            app_uuid as trail_id,
            name as trail_name,
            elevation_gain,
            elevation_loss,
            length_km,
            -- Cost calculation
            (CASE 
                WHEN length_km > 0 THEN (elevation_gain / length_km) * $1 + (length_km * $2)
                ELSE length_km * $2
            END) as cost,
            (CASE 
                WHEN length_km > 0 THEN (elevation_loss / length_km) * $1 + (length_km * $2)
                ELSE length_km * $2
            END) as reverse_cost,
            TRUE AS is_bidirectional,
            ST_AsText(the_geom) AS geometry_wkt,
            ST_AsText(ST_Force2D(the_geom)) AS geometry_2d_wkt
        FROM %I.%I
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    ', staging_schema, staging_schema, staging_schema, trails_table) 
    USING steepness_weight, distance_weight;
    
    -- Step 4: Create routing_nodes from the pgRouting vertices
    EXECUTE format('
        DROP TABLE IF EXISTS %I.routing_nodes CASCADE;
        CREATE TABLE %I.routing_nodes AS
        SELECT
            id,
            ''node_'' || id as node_uuid,
            ST_Y(the_geom) as lat,
            ST_X(the_geom) as lng,
            NULL as elevation,
            ''intersection'' AS node_type,
            '''' AS connected_trails
        FROM %I.%I_vertices_pgr
        WHERE id IS NOT NULL
    ', staging_schema, staging_schema, staging_schema, trails_table);
    
    -- Get final counts
    EXECUTE format('SELECT COUNT(*) FROM %I.%I', staging_schema, trails_table) INTO trail_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    
    -- Return success with statistics
    success := true;
    message := format('pgRouting network prepared successfully: %s trails, %s nodes, %s edges', trail_count, node_count, edge_count);
    
    RETURN QUERY SELECT success, message, trail_count, node_count, edge_count;
    
EXCEPTION WHEN OTHERS THEN
    success := false;
    message := 'Error preparing pgRouting network: ' || SQLERRM;
    RETURN QUERY SELECT success, message, 0, 0, 0;
END;
;

-- Function: prepare_routing_network
-- Type: PROCEDURE
-- Returns: null

DECLARE
    qualified_input TEXT := format('%I.%I', in_schema, in_table);
    qualified_edges TEXT := format('%I.%I', in_schema, out_topoedges_table);
    qualified_nodes TEXT := format('%I.%I', in_schema, out_toponodes_table);
    deduplicated_table TEXT := 'deduplicated_trails_temp';
BEGIN
    RAISE NOTICE 'Beginning routing network prep for schema: %', in_schema;

    -- Step 0: Deduplicate trails by geometry and preserve all attributes
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', deduplicated_table);
    EXECUTE format('
        CREATE TABLE %I AS
        SELECT DISTINCT ON (ST_AsText(%I)) 
            %I, %I, app_uuid, name, trail_type, surface, difficulty, 
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            length_km, source_tags, osm_id, region, created_at, updated_at
        FROM %s
        WHERE %I IS NOT NULL AND ST_IsValid(%I)
        ORDER BY ST_AsText(%I), %I
    ', deduplicated_table, geom_col, id_col, geom_col, qualified_input, geom_col, geom_col, geom_col, id_col);

    -- Step 1: Cleanup existing outputs
    IF clean THEN
        EXECUTE format('DROP TABLE IF EXISTS %s CASCADE;', qualified_edges);
        EXECUTE format('DROP TABLE IF EXISTS %s CASCADE;', qualified_nodes);
    END IF;

    -- Step 2: Rename geometry column and create both 3D and 2D versions
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO geometry_3d', deduplicated_table, geom_col);
    EXECUTE format('ALTER TABLE %I ADD COLUMN the_geom GEOMETRY(LINESTRING, 4326)', deduplicated_table);
    EXECUTE format('UPDATE %I SET the_geom = ST_Force2D(geometry_3d)', deduplicated_table);

    -- Step 3: Add source and target columns for pgRouting
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source BIGINT', deduplicated_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS target BIGINT', deduplicated_table);

    -- Step 4: Create Topology on deduplicated data
    RAISE NOTICE 'Creating topology for deduplicated trails';
    PERFORM pgr_createTopology(
        deduplicated_table,
        tolerance,
        'the_geom',
        'id'
    );

    -- Step 4: Create edges table with source/target columns and preserve all trail attributes
    RAISE NOTICE 'Creating edge table %', qualified_edges;
    EXECUTE format($f$
        CREATE TABLE %s AS
        SELECT
            id AS id,
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            length_km,
            source_tags,
            osm_id,
            region,
            created_at,
            updated_at,
            source,
            target,
            ST_Force2D(the_geom) AS geom,
            geometry_3d
        FROM %s;
    $f$, qualified_edges, deduplicated_table);

    -- Step 5: Create nodes table from vertices created by pgr_createTopology
    RAISE NOTICE 'Generating nodes table %', qualified_nodes;
    EXECUTE format($f$
        CREATE TABLE %s AS
        SELECT 
            id AS node_id, 
            the_geom AS geom
        FROM %I_vertices_pgr
        WHERE id IS NOT NULL;
    $f$, qualified_nodes, deduplicated_table);

    -- Step 5: Indexes for performance
    EXECUTE format('CREATE INDEX ON %s USING GIST (geom);', qualified_edges);
    EXECUTE format('CREATE INDEX ON %s USING GIST (geom);', qualified_nodes);
    EXECUTE format('ANALYZE %s;', qualified_edges);
    EXECUTE format('ANALYZE %s;', qualified_nodes);

    -- Clean up deduplicated table
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', deduplicated_table);

    RAISE NOTICE 'Routing network prepared successfully with deduplication.';
END;
;

-- Function: prepare_routing_network
-- Type: PROCEDURE
-- Returns: null

DECLARE
  node_table TEXT := schema_name || '.routing_nodes';
  edge_table TEXT := schema_name || '.routing_edges';
  trails_3d_table TEXT := schema_name || '.split_trails';
  trails_2d_table TEXT := schema_name || '.split_trails_2d';
  noded_table TEXT := schema_name || '.split_trails_noded';
BEGIN
  RAISE NOTICE 'Beginning routing network prep for schema: %', schema_name;

  -- Step 0: Drop intermediate tables if they exist
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', trails_2d_table);
  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', noded_table);

  -- Step 1: Create 2D geometry version of split_trails
  EXECUTE format('
    CREATE TABLE %I AS
    SELECT id AS old_id, ST_Force2D(geometry) AS geom
    FROM %I
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)',
    trails_2d_table, trails_3d_table
  );

  -- Step 2: Clean and node the network using native PostGIS
  EXECUTE format('
    CREATE TABLE %I AS
    SELECT
      row_number() OVER () AS id,
      d.geom::geometry(LINESTRING, 4326) AS geometry,
      s.old_id,
      s.old_id AS source,
      s.old_id AS target
    FROM (
      SELECT (ST_Dump(ST_Node(ST_Collect(geom)))).geom
      FROM %I
    ) AS d
    JOIN %I s
    ON ST_Intersects(d.geom, s.geom)',
    noded_table, trails_2d_table, trails_2d_table
  );

  -- Step 3: Add spatial index
  EXECUTE format('
    CREATE INDEX ON %I USING GIST (geometry)',
    noded_table
  );

  -- Step 4: Create topology with pgRouting
  EXECUTE format('
    SELECT pgr_createTopology(%L, 0.00001, %L, %L)',
    noded_table, 'geometry', 'id'
  );

  -- Step 5: Clear out routing_nodes and routing_edges if present
  EXECUTE format('DELETE FROM %I', node_table);
  EXECUTE format('DELETE FROM %I', edge_table);

  -- Step 6: Populate routing_nodes
  EXECUTE format('
    INSERT INTO %I (node_uuid, lat, lng, elevation, node_type, connected_trails)
    SELECT DISTINCT
      md5(source::text) AS node_uuid,
      ST_Y(pt.geom) AS lat,
      ST_X(pt.geom) AS lng,
      NULL::REAL AS elevation,
      ''intersection'' AS node_type,
      NULL::TEXT AS connected_trails
    FROM (
      SELECT source, ST_StartPoint(geometry) AS geom FROM %I
      UNION
      SELECT target, ST_EndPoint(geometry) AS geom FROM %I
    ) AS pt',
    node_table, noded_table, noded_table
  );

  -- Step 7: Populate routing_edges
  EXECUTE format('
    INSERT INTO %I (
      from_node_id, to_node_id, trail_id, trail_name, distance_km, geometry
    )
    SELECT
      n1.id AS from_node_id,
      n2.id AS to_node_id,
      CAST(stn.old_id AS TEXT) AS trail_id,
      t.name AS trail_name,
      ST_Length(geography(stn.geometry)) / 1000.0 AS distance_km,
      stn.geometry
    FROM %I stn
    JOIN %I n1 ON md5(stn.source::text) = n1.node_uuid
    JOIN %I n2 ON md5(stn.target::text) = n2.node_uuid
    JOIN %I t ON stn.old_id = t.id',
    edge_table, noded_table, node_table, node_table, trails_3d_table
  );

  RAISE NOTICE 'Routing network build complete for schema: %', schema_name;

END;
;

-- Function: show_routing_summary
-- Type: FUNCTION
-- Returns: record

BEGIN
  RETURN QUERY
  SELECT 
    'Routing Edges (One per trail)' as type,
    COUNT(*) as count
  FROM public.routing_edges
  UNION ALL
  SELECT 
    'Routing Nodes (Intersections)' as type,
    COUNT(*) as count
  FROM public.routing_nodes;
END;
;

-- Function: test_route_finding
-- Type: FUNCTION
-- Returns: record

DECLARE
    route_count integer;
    node_count integer;
    edge_count integer;
BEGIN
    -- Test 1: Check if routing graph exists
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    IF node_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'PASS'::text,
            format('Found %s nodes and %s edges', node_count, edge_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'FAIL'::text,
            format('Missing routing graph: %s nodes, %s edges', node_count, edge_count)::text;
    END IF;
    
    -- Test 2: Try to find a simple route
    SELECT COUNT(*) INTO route_count
    FROM find_routes_recursive(staging_schema, 5.0, 200.0, 20.0, 5);
    
    IF route_count > 0 THEN
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'PASS'::text,
            format('Found %s routes for 5km/200m criteria', route_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'FAIL'::text,
            'No routes found for 5km/200m criteria'::text;
    END IF;
    
    -- Test 3: Check route quality
    IF EXISTS (
        SELECT 1 FROM find_routes_recursive(staging_schema, 5.0, 200.0, 20.0, 5)
        WHERE similarity_score >= get_min_route_score()
    ) THEN
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'PASS'::text,
            'Found high-quality routes (similarity > 0.8)'::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'WARN'::text,
            'No high-quality routes found - check criteria'::text;
    END IF;
END;
;

-- Function: test_route_finding_configurable
-- Type: FUNCTION
-- Returns: record

DECLARE
    route_count integer;
    node_count integer;
    edge_count integer;
    config_min_score float;
BEGIN
    -- Test 1: Check if routing graph exists
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_nodes', staging_schema) INTO node_count;
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges', staging_schema) INTO edge_count;
    
    IF node_count > 0 AND edge_count > 0 THEN
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'PASS'::text,
            format('Found %s nodes and %s edges', node_count, edge_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Routing Graph'::text,
            'FAIL'::text,
            format('Missing routing graph: %s nodes, %s edges', node_count, edge_count)::text;
    END IF;
    
    -- Test 2: Try to find a simple route with configurable values
    SELECT COUNT(*) INTO route_count
    FROM find_routes_recursive_configurable(staging_schema, 5.0, 200.0, 20.0, 5);
    
    IF route_count > 0 THEN
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'PASS'::text,
            format('Found %s routes for 5km/200m criteria', route_count)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Finding'::text,
            'FAIL'::text,
            'No routes found for 5km/200m criteria'::text;
    END IF;
    
    -- Test 3: Check route quality using configurable minimum score
    config_min_score := get_min_route_score();
    IF EXISTS (
        SELECT 1 FROM find_routes_recursive_configurable(staging_schema, 5.0, 200.0, 20.0, 5)
        WHERE similarity_score >= config_min_score
    ) THEN
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'PASS'::text,
            format('Found high-quality routes (similarity >= %s)', config_min_score)::text;
    ELSE
        RETURN QUERY SELECT 
            'Route Quality'::text,
            'WARN'::text,
            format('No high-quality routes found (similarity >= %s) - check criteria', config_min_score)::text;
    END IF;
    
    -- Test 4: Check configurable limits
    IF (get_route_distance_limits() ->> 'min_km')::float > 0 THEN
        RETURN QUERY SELECT 
            'Config Limits'::text,
            'PASS'::text,
            'Configurable distance and elevation limits are set'::text;
    ELSE
        RETURN QUERY SELECT 
            'Config Limits'::text,
            'WARN'::text,
            'Distance/elevation limits may be too restrictive'::text;
    END IF;
END;
;

-- Function: validate_routing_edge_consistency
-- Type: FUNCTION
-- Returns: trigger

BEGIN
  -- Ensure trail_id references a valid trail
  IF NOT EXISTS (SELECT 1 FROM trails WHERE app_uuid = NEW.trail_id) THEN
    RAISE EXCEPTION 'trail_id must reference a valid trail in trails table';
  END IF;
  
  -- Ensure nodes exist
  IF NOT EXISTS (SELECT 1 FROM routing_nodes WHERE id = NEW.from_node_id) THEN
    RAISE EXCEPTION 'from_node_id must reference a valid node in routing_nodes table';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM routing_nodes WHERE id = NEW.to_node_id) THEN
    RAISE EXCEPTION 'to_node_id must reference a valid node in routing_nodes table';
  END IF;
  
  RETURN NEW;
END;
;

-- Intersection Functions
-- ========================================

-- Function: detect_trail_intersections
-- Type: FUNCTION
-- Returns: void

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
;

-- Function: detect_trail_intersections
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY EXECUTE format('
        WITH noded_trails AS (
            -- Use ST_Node to split all trails at intersections (network topology)
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT id, name, (ST_Dump(ST_Node(geometry))).geom as noded_geom
            FROM %I.%I
            WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
            -- True geometric intersections (where two trails cross/touch)
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_Intersection(t1.noded_geom, t2.noded_geom) as intersection_point,
                ST_Force3D(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''intersection'' as node_type,
                0.0 as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
              AND ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) = ''ST_Point''
        ),
        endpoint_near_miss AS (
            -- Endpoints within a tight threshold (1.0 meter)
            -- Preserve 3D geometry by removing ST_Force2D()
            SELECT 
                ST_EndPoint(t1.noded_geom) as intersection_point,
                ST_Force3D(ST_EndPoint(t1.noded_geom)) as intersection_point_3d,
                ARRAY[t1.id, t2.id] as connected_trail_ids,
                ARRAY[t1.name, t2.name] as connected_trail_names,
                ''endpoint_near_miss'' as node_type,
                ST_Distance(ST_EndPoint(t1.noded_geom), ST_EndPoint(t2.noded_geom)) as distance_meters
            FROM noded_trails t1
            JOIN noded_trails t2 ON (t1.id < t2.id)
            WHERE ST_DWithin(ST_EndPoint(t1.noded_geom), ST_EndPoint(t2.noded_geom), GREATEST($1, 0.001))
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
;

-- Function: get_intersection_stats
-- Type: FUNCTION
-- Returns: record

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
;

-- Function: get_intersection_tolerance
-- Type: FUNCTION
-- Returns: real
 BEGIN RETURN 2.0; END; ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.ST_Intersection($2, $1, 1) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.ST_Intersection($1::public.geometry, $2::public.geometry);  ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
SELECT public.geography(public.ST_Transform(public.ST_Intersection(public.ST_Transform(public.geometry($1), public._ST_BestSRID($1, $2)), public.ST_Transform(public.geometry($2), public._ST_BestSRID($1, $2))), public.ST_SRID($1)));

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
ST_Intersection;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED

	DECLARE
		intersects boolean := FALSE; same_srid boolean := FALSE;
	BEGIN
		same_srid :=  (public.ST_SRID(geomin) = public.ST_SRID(rast));
		IF NOT same_srid THEN
			RAISE EXCEPTION 'SRIDS of geometry: % and raster: % are not the same',
				public.ST_SRID(geomin), public.ST_SRID(rast)
				USING HINT = 'Verify using ST_SRID function';
		END IF;
		intersects :=  public.ST_Intersects(geomin, rast, band);
		IF intersects THEN
			-- Return the intersections of the geometry with the vectorized parts of
			-- the raster and the values associated with those parts, if really their
			-- intersection is not empty.
			RETURN QUERY
				SELECT
					intgeom,
					val
				FROM (
					SELECT
						public.ST_Intersection((gv).geom, geomin) AS intgeom,
						(gv).val
					FROM public.ST_DumpAsPolygons(rast, band) gv
					WHERE public.ST_Intersects((gv).geom, geomin)
				) foo
				WHERE NOT public.ST_IsEmpty(intgeom);
		ELSE
			-- If the geometry does not intersect with the raster, return an empty
			-- geometry and a null value
			RETURN QUERY
				SELECT
					emptygeom,
					NULL::float8
				FROM public.ST_GeomCollFromText('GEOMETRYCOLLECTION EMPTY', public.ST_SRID($1)) emptygeom;
		END IF;
	END;
	;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, 1, $2, 1, 'BOTH', ARRAY[$3, $3]) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, 1, $2, 1, 'BOTH', $3) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, 1, $2, 1, $3, ARRAY[$4, $4]) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, 1, $2, 1, $3, $4) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, $2, $3, $4, 'BOTH', ARRAY[$5, $5]) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, $2, $3, $4, 'BOTH', $5) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.st_intersection($1, $2, $3, $4, $5, ARRAY[$6, $6]) ;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED

	DECLARE
		rtn public.raster;
		_returnband text;
		newnodata1 float8;
		newnodata2 float8;
	BEGIN
		IF ST_SRID(rast1) != ST_SRID(rast2) THEN
			RAISE EXCEPTION 'The two rasters do not have the same SRID';
		END IF;

		newnodata1 := coalesce(nodataval[1], public.ST_BandNodataValue(rast1, band1), public.ST_MinPossibleValue(public.ST_BandPixelType(rast1, band1)));
		newnodata2 := coalesce(nodataval[2], public.ST_BandNodataValue(rast2, band2), public.ST_MinPossibleValue(public.ST_BandPixelType(rast2, band2)));

		_returnband := upper(returnband);

		rtn := NULL;
		CASE
			WHEN _returnband = 'BAND1' THEN
				rtn := public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast1.val]', public.ST_BandPixelType(rast1, band1), 'INTERSECTION', newnodata1::text, newnodata1::text, newnodata1);
				rtn := public.ST_SetBandNodataValue(rtn, 1, newnodata1);
			WHEN _returnband = 'BAND2' THEN
				rtn := public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast2.val]', public.ST_BandPixelType(rast2, band2), 'INTERSECTION', newnodata2::text, newnodata2::text, newnodata2);
				rtn := public.ST_SetBandNodataValue(rtn, 1, newnodata2);
			WHEN _returnband = 'BOTH' THEN
				rtn := public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast1.val]', public.ST_BandPixelType(rast1, band1), 'INTERSECTION', newnodata1::text, newnodata1::text, newnodata1);
				rtn := public.ST_SetBandNodataValue(rtn, 1, newnodata1);
				rtn := public.ST_AddBand(rtn, public.ST_MapAlgebraExpr(rast1, band1, rast2, band2, '[rast2.val]', public.ST_BandPixelType(rast2, band2), 'INTERSECTION', newnodata2::text, newnodata2::text, newnodata2));
				rtn := public.ST_SetBandNodataValue(rtn, 2, newnodata2);
			ELSE
				RAISE EXCEPTION 'Unknown value provided for returnband: %', returnband;
				RETURN NULL;
		END CASE;

		RETURN rtn;
	END;
	;

-- Function: st_intersection
-- Type: FUNCTION
-- Returns: USER-DEFINED
 SELECT public.ST_Intersection($3, $1, $2) ;

-- Function: validate_intersection_detection
-- Type: FUNCTION
-- Returns: record

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
;

-- Utility Functions
-- ========================================

-- Function: get_batch_size
-- Type: FUNCTION
-- Returns: integer

BEGIN
    RETURN (get_carthorse_config() ->> 'batch_size')::integer;
END;
;

-- Function: get_carthorse_config
-- Type: FUNCTION
-- Returns: json

BEGIN
    RETURN json_build_object(
        -- Spatial tolerances
        'intersection_tolerance', 2,
        'edge_tolerance', 2,
        'simplify_tolerance', 0.001,
        
        -- Processing settings
        'batch_size', 1000,
        'timeout_ms', 30000,
        
        -- Validation thresholds
        'min_trail_length_meters', 1,
        'max_trail_length_meters', 100000,
        'min_elevation_meters', 0,
        'max_elevation_meters', 9000,
        'min_coordinate_points', 2,
        'max_coordinate_points', 10000,
        
        -- Route discovery settings
        'max_routes_per_bin', 10,
        'min_route_score', 0.7,
        'min_route_distance_km', 1,
        'max_route_distance_km', 10,
        'min_elevation_gain_meters', 10,
        'max_elevation_gain_meters', 5000,
        
        -- Route scoring weights
        'distance_weight', 0.5,
        'elevation_weight', 0.3,
        'quality_weight', 0.3,
        
        -- Cost weighting
        'steepness_weight', 2,
        'routing_distance_weight', 0.5
    );
END;
;

-- Function: get_cost_weights
-- Type: FUNCTION
-- Returns: json

BEGIN
    RETURN json_build_object(
        'steepness_weight', (get_carthorse_config() ->> 'steepness_weight')::float,
        'distance_weight', (get_carthorse_config() ->> 'routing_distance_weight')::float
    );
END;
;

-- Function: get_edge_tolerance
-- Type: FUNCTION
-- Returns: double precision

BEGIN
    RETURN (get_carthorse_config() ->> 'edge_tolerance')::float;
END;
;

-- Function: get_proj4_from_srid
-- Type: FUNCTION
-- Returns: text

	BEGIN
	RETURN proj4text::text FROM public.spatial_ref_sys WHERE srid= $1;
	END;
	;

-- Function: get_scoring_weights
-- Type: FUNCTION
-- Returns: json

BEGIN
    RETURN json_build_object(
        'distance_weight', (get_carthorse_config() ->> 'distance_weight')::float,
        'elevation_weight', (get_carthorse_config() ->> 'elevation_weight')::float,
        'quality_weight', (get_carthorse_config() ->> 'quality_weight')::float
    );
END;
;

-- Function: get_simplify_tolerance
-- Type: FUNCTION
-- Returns: double precision

BEGIN
    RETURN (get_carthorse_config() ->> 'simplify_tolerance')::float;
END;
;

-- Function: get_timeout_ms
-- Type: FUNCTION
-- Returns: integer

BEGIN
    RETURN (get_carthorse_config() ->> 'timeout_ms')::integer;
END;
;

-- Function: get_trails_with_geojson
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.app_uuid,
        t.name,
        t.region,
        t.length_km,
        t.elevation_gain,
        COALESCE(t.geojson_cached, ST_AsGeoJSON(t.geometry, 6, 0)) as geojson
    FROM trails t
    WHERE (p_region IS NULL OR t.region = p_region)
    ORDER BY t.name
    LIMIT p_limit;
END;
;

-- Function: update_geojson_cache
-- Type: FUNCTION
-- Returns: trigger

BEGIN
    NEW.geojson_cached = ST_AsGeoJSON(NEW.geometry, 6, 0);
    RETURN NEW;
END;
;

-- Function: update_updated_at_column
-- Type: FUNCTION
-- Returns: trigger

BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
;

-- Carthorse Functions
-- ========================================

-- Function: calculate_trail_stats
-- Type: FUNCTION
-- Returns: record

BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_trails,
        COALESCE(SUM(length_km), 0) as total_length_km,
        COALESCE(AVG(elevation_gain), 0) as avg_elevation_gain,
        COUNT(DISTINCT region) as regions_count
    FROM trails;
END;
;

-- Function: copy_and_split_trails_to_staging_native
-- Type: FUNCTION
-- Returns: record

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
            -- Find all intersection points between trails using 3D coordinates
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
            -- Get all source trails (explicitly select only columns that exist in production)
            SELECT 
                id, app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, created_at, updated_at, geometry
            FROM (%s) t WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        ),
        trails_with_intersections AS (
            -- Get trails that have intersections
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
            -- Get trails that don't have intersections (keep original)
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
            -- Combine both sets
            SELECT * FROM trails_with_intersections
            UNION ALL
            SELECT * FROM trails_without_intersections
        )
        SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for all segments
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
            -- Keep original elevation data
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            split_geometry as geometry,
            ST_AsText(split_geometry) as geometry_text,
            md5(ST_AsText(split_geometry)) as geometry_hash,
            NOW() as created_at,
            NOW() as updated_at
        FROM processed_trails pt
        WHERE ST_IsValid(pt.split_geometry)  -- Only include valid geometries
          AND pt.app_uuid IS NOT NULL    -- Ensure app_uuid is not null
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
;

