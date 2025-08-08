-- Cleanup Route Patterns to Single Source of Truth
-- This script removes all existing patterns and inserts only the consolidated patterns

-- First, let's see what patterns currently exist
SELECT 'Current patterns before cleanup:' as info;
SELECT pattern_name, target_distance_km, target_elevation_gain, route_shape FROM route_patterns ORDER BY target_distance_km;

-- Clear all existing patterns to start fresh
DELETE FROM route_patterns;

-- Insert consolidated patterns from single source of truth
INSERT INTO route_patterns (pattern_name, target_distance_km, target_elevation_gain, route_shape, tolerance_percent) VALUES
-- Micro Routes (for very small trail networks)
('Micro Loop', 0.5, 50, 'loop', 30),
('Micro Out-and-Back', 1.0, 75, 'out-and-back', 30),
('Micro Point-to-Point', 0.8, 60, 'point-to-point', 30),

-- Short Routes (for small trail combinations)
('Short Loop', 1.5, 100, 'loop', 25),
('Short Out-and-Back', 2.0, 125, 'out-and-back', 25),
('Short Point-to-Point', 1.8, 110, 'point-to-point', 25),

-- Medium Routes (for moderate trail combinations)
('Medium Loop', 3.0, 200, 'loop', 20),
('Medium Out-and-Back', 5.0, 300, 'out-and-back', 20),
('Medium Point-to-Point', 4.0, 250, 'point-to-point', 20),

-- Long Routes (for longer trail combinations)
('Long Loop', 8.0, 400, 'loop', 15),
('Long Out-and-Back', 12.0, 600, 'out-and-back', 15),
('Long Point-to-Point', 10.0, 500, 'point-to-point', 15),

-- Epic Routes (for ambitious hikers and large trail networks)
('Epic Loop', 15.0, 800, 'loop', 10),
('Epic Out-and-Back', 20.0, 1200, 'out-and-back', 10),
('Epic Point-to-Point', 18.0, 1000, 'point-to-point', 10);

-- Show the cleaned up patterns
SELECT 'Cleaned up patterns (single source of truth):' as info;
SELECT pattern_name, target_distance_km, target_elevation_gain, route_shape FROM route_patterns ORDER BY target_distance_km;

SELECT 'Total patterns after cleanup:' as info;
SELECT COUNT(*) as total_patterns FROM route_patterns; 