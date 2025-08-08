-- Create missing functions for route recommendations

-- Calculate route similarity score
CREATE OR REPLACE FUNCTION public.calculate_route_similarity_score(
    actual_distance_km double precision,
    target_distance_km double precision,
    actual_elevation_gain double precision,
    target_elevation_gain double precision
)
RETURNS double precision
LANGUAGE plpgsql
AS $function$
DECLARE
    distance_score double precision;
    elevation_score double precision;
    combined_score double precision;
BEGIN
    -- Calculate distance similarity (0-1, where 1 is perfect match)
    IF target_distance_km = 0 THEN
        distance_score := 0;
    ELSE
        distance_score := 1.0 - ABS(actual_distance_km - target_distance_km) / target_distance_km;
        distance_score := GREATEST(0, LEAST(1, distance_score));  -- Clamp to 0-1
    END IF;
    
    -- Calculate elevation similarity (0-1, where 1 is perfect match)
    IF target_elevation_gain = 0 THEN
        elevation_score := 0;
    ELSE
        elevation_score := 1.0 - ABS(actual_elevation_gain - target_elevation_gain) / target_elevation_gain;
        elevation_score := GREATEST(0, LEAST(1, elevation_score));  -- Clamp to 0-1
    END IF;
    
    -- Combine scores (weighted average)
    combined_score := (distance_score * 0.6) + (elevation_score * 0.4);
    
    RETURN combined_score;
END;
$function$;

-- Get maximum routes per bin
CREATE OR REPLACE FUNCTION public.get_max_routes_per_bin()
RETURNS integer
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN 10;  -- Return top 10 routes per pattern
END;
$function$; 