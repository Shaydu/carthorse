-- Comprehensive Carthorse Database Function Cleanup
-- This script removes unused and duplicate functions from the database
-- Based on analysis of CarthorseOrchestrator.ts usage

-- Functions USED by CarthorseOrchestrator (DO NOT DELETE):
-- - detect_trail_intersections
-- - copy_trails_to_staging_v1
-- - split_trails_in_staging_v1
-- - generate_routing_nodes_native_v2_with_trail_ids
-- - generate_routing_edges_native_v2
-- - cleanup_orphaned_nodes
-- - generate_route_recommendations

-- Functions that appear to be UNUSED and can be safely deleted:

-- 1. Old/duplicate routing functions (replaced by newer versions)
DROP FUNCTION IF EXISTS build_routing_edges(text);
DROP FUNCTION IF EXISTS build_routing_nodes(text, text, double precision);
DROP FUNCTION IF EXISTS build_routing_nodes_with_trail_ids(text, text, double precision);

-- 2. Route calculation functions (appear to be unused)
DROP FUNCTION IF EXISTS calculate_route_connectivity_score(integer, real);
DROP FUNCTION IF EXISTS calculate_route_cost(double precision, double precision);
DROP FUNCTION IF EXISTS calculate_route_difficulty(real);
DROP FUNCTION IF EXISTS calculate_route_elevation_stats(jsonb);
DROP FUNCTION IF EXISTS calculate_route_estimated_time(real, real);
DROP FUNCTION IF EXISTS calculate_route_gain_rate(real, real);
DROP FUNCTION IF EXISTS calculate_route_parametric_metrics(real, real, integer, jsonb);
DROP FUNCTION IF EXISTS calculate_route_similarity_score(double precision, double precision, double precision, double precision);

-- 3. Old copy functions (replaced by newer versions)
DROP FUNCTION IF EXISTS copy_and_split_trails_to_staging_native(text, text, text, real, real, real, real, integer, real);
DROP FUNCTION IF EXISTS copy_and_split_trails_to_staging_native_v16(text, text, text, real, real, real, real, integer, real);

-- 4. Old routing generation functions (replaced by newer versions)
DROP FUNCTION IF EXISTS generate_routing_edges_native(text, real);
DROP FUNCTION IF EXISTS generate_routing_nodes_native(text, double precision);
DROP FUNCTION IF EXISTS generate_routing_nodes_native(text, real);
DROP FUNCTION IF EXISTS generate_routing_nodes_native_v2(text, real);

-- 5. Old route finding functions (replaced by configurable versions)
DROP FUNCTION IF EXISTS find_out_and_back_spatial(text, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS find_routes_for_criteria(text, double precision, double precision, text, integer);
DROP FUNCTION IF EXISTS find_routes_for_criteria_configurable(text, double precision, double precision, text, integer);
DROP FUNCTION IF EXISTS find_routes_pgrouting(text, double precision, double precision, double precision, integer);
DROP FUNCTION IF EXISTS find_routes_realistic(text, double precision, double precision, double precision, integer);
DROP FUNCTION IF EXISTS find_routes_recursive(text, double precision, double precision, double precision, integer);
DROP FUNCTION IF EXISTS find_routes_simplified(text, double precision, double precision, double precision, integer);
DROP FUNCTION IF EXISTS find_routes_spatial(text, double precision, double precision, double precision, integer);
DROP FUNCTION IF EXISTS find_routes_with_cost_configurable(text, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS find_simple_loops_spatial(text, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS find_simple_routes_with_logging(text, double precision, double precision, double precision);

-- 6. Old route recommendation functions (replaced by configurable versions)
DROP FUNCTION IF EXISTS generate_route_recommendations_adaptive(text, text, integer, integer);
DROP FUNCTION IF EXISTS generate_route_recommendations_large_dataset(text);
DROP FUNCTION IF EXISTS generate_route_recommendations_large_dataset(text, text);
DROP FUNCTION IF EXISTS generate_simple_route_recommendations(text, double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS generate_simple_route_recommendations(text, text);

-- 7. Old route name generation functions (replaced by newer versions)
DROP FUNCTION IF EXISTS generate_route_name(text[], text, text);
DROP FUNCTION IF EXISTS generate_route_name(integer[], text);

-- 8. Utility functions that appear to be unused
DROP FUNCTION IF EXISTS get_intersection_stats(text);
DROP FUNCTION IF EXISTS get_trails_with_geojson(text, integer);

-- 9. Cleanup functions that may be replaced by orchestrator methods
DROP FUNCTION IF EXISTS cleanup_routing_graph(text);

-- Print summary of what was cleaned up
SELECT 'Comprehensive function cleanup completed' as status; 