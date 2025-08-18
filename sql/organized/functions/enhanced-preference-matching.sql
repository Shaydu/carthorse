-- Enhanced Preference-Based Cost Functions
-- These functions calculate "cost" as deviation from user preferences
-- Lower cost = better match to user's desired elevation gain rate, distance, and route shape

-- Function to get enhanced preference cost configuration
CREATE OR REPLACE FUNCTION get_enhanced_preference_cost_config() RETURNS json AS $$
BEGIN
    RETURN json_build_object(
        'priorityWeights', json_build_object(
            'elevation', (get_carthorse_config() ->> 'enhanced_preference_elevation_weight')::float,
            'distance', (get_carthorse_config() ->> 'enhanced_preference_distance_weight')::float,
            'shape', (get_carthorse_config() ->> 'enhanced_preference_shape_weight')::float
        ),
        'elevationCost', json_build_object(
            'deviationWeight', (get_carthorse_config() ->> 'elevation_deviation_weight')::float,
            'deviationExponent', (get_carthorse_config() ->> 'elevation_deviation_exponent')::float
        ),
        'distanceCost', json_build_object(
            'deviationWeight', (get_carthorse_config() ->> 'distance_deviation_weight')::float,
            'deviationExponent', (get_carthorse_config() ->> 'distance_deviation_exponent')::float
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Function to calculate elevation gain rate cost (deviation from target)
CREATE OR REPLACE FUNCTION calculate_elevation_gain_rate_cost(
    actual_gain_rate_m_per_km float,
    target_gain_rate_m_per_km float
) RETURNS float AS $$
DECLARE
    config json;
    deviation_weight float;
    deviation_exponent float;
    deviation_percent float;
    deviation_cost float;
    preference_cost float;
BEGIN
    config := get_enhanced_preference_cost_config();
    deviation_weight := (config ->> 'elevationCost')::json ->> 'deviationWeight';
    deviation_exponent := (config ->> 'elevationCost')::json ->> 'deviationExponent';
    
    -- Calculate deviation percentage
    IF target_gain_rate_m_per_km > 0 THEN
        deviation_percent := ABS(actual_gain_rate_m_per_km - target_gain_rate_m_per_km) / target_gain_rate_m_per_km;
    ELSE
        deviation_percent := 0;
    END IF;
    
    -- Calculate deviation cost (higher = worse match)
    deviation_cost := POWER(deviation_percent * deviation_weight, deviation_exponent);
    
    -- Calculate preference cost based on difficulty ranges (higher = less preferred)
    preference_cost := CASE
        WHEN actual_gain_rate_m_per_km >= 0 AND actual_gain_rate_m_per_km < 50 THEN 0.2  -- Easy terrain (low cost)
        WHEN actual_gain_rate_m_per_km >= 50 AND actual_gain_rate_m_per_km < 100 THEN 0.0  -- Moderate terrain (lowest cost)
        WHEN actual_gain_rate_m_per_km >= 100 AND actual_gain_rate_m_per_km < 150 THEN 0.1  -- Hard terrain (low cost)
        WHEN actual_gain_rate_m_per_km >= 150 AND actual_gain_rate_m_per_km < 200 THEN 0.3  -- Expert terrain (higher cost)
        WHEN actual_gain_rate_m_per_km >= 200 THEN 0.5  -- Extreme terrain (highest cost)
        ELSE 0.5
    END;
    
    -- Combine deviation cost and preference cost (weighted sum)
    RETURN (deviation_cost * 0.7) + (preference_cost * 0.3);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate distance cost (deviation from target)
CREATE OR REPLACE FUNCTION calculate_distance_cost(
    actual_distance_km float,
    target_distance_km float
) RETURNS float AS $$
DECLARE
    config json;
    deviation_weight float;
    deviation_exponent float;
    deviation_percent float;
    deviation_cost float;
    preference_cost float;
BEGIN
    config := get_enhanced_preference_cost_config();
    deviation_weight := (config ->> 'distanceCost')::json ->> 'deviationWeight';
    deviation_exponent := (config ->> 'distanceCost')::json ->> 'deviationExponent';
    
    -- Calculate deviation percentage
    IF target_distance_km > 0 THEN
        deviation_percent := ABS(actual_distance_km - target_distance_km) / target_distance_km;
    ELSE
        deviation_percent := 0;
    END IF;
    
    -- Calculate deviation cost (higher = worse match)
    deviation_cost := POWER(deviation_percent * deviation_weight, deviation_exponent);
    
    -- Calculate preference cost based on distance ranges (higher = less preferred)
    preference_cost := CASE
        WHEN actual_distance_km >= 0 AND actual_distance_km < 2 THEN 0.4   -- Very short routes (higher cost)
        WHEN actual_distance_km >= 2 AND actual_distance_km < 5 THEN 0.2   -- Short routes (moderate cost)
        WHEN actual_distance_km >= 5 AND actual_distance_km < 15 THEN 0.0  -- Medium routes (lowest cost)
        WHEN actual_distance_km >= 15 AND actual_distance_km < 25 THEN 0.1 -- Long routes (low cost)
        WHEN actual_distance_km >= 25 THEN 0.3                             -- Very long routes (higher cost)
        ELSE 0.5
    END;
    
    -- Combine deviation cost and preference cost (weighted sum)
    RETURN (deviation_cost * 0.7) + (preference_cost * 0.3);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate route shape cost (deviation from preferred shapes)
CREATE OR REPLACE FUNCTION calculate_route_shape_cost(
    route_shape text
) RETURNS float AS $$
BEGIN
    -- Return shape cost (lower = more preferred)
    RETURN CASE route_shape
        WHEN 'loop' THEN 0.0           -- Most preferred (lowest cost)
        WHEN 'out-and-back' THEN 0.1   -- Highly preferred (low cost)
        WHEN 'point-to-point' THEN 0.3 -- Less preferred (higher cost)
        ELSE 0.5                       -- Default for unknown shapes (highest cost)
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate overall preference cost (lower = better match to user preferences)
CREATE OR REPLACE FUNCTION calculate_overall_preference_cost(
    actual_gain_rate_m_per_km float,
    target_gain_rate_m_per_km float,
    actual_distance_km float,
    target_distance_km float,
    route_shape text
) RETURNS float AS $$
DECLARE
    config json;
    elevation_weight float;
    distance_weight float;
    shape_weight float;
    elevation_cost float;
    distance_cost float;
    shape_cost float;
    overall_cost float;
BEGIN
    config := get_enhanced_preference_cost_config();
    
    -- Get priority weights
    elevation_weight := (config ->> 'priorityWeights')::json ->> 'elevation';
    distance_weight := (config ->> 'priorityWeights')::json ->> 'distance';
    shape_weight := (config ->> 'priorityWeights')::json ->> 'shape';
    
    -- Calculate individual costs
    elevation_cost := calculate_elevation_gain_rate_cost(actual_gain_rate_m_per_km, target_gain_rate_m_per_km);
    distance_cost := calculate_distance_cost(actual_distance_km, target_distance_km);
    shape_cost := calculate_route_shape_cost(route_shape);
    
    -- Calculate weighted overall cost (lower = better match to preferences)
    overall_cost := (elevation_cost * elevation_weight) + 
                   (distance_cost * distance_weight) + 
                   (shape_cost * shape_weight);
    
    -- Normalize to 0-100 range (lower = better)
    RETURN overall_cost * 100;
END;
$$ LANGUAGE plpgsql;

-- Function to find routes with minimum preference cost (best matches to user preferences)
CREATE OR REPLACE FUNCTION find_routes_with_minimum_preference_cost(
    staging_schema text,
    target_distance_km float,
    target_elevation_gain float,
    max_routes integer DEFAULT 50
) RETURNS TABLE(
    route_id text,
    total_distance_km float,
    total_elevation_gain float,
    elevation_gain_rate_m_per_km float,
    route_shape text,
    preference_cost float,
    elevation_cost float,
    distance_cost float,
    shape_cost float
) AS $$
BEGIN
    RETURN QUERY EXECUTE format($f$
        WITH route_costs AS (
            SELECT 
                r.route_id,
                r.total_distance_km,
                r.total_elevation_gain,
                CASE 
                    WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                    ELSE 0
                END as elevation_gain_rate_m_per_km,
                r.route_shape,
                calculate_overall_preference_cost(
                    CASE 
                        WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                        ELSE 0
                    END,
                    $2 / $1,  -- Target elevation gain rate
                    r.total_distance_km,
                    $1,       -- Target distance
                    r.route_shape
                ) as preference_cost,
                calculate_elevation_gain_rate_cost(
                    CASE 
                        WHEN r.total_distance_km > 0 THEN r.total_elevation_gain / r.total_distance_km
                        ELSE 0
                    END,
                    $2 / $1  -- Target elevation gain rate
                ) * 100 as elevation_cost,
                calculate_distance_cost(
                    r.total_distance_km,
                    $1  -- Target distance
                ) * 100 as distance_cost,
                calculate_route_shape_cost(r.route_shape) * 100 as shape_cost
            FROM find_routes_recursive_configurable($3, $1::float, $2::float, 20.0, 8) r
        )
        SELECT 
            route_id,
            total_distance_km,
            total_elevation_gain,
            elevation_gain_rate_m_per_km,
            route_shape,
            preference_cost,
            elevation_cost,
            distance_cost,
            shape_cost
        FROM route_costs
        ORDER BY preference_cost ASC  -- Lower cost = better match to preferences
        LIMIT $4
    $f$, staging_schema)
    USING target_distance_km, target_elevation_gain, staging_schema, max_routes;
END;
$$ LANGUAGE plpgsql;
