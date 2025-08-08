-- Cleanup Route Patterns to Single Source of Truth
-- This script ensures we only have route patterns defined in carthorse-configurable-sql.sql

-- First, let's see what patterns currently exist
SELECT 'Current patterns before cleanup:' as info;
SELECT * FROM get_route_patterns() ORDER BY target_distance_km, target_elevation_gain;

-- Clear all existing patterns to start fresh
DELETE FROM route_patterns;

-- The patterns will be re-inserted by carthorse-configurable-sql.sql
-- which contains the single source of truth for all route patterns

SELECT 'Patterns cleared. Run the orchestrator to re-insert from single source of truth.' as info; 