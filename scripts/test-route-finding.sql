-- Test Route Finding Algorithm Step by Step
-- This script helps debug why no routes are being generated

-- 1. Check if we have a staging schema to test with
SELECT 'Checking for staging schemas...' as info;
SELECT schemaname FROM pg_tables WHERE schemaname LIKE 'staging_%' ORDER BY schemaname;

-- 2. If no staging schema exists, we need to create one for testing
-- For now, let's test the algorithm logic with a simple example

-- 3. Test the similarity score calculation
SELECT 'Testing similarity score calculation...' as info;
SELECT 
    calculate_route_similarity_score(1.0, 1.0, 75.0, 75.0) as perfect_match,
    calculate_route_similarity_score(1.2, 1.0, 80.0, 75.0) as good_match,
    calculate_route_similarity_score(2.0, 1.0, 150.0, 75.0) as poor_match;

-- 4. Test the minimum score requirement
SELECT 'Testing minimum score requirement...' as info;
SELECT get_min_route_score() as min_score;

-- 5. Test route pattern requirements
SELECT 'Testing route patterns...' as info;
SELECT * FROM get_route_patterns() ORDER BY target_distance_km LIMIT 5;

-- 6. Test configuration values
SELECT 'Testing configuration values...' as info;
SELECT 
    get_max_routes_per_bin() as max_routes,
    get_min_route_score() as min_score,
    get_route_distance_limits() as distance_limits,
    get_elevation_limits() as elevation_limits;

-- 7. Test if the algorithm can find simple routes
-- (This would require a staging schema with data)
SELECT 'Note: To test actual route finding, we need a staging schema with routing data' as info; 