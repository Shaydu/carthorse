-- Carthorse Database Function Cleanup
-- This script removes unused and duplicate functions from the database
-- Run this after backing up the database

-- Test/Debug functions that are not used by the orchestrator
DROP FUNCTION IF EXISTS test_edge_generation(text);
DROP FUNCTION IF EXISTS test_function_v13();
DROP FUNCTION IF EXISTS test_params(text, text, text);
DROP FUNCTION IF EXISTS test_route_finding(text);
DROP FUNCTION IF EXISTS test_route_finding_configurable(text);
DROP FUNCTION IF EXISTS test_route_strategies(text, double precision, double precision);

-- Validation functions that may be unused (handle dependencies)
-- Note: validate_trail_completeness() has a trigger dependency, so we'll skip it for now
DROP FUNCTION IF EXISTS validate_intersection_detection(text);

-- Old routing functions that are replaced by newer versions
-- These don't exist, so we'll skip them

-- Route calculation functions that may be unused
-- These don't exist, so we'll skip them

-- Database integrity functions that may be unused
-- These don't exist, so we'll skip them

-- Cleanup functions that may be replaced by orchestrator methods
DROP FUNCTION IF EXISTS fast_cleanup_staging_schemas();
DROP FUNCTION IF EXISTS force_cleanup_staging_schemas();

-- Routing network functions that may be unused
-- prepare_routing_network() doesn't exist, so we'll skip it

-- Elevation and summary functions that may be unused
-- recalculate_elevation_data() doesn't exist, so we'll skip it
DROP FUNCTION IF EXISTS show_routing_summary();

-- Print summary of what was cleaned up
SELECT 'Function cleanup completed' as status; 