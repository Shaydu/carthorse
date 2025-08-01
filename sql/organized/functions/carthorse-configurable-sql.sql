
-- =============================================================================
-- CONFIGURABLE SQL VALUES FROM YAML CONFIGS
-- =============================================================================
-- This file contains SQL functions and constants derived from configs/carthorse.config.yaml
-- and configs/route-discovery.config.yaml
-- =============================================================================

-- Configuration constants
CREATE OR REPLACE FUNCTION get_carthorse_config() RETURNS json AS $$
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
$$ LANGUAGE plpgsql;

-- Helper functions to get specific config values
CREATE OR REPLACE FUNCTION get_intersection_tolerance() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'intersection_tolerance')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_edge_tolerance() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'edge_tolerance')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_simplify_tolerance() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'simplify_tolerance')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_batch_size() RETURNS integer AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'batch_size')::integer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_timeout_ms() RETURNS integer AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'timeout_ms')::integer;
END;
$$ LANGUAGE plpgsql;

-- Route discovery config functions
CREATE OR REPLACE FUNCTION get_max_routes_per_bin() RETURNS integer AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'max_routes_per_bin')::integer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_min_route_score() RETURNS float AS $$
BEGIN
    RETURN (get_carthorse_config() ->> 'min_route_score')::float;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_route_distance_limits() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'min_km', (get_carthorse_config() ->> 'min_route_distance_km')::float,
        'max_km', (get_carthorse_config() ->> 'max_route_distance_km')::float
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_elevation_gain_limits() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'min_meters', (get_carthorse_config() ->> 'min_elevation_gain_meters')::float,
        'max_meters', (get_carthorse_config() ->> 'max_elevation_gain_meters')::float
    );
END;
$$ LANGUAGE plpgsql;

-- Route scoring functions
CREATE OR REPLACE FUNCTION get_scoring_weights() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'distance_weight', (get_carthorse_config() ->> 'distance_weight')::float,
        'elevation_weight', (get_carthorse_config() ->> 'elevation_weight')::float,
        'quality_weight', (get_carthorse_config() ->> 'quality_weight')::float
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_cost_weights() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'steepness_weight', (get_carthorse_config() ->> 'steepness_weight')::float,
        'distance_weight', (get_carthorse_config() ->> 'routing_distance_weight')::float
    );
END;
$$ LANGUAGE plpgsql;

-- Route pattern table for recommendations
CREATE TABLE IF NOT EXISTS route_patterns (
    id SERIAL PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    target_distance_km FLOAT NOT NULL,
    target_elevation_gain FLOAT NOT NULL,
    route_shape TEXT NOT NULL,
    tolerance_percent FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default route patterns from config (only loop and out-and-back routes)
INSERT INTO route_patterns (pattern_name, target_distance_km, target_elevation_gain, route_shape, tolerance_percent) VALUES
('Short Loop', 5, 200, 'loop', 20),
('Medium Loop', 10, 400, 'loop', 20),
('Long Loop', 15, 600, 'loop', 20),
('Short Out-and-Back', 8, 300, 'out-and-back', 20),
('Medium Out-and-Back', 12, 500, 'out-and-back', 20),
('Long Out-and-Back', 18, 700, 'out-and-back', 20)
ON CONFLICT (pattern_name) DO NOTHING;

-- Function to get route patterns
CREATE OR REPLACE FUNCTION get_route_patterns() RETURNS TABLE(
    pattern_name text,
    target_distance_km float,
    target_elevation_gain float,
    route_shape text,
    tolerance_percent float
) AS $$
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
$$ LANGUAGE plpgsql;

-- Function to calculate route similarity score using config weights
CREATE OR REPLACE FUNCTION calculate_route_similarity_score(
    actual_distance_km float,
    target_distance_km float,
    actual_elevation_gain float,
    target_elevation_gain float
) RETURNS float AS $$
DECLARE
    weights json;
    distance_score float;
    elevation_score float;
BEGIN
    weights := get_scoring_weights();
    
    -- Calculate individual scores (0-1, where 1 is perfect match)
    distance_score := GREATEST(0, 1 - ABS(actual_distance_km - target_distance_km) / target_distance_km);
    elevation_score := GREATEST(0, 1 - ABS(actual_elevation_gain - target_elevation_gain) / target_elevation_gain);
    
    -- Return weighted average
    RETURN (weights ->> 'distance_weight')::float * distance_score + 
           (weights ->> 'elevation_weight')::float * elevation_score;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate route cost using config weights
CREATE OR REPLACE FUNCTION calculate_route_cost(
    steepness_m_per_km float,
    distance_km float
) RETURNS float AS $$
DECLARE
    weights json;
BEGIN
    weights := get_cost_weights();
    
    RETURN (steepness_m_per_km * (weights ->> 'steepness_weight')::float) + 
           (distance_km * (weights ->> 'distance_weight')::float);
END;
$$ LANGUAGE plpgsql;
