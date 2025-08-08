-- Fix route recommendations to include trail composition data
-- This adds the missing route_trails population logic

-- Drop the old functions first
DROP FUNCTION IF EXISTS generate_route_recommendations_uuid(text, text);
DROP FUNCTION IF EXISTS generate_route_recommendations(text);

-- Fixed route recommendations generation function WITH trail composition
CREATE OR REPLACE FUNCTION generate_route_recommendations_uuid(
    staging_schema text,
    region_name text DEFAULT 'boulder'
) RETURNS integer AS $$
DECLARE
    route_count integer := 0;
    total_routes integer := 0;
    pattern_distance float;
    pattern_elevation float;
    start_time timestamp;
BEGIN
    start_time := clock_timestamp();
    RAISE NOTICE 'Starting route recommendation generation at %', start_time;
    
    pattern_distance := 2.0;
    pattern_elevation := 300.0;
    
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
    
    -- Clear existing route_trails data
    EXECUTE format('DELETE FROM %I.route_trails', staging_schema);
    
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
            r.segment_count as trail_count,
            (r.similarity_score * 100)::integer as route_score,
            json_build_object(
                ''type'', ''LineString'',
                ''coordinates'', array_agg(
                    json_build_array(n.lng, n.lat, COALESCE(n.elevation, 0))
                    ORDER BY array_position(r.route_path, n.id)
                )
            )::jsonb as route_path,
            json_agg(r.route_edges)::jsonb as route_edges,
            %L || '' '' || r.route_shape || '' Route - '' || 
            ROUND(r.total_distance_km::numeric, 1) || ''km, '' || 
            ROUND(r.total_elevation_gain::numeric) || ''m gain'' as route_name,
            NOW() as created_at
        FROM (
            SELECT DISTINCT ON (r.route_path) r.*
            FROM find_routes_recursive_configurable_uuid(
                %L,
                %L,
                %L,
                20.0,  -- 20%% tolerance
                8
            ) r
            WHERE r.route_shape = ANY(ARRAY[''loop'', ''point-to-point'', ''out-and-back''])
              AND r.similarity_score >= 0.3
            ORDER BY r.route_path, r.similarity_score DESC
        ) r
        JOIN %I.routing_nodes n ON n.id = ANY(r.route_path)
        GROUP BY r.route_id, r.total_distance_km, r.total_elevation_gain, 
                 r.route_shape, r.segment_count, r.similarity_score, r.route_edges
    ', staging_schema, region_name, pattern_distance, pattern_elevation, region_name,
       staging_schema, pattern_distance, pattern_elevation, staging_schema);
    
    GET DIAGNOSTICS route_count = ROW_COUNT;
    total_routes := total_routes + route_count;
    RAISE NOTICE 'Generated % routes', route_count;
    
    -- NOW POPULATE THE ROUTE_TRAILS TABLE WITH TRAIL COMPOSITION DATA
    EXECUTE format('
        INSERT INTO %I.route_trails (
            route_uuid,
            trail_id,
            trail_name,
            segment_order,
            segment_distance_km,
            segment_elevation_gain,
            segment_elevation_loss
        )
        SELECT 
            r.route_uuid,
            e.trail_id,
            e.trail_name,
            ROW_NUMBER() OVER (PARTITION BY r.route_uuid ORDER BY array_position(r.route_edges, e.id::text)) as segment_order,
            e.length_km,
            e.elevation_gain,
            e.elevation_loss
        FROM %I.route_recommendations r
        JOIN %I.routing_edges e ON e.id::text = ANY(r.route_edges)
        WHERE r.route_edges IS NOT NULL
          AND jsonb_array_length(r.route_edges) > 0
    ', staging_schema, staging_schema, staging_schema);
    
    RAISE NOTICE 'Populated route_trails table with trail composition data';
    
    RETURN total_routes;
END;
$$ LANGUAGE plpgsql;

-- Create a wrapper function that matches the expected signature
CREATE OR REPLACE FUNCTION generate_route_recommendations(staging_schema text) RETURNS integer AS $$
BEGIN
    RETURN generate_route_recommendations_uuid(staging_schema, 'boulder');
END;
$$ LANGUAGE plpgsql; 