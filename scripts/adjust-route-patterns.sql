-- Adjust Route Patterns to Match Actual Trail Data
-- Current patterns are too ambitious for the actual trail characteristics

-- First, let's see what patterns currently exist
SELECT 'Current patterns:' as info;
SELECT * FROM get_route_patterns() ORDER BY target_distance_km, target_elevation_gain;

-- Add new patterns that match actual trail data characteristics
-- Based on analysis: avg_length=1km, avg_elevation=67m, max_length=16km, max_elevation=1094m

-- Insert new realistic patterns
INSERT INTO route_patterns (pattern_name, target_distance_km, target_elevation_gain, route_shape, tolerance_percent) VALUES
-- Very Short Routes (for small trail networks)
('Micro Loop', 0.5, 50, 'loop', 30),
('Micro Point-to-Point', 0.8, 75, 'point-to-point', 30),
('Micro Out-and-Back', 1.0, 100, 'out-and-back', 30),

-- Short Routes (matching average trail characteristics)
('Short Loop', 1.0, 75, 'loop', 25),
('Short Point-to-Point', 1.5, 100, 'point-to-point', 25),
('Short Out-and-Back', 2.0, 125, 'out-and-back', 25),

-- Medium Routes (for longer trail combinations)
('Medium Loop', 3.0, 200, 'loop', 20),
('Medium Point-to-Point', 4.0, 250, 'point-to-point', 20),
('Medium Out-and-Back', 5.0, 300, 'out-and-back', 20),

-- Long Routes (for ambitious hikers)
('Long Loop', 8.0, 400, 'loop', 15),
('Long Point-to-Point', 10.0, 500, 'point-to-point', 15),
('Long Out-and-Back', 12.0, 600, 'out-and-back', 15),

-- Very Long Routes (for the most ambitious)
('Epic Loop', 15.0, 800, 'loop', 10),
('Epic Point-to-Point', 18.0, 1000, 'point-to-point', 10),
('Epic Out-and-Back', 20.0, 1200, 'out-and-back', 10);

-- Show the updated patterns
SELECT 'Updated patterns:' as info;
SELECT * FROM get_route_patterns() ORDER BY target_distance_km, target_elevation_gain;

-- Test the new patterns
SELECT 'Testing new patterns with actual trail data...' as info;

-- Check how many trails could potentially form each pattern type
SELECT 
    'Trails by length' as category,
    COUNT(*) as trail_count,
    AVG(length_km) as avg_length,
    MAX(length_km) as max_length
FROM public.trails 
WHERE region = 'boulder' 
AND length_km > 0.1;

SELECT 
    'Trails by elevation' as category,
    COUNT(*) as trail_count,
    AVG(elevation_gain) as avg_elevation,
    MAX(elevation_gain) as max_elevation
FROM public.trails 
WHERE region = 'boulder' 
AND elevation_gain > 10; 