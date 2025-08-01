-- =============================================================================
-- RECURSIVE ROUTE FINDING FUNCTIONS (CONFIGURABLE VERSION) - FIXED
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

-- Function to generate route names according to Gainiac requirements
CREATE OR REPLACE FUNCTION generate_route_name(route_edges integer[], route_shape text)
RETURNS text AS $$
DECLARE
  trail_names text[];
  unique_trail_names text[];
  route_name text;
BEGIN
  -- Extract unique trail names from route edges
  SELECT array_agg(DISTINCT trail_name ORDER BY trail_name) INTO trail_names
  FROM routing_edges 
  WHERE id = ANY(route_edges);
  
  -- Remove duplicates while preserving order
  SELECT array_agg(DISTINCT name ORDER BY name) INTO unique_trail_names
  FROM unnest(trail_names) AS name;
  
  -- Apply naming convention based on number of unique trails
  IF array_length(unique_trail_names, 1) = 1 THEN
    -- Single trail: use trail name directly
    route_name := unique_trail_names[1];
  ELSIF array_length(unique_trail_names, 1) = 2 THEN
    -- Two trails: {First Trail}/{Second Trail} Route
    route_name := unique_trail_names[1] || '/' || unique_trail_names[2] || ' Route';
  ELSE
    -- More than 2 trails: {First Trail}/{Last Trail} Route
    route_name := unique_trail_names[1] || '/' || unique_trail_names[array_length(unique_trail_names, 1)] || ' Route';
  END IF;
  
  -- Add route shape suffix if not already present
  IF route_name NOT LIKE '%' || route_shape || '%' THEN
    route_name := route_name || ' ' || route_shape;
  END IF;
  
  RETURN route_name;
END;
$$ LANGUAGE plpgsql;

-- Function to find routes using recursive CTEs with configurable values
CREATE OR REPLACE FUNCTION find_routes_recursive_configurable(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT NULL,  -- Use config if NULL
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
$$ LANGUAGE plpgsql;

-- Function to generate route recommendations using configurable patterns
CREATE OR REPLACE FUNCTION generate_route_recommendations_configurable(
    staging_schema text,
    region_name text DEFAULT 'boulder'
) RETURNS integer AS $$
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
            route_name,
            created_at
        )
        SELECT 
            r.route_id,
            region_name as region,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            r.total_distance_km,
            r.total_elevation_gain,
            'similar_distance' as route_type,
            r.route_shape,
            r.trail_count,
            (r.similarity_score * 100)::integer as route_score,
            -- Convert path to GeoJSON (simplified) - FIXED: Use jsonb
            json_build_object(
                'type', 'LineString',
                'coordinates', array_agg(
                    json_build_array(n.lng, n.lat, n.elevation)
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            -- Convert edges to JSON array - FIXED: Use jsonb
            json_agg(r.route_edges)::jsonb as route_edges,
            -- Generate proper route name
            generate_route_name(r.route_edges, r.route_shape) as route_name,
            NOW() as created_at
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_nodes n ON n.id = ANY(r.route_path)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.trail_count, r.similarity_score, r.route_edges;
        
        -- Populate route_trails junction table with trail composition data
        INSERT INTO route_trails (
            route_uuid,
            trail_id,
            trail_name,
            segment_order,
            segment_distance_km,
            segment_elevation_gain,
            segment_elevation_loss
        )
        SELECT 
            r.route_id,
            e.trail_id,
            e.trail_name,
            ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source)) as segment_order,
            e.distance_km,
            e.elevation_gain,
            e.elevation_loss
        FROM find_routes_recursive_configurable(
            staging_schema,
            pattern.target_distance_km,
            pattern.target_elevation_gain,
            pattern.tolerance_percent,
            8
        ) r
        JOIN routing_edges e ON e.id = ANY(r.route_edges)
        WHERE r.route_shape = pattern.route_shape
          AND r.similarity_score >= get_min_route_score();
        
        GET DIAGNOSTICS route_count = ROW_COUNT;
        total_routes := total_routes + route_count;
        RAISE NOTICE 'Generated % routes for pattern: %', route_count, pattern.pattern_name;
    END LOOP;
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Function to generate route recommendations with adaptive tolerance
CREATE OR REPLACE FUNCTION generate_route_recommendations_adaptive(
    staging_schema text,
    region_name text DEFAULT 'boulder',
    min_routes_per_pattern integer DEFAULT 10,
    max_tolerance_percent integer DEFAULT 50
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    pattern record;
    total_routes integer := 0;
    current_tolerance float;
    routes_found integer;
    max_iterations integer := 5; -- Prevent infinite loops
    iteration integer;
BEGIN
    -- Create route_trails table if it doesn't exist
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_trails (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT NOT NULL,
            trail_id TEXT NOT NULL,
            trail_name TEXT NOT NULL,
            segment_order INTEGER NOT NULL,
            segment_distance_km REAL CHECK(segment_distance_km > 0),
            segment_elevation_gain REAL CHECK(segment_elevation_gain >= 0),
            segment_elevation_loss REAL CHECK(segment_elevation_loss >= 0),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    
    -- Create route_recommendations table if it doesn't exist
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.route_recommendations (
            id SERIAL PRIMARY KEY,
            route_uuid TEXT UNIQUE NOT NULL,
            region TEXT NOT NULL,
            input_distance_km REAL CHECK(input_distance_km > 0),
            input_elevation_gain REAL CHECK(input_elevation_gain >= 0),
            recommended_distance_km REAL CHECK(recommended_distance_km > 0),
            recommended_elevation_gain REAL CHECK(recommended_elevation_gain >= 0),
            route_type TEXT,
            route_shape TEXT,
            trail_count INTEGER,
            route_score INTEGER,
            route_path JSONB,
            route_edges JSONB,
            route_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ', staging_schema);
    -- Generate recommendations for each pattern from config
    FOR pattern IN SELECT * FROM get_route_patterns() LOOP
        current_tolerance := pattern.tolerance_percent;
        routes_found := 0;
        iteration := 0;
        
        -- Try with increasing tolerance until we get enough routes
        WHILE routes_found < min_routes_per_pattern AND iteration < max_iterations AND current_tolerance <= max_tolerance_percent LOOP
            -- Clear any previous routes for this pattern
            EXECUTE format('DELETE FROM %I.route_recommendations 
            WHERE input_distance_km = $1 
              AND input_elevation_gain = $2
              AND route_shape = $3', staging_schema)
            USING pattern.target_distance_km, pattern.target_elevation_gain, pattern.route_shape;
            
            -- Generate routes with current tolerance
            EXECUTE format('INSERT INTO %I.route_recommendations (
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
                $1 as region,
                $2,
                $3,
                r.total_distance_km,
                r.total_elevation_gain,
                ''similar_distance'' as route_type,
                r.route_shape,
                r.trail_count,
                (r.similarity_score * 100)::integer as route_score,
                -- Convert path to GeoJSON (simplified) - FIXED: Use jsonb
                json_build_object(
                    ''type'', ''LineString'',
                    ''coordinates'', array_agg(
                        json_build_array(n.lng, n.lat, n.elevation)
                        ORDER BY array_position(r.route_path, n.id)
                    )
                )::jsonb as route_path,
                -- Convert edges to JSON array - FIXED: Use jsonb
                json_agg(r.route_edges)::jsonb as route_edges,
                -- Generate proper route name
                generate_route_name(r.route_edges, r.route_shape) as route_name,
                NOW() as created_at
            FROM find_routes_recursive_configurable($4, $2, $3, $5, $6) r
            JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
            WHERE r.route_shape = $7
              AND r.similarity_score >= get_min_route_score()  -- Use configurable minimum score
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges', staging_schema, staging_schema)
            USING region_name, pattern.target_distance_km, pattern.target_elevation_gain, staging_schema, current_tolerance, 8, pattern.route_shape;
            
            GET DIAGNOSTICS routes_found = ROW_COUNT;
            
            -- Log route details for this iteration
            IF routes_found > 0 THEN
                RAISE NOTICE 'Routes found in iteration % (tolerance: %%%) for pattern %:', 
                    iteration, current_tolerance - 10.0, pattern.pattern_name;
                
                -- Get and log route details using a simpler approach
                DECLARE
                    route_detail RECORD;
                    route_query TEXT;
                BEGIN
                    route_query := format('
                        SELECT 
                            route_name,
                            recommended_distance_km,
                            recommended_elevation_gain,
                            ROUND(recommended_elevation_gain / recommended_distance_km, 1) as gain_rate_m_per_km,
                            route_shape,
                            trail_count,
                            route_score
                        FROM %I.route_recommendations 
                        WHERE input_distance_km = %s 
                          AND input_elevation_gain = %s 
                          AND route_shape = ''%s''
                        ORDER BY route_score DESC
                        LIMIT 5', 
                        staging_schema, 
                        pattern.target_distance_km, 
                        pattern.target_elevation_gain, 
                        pattern.route_shape);
                    
                    FOR route_detail IN EXECUTE route_query LOOP
                        RAISE NOTICE '  - %: %.1fkm, %.0fm gain (%.1f m/km), % shape, % trails, score: %', 
                            route_detail.route_name,
                            route_detail.recommended_distance_km,
                            route_detail.recommended_elevation_gain,
                            route_detail.gain_rate_m_per_km,
                            route_detail.route_shape,
                            route_detail.trail_count,
                            route_detail.route_score;
                    END LOOP;
                END;
            END IF;
            
            -- Populate route_trails junction table with trail composition data
            EXECUTE format('INSERT INTO %I.route_trails (
                route_uuid,
                trail_id,
                trail_name,
                segment_order,
                segment_distance_km,
                segment_elevation_gain,
                segment_elevation_loss
            )
            SELECT 
                r.route_id,
                e.trail_id,
                e.trail_name,
                ROW_NUMBER() OVER (PARTITION BY r.route_id ORDER BY array_position(r.route_path, e.source)) as segment_order,
                e.distance_km,
                e.elevation_gain,
                e.elevation_loss
            FROM find_routes_recursive_configurable($1, $2, $3, $4, $5) r
            JOIN %I.routing_edges e ON e.id = ANY(r.route_edges)
            WHERE r.route_shape = $6
              AND r.similarity_score >= get_min_route_score()', staging_schema, staging_schema)
            USING staging_schema, pattern.target_distance_km, pattern.target_elevation_gain, current_tolerance, 8, pattern.route_shape;
            
            -- Increase tolerance for next iteration
            current_tolerance := current_tolerance + 10.0;
            iteration := iteration + 1;
            
            RAISE NOTICE 'Pattern: %, Iteration: %, Tolerance: %%%, Routes found: %', 
                pattern.pattern_name, iteration, current_tolerance - 10.0, routes_found;
        END LOOP;
        
        total_routes := total_routes + routes_found;
        RAISE NOTICE 'Final: Generated % routes for pattern: % (tolerance: %%%)', 
            routes_found, pattern.pattern_name, current_tolerance - 10.0;
    END LOOP;
    
    -- Log final summary
    RAISE NOTICE '=== ROUTE GENERATION SUMMARY ===';
    RAISE NOTICE 'Total routes generated: %', total_routes;
    RAISE NOTICE 'Patterns processed: %', (SELECT COUNT(*) FROM route_patterns);
    RAISE NOTICE '================================';
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Alias function for backward compatibility - calls the configurable version
CREATE OR REPLACE FUNCTION generate_route_recommendations(staging_schema text) RETURNS integer AS $$
BEGIN
    RETURN generate_route_recommendations_configurable(staging_schema, 'boulder');
END;
$$ LANGUAGE plpgsql; 