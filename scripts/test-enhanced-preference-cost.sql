-- Test Enhanced Preference-Based Cost Routing Functions
-- This script tests the SQL functions for the enhanced cost routing system

-- Set up test environment
\set staging_schema 'staging_test'
\set target_distance_km 10.0
\set target_elevation_gain 500.0

-- Test 1: Test elevation gain rate cost calculation
SELECT 'Test 1: Elevation Gain Rate Cost Calculation' as test_name;

-- Perfect match (should have very low cost)
SELECT 
    'Perfect match' as scenario,
    calculate_elevation_gain_rate_cost(50.0, 50.0) as cost,
    CASE 
        WHEN calculate_elevation_gain_rate_cost(50.0, 50.0) < 0.1 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Moderate deviation (should have moderate cost)
SELECT 
    'Moderate deviation' as scenario,
    calculate_elevation_gain_rate_cost(75.0, 50.0) as cost,
    CASE 
        WHEN calculate_elevation_gain_rate_cost(75.0, 50.0) > 0.1 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Large deviation (should have high cost)
SELECT 
    'Large deviation' as scenario,
    calculate_elevation_gain_rate_cost(150.0, 50.0) as cost,
    CASE 
        WHEN calculate_elevation_gain_rate_cost(150.0, 50.0) > 0.5 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 2: Test distance cost calculation
SELECT 'Test 2: Distance Cost Calculation' as test_name;

-- Perfect match (should have very low cost)
SELECT 
    'Perfect match' as scenario,
    calculate_distance_cost(10.0, 10.0) as cost,
    CASE 
        WHEN calculate_distance_cost(10.0, 10.0) < 0.1 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Moderate deviation (should have moderate cost)
SELECT 
    'Moderate deviation' as scenario,
    calculate_distance_cost(15.0, 10.0) as cost,
    CASE 
        WHEN calculate_distance_cost(15.0, 10.0) > 0.1 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Large deviation (should have high cost)
SELECT 
    'Large deviation' as scenario,
    calculate_distance_cost(25.0, 10.0) as cost,
    CASE 
        WHEN calculate_distance_cost(25.0, 10.0) > 0.5 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 3: Test route shape cost calculation
SELECT 'Test 3: Route Shape Cost Calculation' as test_name;

-- Loop (should have lowest cost)
SELECT 
    'Loop route' as scenario,
    calculate_route_shape_cost('loop') as cost,
    CASE 
        WHEN calculate_route_shape_cost('loop') = 0.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Out-and-back (should have low cost)
SELECT 
    'Out-and-back route' as scenario,
    calculate_route_shape_cost('out-and-back') as cost,
    CASE 
        WHEN calculate_route_shape_cost('out-and-back') = 0.1 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Point-to-point (should have higher cost)
SELECT 
    'Point-to-point route' as scenario,
    calculate_route_shape_cost('point-to-point') as cost,
    CASE 
        WHEN calculate_route_shape_cost('point-to-point') = 0.3 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Unknown shape (should have highest cost)
SELECT 
    'Unknown shape' as scenario,
    calculate_route_shape_cost('unknown') as cost,
    CASE 
        WHEN calculate_route_shape_cost('unknown') = 0.5 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 4: Test overall preference cost calculation
SELECT 'Test 4: Overall Preference Cost Calculation' as test_name;

-- Perfect match on all parameters
SELECT 
    'Perfect match' as scenario,
    calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') as cost,
    CASE 
        WHEN calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') < 10.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Good elevation match, poor distance match
SELECT 
    'Good elevation, poor distance' as scenario,
    calculate_overall_preference_cost(50.0, 50.0, 20.0, 10.0, 'loop') as cost,
    CASE 
        WHEN calculate_overall_preference_cost(50.0, 50.0, 20.0, 10.0, 'loop') > 10.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Poor elevation match, good distance match
SELECT 
    'Poor elevation, good distance' as scenario,
    calculate_overall_preference_cost(150.0, 50.0, 10.0, 10.0, 'loop') as cost,
    CASE 
        WHEN calculate_overall_preference_cost(150.0, 50.0, 10.0, 10.0, 'loop') > 10.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Poor match on all parameters
SELECT 
    'Poor match on all' as scenario,
    calculate_overall_preference_cost(200.0, 50.0, 25.0, 10.0, 'point-to-point') as cost,
    CASE 
        WHEN calculate_overall_preference_cost(200.0, 50.0, 25.0, 10.0, 'point-to-point') > 30.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 5: Test configuration loading
SELECT 'Test 5: Configuration Loading' as test_name;

SELECT 
    'Config loaded' as scenario,
    CASE 
        WHEN get_enhanced_preference_cost_config() IS NOT NULL THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 6: Test edge cases
SELECT 'Test 6: Edge Cases' as test_name;

-- Zero target values
SELECT 
    'Zero target elevation gain rate' as scenario,
    calculate_elevation_gain_rate_cost(50.0, 0.0) as cost,
    CASE 
        WHEN calculate_elevation_gain_rate_cost(50.0, 0.0) >= 0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

SELECT 
    'Zero target distance' as scenario,
    calculate_distance_cost(10.0, 0.0) as cost,
    CASE 
        WHEN calculate_distance_cost(10.0, 0.0) >= 0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Very large deviations
SELECT 
    'Very large elevation deviation' as scenario,
    calculate_elevation_gain_rate_cost(1000.0, 50.0) as cost,
    CASE 
        WHEN calculate_elevation_gain_rate_cost(1000.0, 50.0) > 1.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

SELECT 
    'Very large distance deviation' as scenario,
    calculate_distance_cost(100.0, 10.0) as cost,
    CASE 
        WHEN calculate_distance_cost(100.0, 10.0) > 1.0 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 7: Test priority weights
SELECT 'Test 7: Priority Weights' as test_name;

-- Test that elevation has higher weight than distance
WITH test_costs AS (
    SELECT 
        calculate_overall_preference_cost(100.0, 50.0, 10.0, 10.0, 'loop') as elevation_mismatch_cost,
        calculate_overall_preference_cost(50.0, 50.0, 20.0, 10.0, 'loop') as distance_mismatch_cost
)
SELECT 
    'Elevation weight > Distance weight' as scenario,
    elevation_mismatch_cost,
    distance_mismatch_cost,
    CASE 
        WHEN elevation_mismatch_cost > distance_mismatch_cost THEN 'PASS'
        ELSE 'FAIL'
    END as result
FROM test_costs;

-- Test 8: Test cost normalization
SELECT 'Test 8: Cost Normalization' as test_name;

-- Test that costs are in reasonable range (0-100)
SELECT 
    'Cost in 0-100 range' as scenario,
    calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') as cost,
    CASE 
        WHEN calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') >= 0 
         AND calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') <= 100 THEN 'PASS'
        ELSE 'FAIL'
    END as result;

-- Test 9: Test preference ordering
SELECT 'Test 9: Preference Ordering' as test_name;

-- Test that loop routes are preferred over point-to-point
WITH test_shapes AS (
    SELECT 
        calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') as loop_cost,
        calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'point-to-point') as point_to_point_cost
)
SELECT 
    'Loop preferred over point-to-point' as scenario,
    loop_cost,
    point_to_point_cost,
    CASE 
        WHEN loop_cost < point_to_point_cost THEN 'PASS'
        ELSE 'FAIL'
    END as result
FROM test_shapes;

-- Test 10: Test moderate terrain preference
SELECT 'Test 10: Moderate Terrain Preference' as test_name;

-- Test that moderate terrain (50-100 m/km) is preferred
WITH terrain_costs AS (
    SELECT 
        calculate_overall_preference_cost(25.0, 50.0, 10.0, 10.0, 'loop') as easy_terrain_cost,
        calculate_overall_preference_cost(75.0, 50.0, 10.0, 10.0, 'loop') as moderate_terrain_cost,
        calculate_overall_preference_cost(125.0, 50.0, 10.0, 10.0, 'loop') as hard_terrain_cost
)
SELECT 
    'Moderate terrain preferred' as scenario,
    easy_terrain_cost,
    moderate_terrain_cost,
    hard_terrain_cost,
    CASE 
        WHEN moderate_terrain_cost < easy_terrain_cost 
         AND moderate_terrain_cost < hard_terrain_cost THEN 'PASS'
        ELSE 'FAIL'
    END as result
FROM terrain_costs;

-- Summary
SELECT 'Test Summary' as summary;
SELECT 
    COUNT(*) as total_tests,
    COUNT(CASE WHEN result = 'PASS' THEN 1 END) as passed_tests,
    COUNT(CASE WHEN result = 'FAIL' THEN 1 END) as failed_tests
FROM (
    -- Collect all test results from above
    SELECT 'Test 1' as test_group, 'Perfect match' as test_name, 
           CASE WHEN calculate_elevation_gain_rate_cost(50.0, 50.0) < 0.1 THEN 'PASS' ELSE 'FAIL' END as result
    UNION ALL
    SELECT 'Test 2', 'Perfect match', 
           CASE WHEN calculate_distance_cost(10.0, 10.0) < 0.1 THEN 'PASS' ELSE 'FAIL' END
    UNION ALL
    SELECT 'Test 3', 'Loop route', 
           CASE WHEN calculate_route_shape_cost('loop') = 0.0 THEN 'PASS' ELSE 'FAIL' END
    UNION ALL
    SELECT 'Test 4', 'Perfect match', 
           CASE WHEN calculate_overall_preference_cost(50.0, 50.0, 10.0, 10.0, 'loop') < 10.0 THEN 'PASS' ELSE 'FAIL' END
    UNION ALL
    SELECT 'Test 5', 'Config loaded', 
           CASE WHEN get_enhanced_preference_cost_config() IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
) as all_tests;

