-- =============================================================================
-- SIMPLE WORKING ROUTING FUNCTION
-- =============================================================================
-- This function uses a simpler approach to find routes
-- Includes logging to see what's happening
-- =============================================================================

-- Function to find simple routes with logging
CREATE OR REPLACE FUNCTION find_simple_routes_with_logging(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    tolerance_percent float DEFAULT 30.0
) RETURNS TABLE(
    route_id text,
    start_node integer,
    end_node integer,
    total_distance_km double precision,
    total_elevation_gain double precision,
    route_path integer[],
    route_edges integer[],
    route_shape text,
    trail_count integer,
    similarity_score double precision
) AS $$
DECLARE
    min_distance float;
    max_distance float;
    min_elevation float;
    max_elevation float;
    edge_count integer;
    route_count integer;
BEGIN
    -- Calculate tolerance ranges
    min_distance := target_distance_km * (1 - tolerance_percent / 100.0);
    max_distance := target_distance_km * (1 + tolerance_percent / 100.0);
    min_elevation := target_elevation_gain * (1 - tolerance_percent / 100.0);
    max_elevation := target_elevation_gain * (1 + tolerance_percent / 100.0);
    
    -- Log the search parameters
    RAISE NOTICE 'Searching for routes: distance %.1f-%.1f km, elevation %.0f-%.0f m', 
        min_distance, max_distance, min_elevation, max_elevation;
    
    -- Count available edges
    EXECUTE format('SELECT COUNT(*) FROM %I.routing_edges WHERE distance_km BETWEEN %s AND %s', 
        staging_schema, min_distance, max_distance) INTO edge_count;
    RAISE NOTICE 'Found % edges in distance range', edge_count;
    
    RETURN QUERY EXECUTE format($f$
        WITH simple_routes AS (
            -- Find simple 2-edge routes that meet our criteria
            SELECT 
                gen_random_uuid()::text as route_id,
                e1.source as start_node,
                e2.target as end_node,
                (e1.distance_km + e2.distance_km)::double precision as total_distance_km,
                (COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0))::double precision as total_elevation_gain,
                ARRAY[e1.source, e1.target, e2.target] as route_path,
                ARRAY[e1.id, e2.id] as route_edges,
                CASE 
                    WHEN e1.source = e2.target THEN 'loop'
                    ELSE 'out-and-back'
                END as route_shape,
                2 as trail_count,
                calculate_route_similarity_score(
                    e1.distance_km + e2.distance_km, $1,
                    COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0), $2
                ) as similarity_score
            FROM %I.routing_edges e1
            JOIN %I.routing_edges e2 ON e1.target = e2.source
            WHERE e1.distance_km + e2.distance_km BETWEEN $3 AND $4
              AND COALESCE(e1.elevation_gain, 0) + COALESCE(e2.elevation_gain, 0) BETWEEN $5 AND $6
              AND e1.source != e2.target  -- Avoid self-loops
        ),
        valid_routes AS (
            SELECT * FROM simple_routes
            WHERE similarity_score >= get_min_route_score()
            ORDER BY similarity_score DESC
            LIMIT get_max_routes_per_bin()
        )
        SELECT * FROM valid_routes
    $f$, staging_schema, staging_schema)
    USING target_distance_km, target_elevation_gain, min_distance, max_distance, min_elevation, max_elevation;
    
    -- Log results
    GET DIAGNOSTICS route_count = ROW_COUNT;
    RAISE NOTICE 'Generated % routes', route_count;
END;
$$ LANGUAGE plpgsql;

-- Function to generate route recommendations using the simple approach
CREATE OR REPLACE FUNCTION generate_simple_route_recommendations(
    staging_schema text,
    region_name text DEFAULT 'boulder'
) RETURNS integer AS $$
DECLARE
    pattern record;
    routes_found integer := 0;
    total_routes integer := 0;
BEGIN
    RAISE NOTICE 'Starting simple route generation for region: %', region_name;
    
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

    -- Clear existing recommendations
    EXECUTE format('DELETE FROM %I.route_recommendations', staging_schema);
    EXECUTE format('DELETE FROM %I.route_trails', staging_schema);

    -- Process each route pattern
    FOR pattern IN SELECT * FROM route_patterns WHERE pattern_name LIKE '%Loop%' OR pattern_name LIKE '%Out-and-Back%' ORDER BY target_distance_km LOOP
        RAISE NOTICE 'Processing pattern: % (%.1f km, %.0f m)', 
            pattern.pattern_name, pattern.target_distance_km, pattern.target_elevation_gain;
        
        -- Find routes for this pattern
        EXECUTE format('
            INSERT INTO %I.route_recommendations (
                route_uuid, region, input_distance_km, input_elevation_gain,
                recommended_distance_km, recommended_elevation_gain, route_type,
                route_shape, trail_count, route_score, route_path, route_edges, route_name
            )
            SELECT 
                r.route_id,
                $1 as region,
                $2 as input_distance_km,
                $3 as input_elevation_gain,
                r.total_distance_km,
                r.total_elevation_gain,
                ''similar_distance'' as route_type,
                r.route_shape,
                r.trail_count,
                (r.similarity_score * 100)::integer as route_score,
                json_build_object(
                    ''type'', ''LineString'',
                    ''coordinates'', array_agg(
                        json_build_array(n.lng, n.lat, n.elevation)
                        ORDER BY array_position(r.route_path, n.id)
                    )
                )::jsonb as route_path,
                json_agg(r.route_edges)::jsonb as route_edges,
                ''Generated Route '' || r.route_id as route_name
            FROM find_simple_routes_with_logging($4, $2, $3, $5) r
            JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
            WHERE r.route_shape = $6
            GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain,
                     r.route_shape, r.trail_count, r.similarity_score, r.route_edges
        ', staging_schema, staging_schema)
        USING region_name, pattern.target_distance_km, pattern.target_elevation_gain, 
              staging_schema, pattern.tolerance_percent, pattern.route_shape;
        
        GET DIAGNOSTICS routes_found = ROW_COUNT;
        total_routes := total_routes + routes_found;
        RAISE NOTICE 'Found % routes for pattern %', routes_found, pattern.pattern_name;
    END LOOP;
    
    RAISE NOTICE 'Total routes generated: %', total_routes;
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql; 