-- =============================================================================
-- RECURSIVE ROUTE FINDING FUNCTIONS (CONFIGURABLE VERSION)
-- =============================================================================
-- 
-- Simple PostgreSQL-based route finding using WITH RECURSIVE
-- No pgRouting required - uses only built-in PostgreSQL features
-- 
-- Features:
-- - Find routes matching target distance and elevation
-- - Avoid cycles and infinite loops
-- - Calculate similarity scores using configurable weights
-- - Classify route shapes
-- - Uses configurable values from YAML configs
-- =============================================================================

-- Function to find routes using recursive CTEs with configurable values
CREATE OR REPLACE FUNCTION find_routes_recursive_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 20.0,  -- Default tolerance
    max_depth integer DEFAULT 8
) RETURNS TABLE(
    route_id text,
    start_node integer,
    end_node integer,
    total_distance_km float,
    total_elevation_gain float,
    route_path integer[],
    route_edges integer[],
    route_shape text,
    trail_count integer,
    similarity_score float
) AS $$
DECLARE
    config_tolerance float;
BEGIN
    -- Use provided tolerance or default
    config_tolerance := COALESCE(tolerance_percent, 20.0);
    
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
                -- Calculate similarity score
                GREATEST(0.0, 1.0 - (
                    ABS(total_distance_km - $2) / $2 + 
                    ABS(total_elevation_gain - $4) / NULLIF($4, 0)
                ) / 2.0) as similarity_score
            FROM route_search
            WHERE total_distance_km >= $2 * (1 - $3 / 100.0)  -- Minimum distance
              AND total_distance_km <= $2 * (1 + $3 / 100.0)  -- Maximum distance
              AND total_elevation_gain >= $4 * (1 - $3 / 100.0)  -- Minimum elevation
              AND total_elevation_gain <= $4 * (1 + $3 / 100.0)  -- Maximum elevation
              AND array_length(path, 1) >= 2  -- At least 2 nodes
              -- Apply reasonable limits
              AND total_distance_km >= 0.5  -- Minimum 0.5km
              AND total_distance_km <= 50.0  -- Maximum 50km
              AND total_elevation_gain >= 0  -- Minimum elevation
              AND total_elevation_gain <= 2000  -- Maximum 2000m
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
        WHERE similarity_score >= 0.3  -- Minimum 30% similarity
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT 50  -- Limit results
    $f$, staging_schema, staging_schema)
    USING max_depth, target_distance_km, config_tolerance, target_elevation_gain;
END;
$$ LANGUAGE plpgsql;

-- Function to generate route recommendations using configurable patterns
CREATE OR REPLACE FUNCTION generate_route_recommendations_configurable(
    staging_schema text
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    total_routes integer := 0;
    pattern_distance float;
    pattern_elevation float;
    pattern_shape text;
BEGIN
    -- Define route patterns to generate
    -- Pattern 1: Short loops (2-5km, 100-300m elevation)
    pattern_distance := 3.0;
    pattern_elevation := 200.0;
    pattern_shape := 'loop';
    
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
        route_name,
        created_at
    )
    SELECT 
        r.route_id,
        region_name as region,
        pattern_distance,
        pattern_elevation,
        r.total_distance_km,
        r.total_elevation_gain,
        'similar_distance' as route_type,
        r.route_shape,
        r.trail_count,
        (r.similarity_score * 100)::integer as route_score,
        -- Convert path to GeoJSON
        json_build_object(
            'type', 'LineString',
            'coordinates', array_agg(
                json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                ORDER BY array_position(r.route_path, n.id)
            )
        )::jsonb as route_path,
        -- Convert edges to JSON array
        json_agg(r.route_edges)::jsonb as route_edges,
        -- Generate route name
        region_name || ' ' || r.route_shape || ' Route - ' || 
        ROUND(r.total_distance_km, 1) || 'km, ' || 
        ROUND(r.total_elevation_gain) || 'm gain' as route_name,
        NOW() as created_at
    FROM find_routes_recursive_configurable(
        staging_schema,
        pattern_distance,
        pattern_elevation,
        20.0,  -- 20% tolerance
        8
    ) r
    JOIN routing_nodes n ON n.id = ANY(r.route_path)
    WHERE r.route_shape = pattern_shape
      AND r.similarity_score >= 0.3
    GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
             r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for short loops', route_count;
    
    -- Pattern 2: Medium out-and-back (5-10km, 300-600m elevation)
    pattern_distance := 7.0;
    pattern_elevation := 450.0;
    pattern_shape := 'out-and-back';
    
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
        route_name,
        created_at
    )
    SELECT 
        r.route_id,
        region_name as region,
        pattern_distance,
        pattern_elevation,
        r.total_distance_km,
        r.total_elevation_gain,
        'similar_distance' as route_type,
        r.route_shape,
        r.trail_count,
        (r.similarity_score * 100)::integer as route_score,
        json_build_object(
            'type', 'LineString',
            'coordinates', array_agg(
                json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                ORDER BY array_position(r.route_path, n.id)
            )
        )::jsonb as route_path,
        json_agg(r.route_edges)::jsonb as route_edges,
        region_name || ' ' || r.route_shape || ' Route - ' || 
        ROUND(r.total_distance_km, 1) || 'km, ' || 
        ROUND(r.total_elevation_gain) || 'm gain' as route_name,
        NOW() as created_at
    FROM find_routes_recursive_configurable(
        staging_schema,
        pattern_distance,
        pattern_elevation,
        25.0,  -- 25% tolerance
        8
    ) r
    JOIN routing_nodes n ON n.id = ANY(r.route_path)
    WHERE r.route_shape = pattern_shape
      AND r.similarity_score >= 0.3
    GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
             r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for medium out-and-back', route_count;
    
    -- Pattern 3: Long point-to-point (10-20km, 600-1200m elevation)
    pattern_distance := 15.0;
    pattern_elevation := 900.0;
    pattern_shape := 'point-to-point';
    
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
        route_name,
        created_at
    )
    SELECT 
        r.route_id,
        region_name as region,
        pattern_distance,
        pattern_elevation,
        r.total_distance_km,
        r.total_elevation_gain,
        'similar_distance' as route_type,
        r.route_shape,
        r.trail_count,
        (r.similarity_score * 100)::integer as route_score,
        json_build_object(
            'type', 'LineString',
            'coordinates', array_agg(
                json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                ORDER BY array_position(r.route_path, n.id)
            )
        )::jsonb as route_path,
        json_agg(r.route_edges)::jsonb as route_edges,
        region_name || ' ' || r.route_shape || ' Route - ' || 
        ROUND(r.total_distance_km, 1) || 'km, ' || 
        ROUND(r.total_elevation_gain) || 'm gain' as route_name,
        NOW() as created_at
    FROM find_routes_recursive_configurable(
        staging_schema,
        pattern_distance,
        pattern_elevation,
        30.0,  -- 30% tolerance
        8
    ) r
    JOIN routing_nodes n ON n.id = ANY(r.route_path)
    WHERE r.route_shape = pattern_shape
      AND r.similarity_score >= 0.3
    GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
             r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes for long point-to-point', route_count;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Function to find routes for specific criteria with configurable values
CREATE OR REPLACE FUNCTION find_routes_for_criteria_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    desired_route_shape text DEFAULT NULL,
    max_routes integer DEFAULT 50
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    route_shape text,
    trail_count integer,
    similarity_score float,
    route_path integer[],
    route_edges integer[]
) AS $$
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
        FROM find_routes_recursive_configurable($1, $2, $3, 20.0, 8)
        WHERE ($4 IS NULL OR route_shape = $4)
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT $5
    $f$, staging_schema, target_distance_km, target_elevation_gain, desired_route_shape, max_routes);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate route cost using configurable weights
CREATE OR REPLACE FUNCTION find_routes_with_cost_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    max_cost float DEFAULT NULL
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    route_cost float,
    steepness_m_per_km float,
    similarity_score float,
    route_shape text
) AS $$
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
$$ LANGUAGE plpgsql;

-- Function to validate route finding works with configurable values
CREATE OR REPLACE FUNCTION test_route_finding_configurable(
    staging_schema text
) RETURNS TABLE(
    test_name text,
    result text,
    details text
) AS $$
DECLARE
    route_count integer;
BEGIN
    -- Test 1: Check if routes can be found
    EXECUTE format('SELECT COUNT(*) FROM find_routes_recursive_configurable($1, 5.0, 200.0, 20.0, 8)', staging_schema) INTO route_count;
    IF route_count > 0 THEN
        RETURN QUERY SELECT 'Route Finding'::text, 'PASS'::text, format('Found %s routes', route_count)::text;
    ELSE
        RETURN QUERY SELECT 'Route Finding'::text, 'FAIL'::text, 'No routes found'::text;
    END IF;
    
    -- Test 2: Check if configurable values are working
    IF get_max_routes_per_bin() > 0 THEN
        RETURN QUERY SELECT 'Config Values'::text, 'PASS'::text, format('Max routes per bin: %s', get_max_routes_per_bin())::text;
    ELSE
        RETURN QUERY SELECT 'Config Values'::text, 'FAIL'::text, 'Invalid max routes per bin'::text;
    END IF;
    
    -- Test 3: Check if cost calculation works
    IF calculate_route_cost(50.0, 5.0) > 0 THEN
        RETURN QUERY SELECT 'Cost Calculation'::text, 'PASS'::text, format('Cost: %s', calculate_route_cost(50.0, 5.0))::text;
    ELSE
        RETURN QUERY SELECT 'Cost Calculation'::text, 'FAIL'::text, 'Invalid cost calculation'::text;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ✅ NEW: Function to find routes with configurable cost routing modes
CREATE OR REPLACE FUNCTION find_routes_with_cost_mode(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    routing_mode text DEFAULT 'standard',
    max_cost float DEFAULT NULL
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    route_cost float,
    steepness_m_per_km float,
    similarity_score float,
    route_shape text,
    routing_mode_used text
) AS $$
DECLARE
    order_direction text;
BEGIN
    -- Get the order direction for this routing mode
    order_direction := get_routing_mode_order_direction(routing_mode);
    
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
                -- Calculate route cost using the specified routing mode
                calculate_route_cost_with_mode(
                    CASE 
                        WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                        ELSE 0
                    END,
                    r.total_distance_km,
                    $4
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
            route_shape,
            $4 as routing_mode_used
        FROM route_costs
        WHERE ($5 IS NULL OR route_cost <= $5)
        ORDER BY route_cost %s, similarity_score DESC
        LIMIT get_max_routes_per_bin()
    $f$, staging_schema, order_direction)
    USING target_distance_km, target_elevation_gain, routing_mode, max_cost;
END;
$$ LANGUAGE plpgsql;

-- ✅ NEW: Function to find routes with most cost (highest elevation gain)
CREATE OR REPLACE FUNCTION find_routes_most_cost(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    max_cost float DEFAULT NULL
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    route_cost float,
    steepness_m_per_km float,
    similarity_score float,
    route_shape text
) AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        r.route_id,
        r.total_distance_km,
        r.total_elevation_gain,
        r.route_cost,
        r.steepness_m_per_km,
        r.similarity_score,
        r.route_shape
    FROM find_routes_with_cost_mode(
        staging_schema, 
        target_distance_km, 
        target_elevation_gain, 
        'mostCost', 
        max_cost
    ) r;
END;
$$ LANGUAGE plpgsql;

-- ✅ NEW: Function to find routes with elevation focus (maximize elevation gain)
CREATE OR REPLACE FUNCTION find_routes_elevation_focused(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    max_cost float DEFAULT NULL
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    route_cost float,
    steepness_m_per_km float,
    similarity_score float,
    route_shape text
) AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        r.route_id,
        r.total_distance_km,
        r.total_elevation_gain,
        r.route_cost,
        r.steepness_m_per_km,
        r.similarity_score,
        r.route_shape
    FROM find_routes_with_cost_mode(
        staging_schema, 
        target_distance_km, 
        target_elevation_gain, 
        'elevationFocused', 
        max_cost
    ) r;
END;
$$ LANGUAGE plpgsql;

-- ✅ NEW: Function to find routes with distance focus (minimize distance)
CREATE OR REPLACE FUNCTION find_routes_distance_focused(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    max_cost float DEFAULT NULL
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    route_cost float,
    steepness_m_per_km float,
    similarity_score float,
    route_shape text
) AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        r.route_id,
        r.total_distance_km,
        r.total_elevation_gain,
        r.route_cost,
        r.steepness_m_per_km,
        r.similarity_score,
        r.route_shape
    FROM find_routes_with_cost_mode(
        staging_schema, 
        target_distance_km, 
        target_elevation_gain, 
        'distanceFocused', 
        max_cost
    ) r;
END;
$$ LANGUAGE plpgsql;

-- ✅ NEW: Function to compare routes across different routing modes
CREATE OR REPLACE FUNCTION compare_routing_modes(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    max_cost float DEFAULT NULL
) RETURNS TABLE(
    routing_mode text,
    route_count integer,
    avg_distance_km float,
    avg_elevation_gain float,
    avg_steepness_m_per_km float,
    avg_cost float,
    avg_similarity_score float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH mode_results AS (
            -- Standard mode
            SELECT 'standard' as mode, * FROM find_routes_with_cost_mode($1, $2, $3, 'standard', $4)
            UNION ALL
            -- Most cost mode
            SELECT 'mostCost' as mode, * FROM find_routes_with_cost_mode($1, $2, $3, 'mostCost', $4)
            UNION ALL
            -- Elevation focused mode
            SELECT 'elevationFocused' as mode, * FROM find_routes_with_cost_mode($1, $2, $3, 'elevationFocused', $4)
            UNION ALL
            -- Distance focused mode
            SELECT 'distanceFocused' as mode, * FROM find_routes_with_cost_mode($1, $2, $3, 'distanceFocused', $4)
            UNION ALL
            -- Balanced mode
            SELECT 'balanced' as mode, * FROM find_routes_with_cost_mode($1, $2, $3, 'balanced', $4)
        )
        SELECT 
            mode as routing_mode,
            COUNT(*) as route_count,
            AVG(total_distance_km) as avg_distance_km,
            AVG(total_elevation_gain) as avg_elevation_gain,
            AVG(steepness_m_per_km) as avg_steepness_m_per_km,
            AVG(route_cost) as avg_cost,
            AVG(similarity_score) as avg_similarity_score
        FROM mode_results
        GROUP BY mode
        ORDER BY avg_elevation_gain DESC, avg_cost DESC
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, max_cost;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PARAMETRIC SEARCH CALCULATION FUNCTIONS
-- =============================================================================
-- Functions to calculate route metrics for parametric search and filtering

-- Calculate route gain rate (meters per kilometer) for a route
CREATE OR REPLACE FUNCTION calculate_route_gain_rate(
    route_distance_km REAL,
    route_elevation_gain REAL
) RETURNS REAL AS $$
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
$$ LANGUAGE plpgsql;

-- Calculate route difficulty based on elevation gain rate
CREATE OR REPLACE FUNCTION calculate_route_difficulty(
    elevation_gain_rate REAL
) RETURNS TEXT AS $$
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
$$ LANGUAGE plpgsql;

-- Calculate estimated hiking time based on distance and terrain
CREATE OR REPLACE FUNCTION calculate_route_estimated_time(
    distance_km REAL,
    elevation_gain_rate REAL
) RETURNS REAL AS $$
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
$$ LANGUAGE plpgsql;

-- Calculate route connectivity score (how well trails connect)
CREATE OR REPLACE FUNCTION calculate_route_connectivity_score(
    trail_count INTEGER,
    route_distance_km REAL
) RETURNS REAL AS $$
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
$$ LANGUAGE plpgsql;

-- Calculate route elevation statistics (min, max, avg)
CREATE OR REPLACE FUNCTION calculate_route_elevation_stats(
    route_edges_json JSONB
) RETURNS TABLE(
    min_elevation REAL,
    max_elevation REAL,
    avg_elevation REAL
) AS $$
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
$$ LANGUAGE plpgsql;

-- =============================================================================
-- COMPREHENSIVE ROUTE METRICS CALCULATION
-- =============================================================================
-- Function to calculate all parametric search values for a route

CREATE OR REPLACE FUNCTION calculate_route_parametric_metrics(
    route_distance_km REAL,
    route_elevation_gain REAL,
    route_trail_count INTEGER,
    route_edges_json JSONB
) RETURNS TABLE(
    elevation_gain_rate REAL,
    difficulty TEXT,
    estimated_time_hours REAL,
    connectivity_score REAL,
    min_elevation REAL,
    max_elevation REAL,
    avg_elevation REAL
) AS $$
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
$$ LANGUAGE plpgsql; 