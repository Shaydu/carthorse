-- Cleanup redundant schema elements
-- This script identifies and removes redundant indexes, functions, and structures

-- 1. IDENTIFY REDUNDANT GEOMETRY INDEXES ON PUBLIC.TRAILS
-- We have multiple identical geometry indexes:
-- - idx_trails_3d_geometry (partial: WHERE st_ndims(geometry) = 3)
-- - idx_trails_3d_geometry_complete (partial: WHERE st_ndims(geometry) = 3) - REDUNDANT
-- - idx_trails_geometry (full geometry index)
-- - idx_trails_geometry_gist (full geometry index) - REDUNDANT
-- - idx_trails_geom (full geometry index) - REDUNDANT
-- - idx_trails_geom_spatial (full geometry index) - REDUNDANT

-- 2. IDENTIFY REDUNDANT BBOX INDEXES
-- We have multiple bbox-related indexes that may be redundant:
-- - idx_trails_bbox (GIST on ST_MakeEnvelope)
-- - idx_trails_bbox_spatial (GIST on ST_Envelope)
-- - idx_trails_bbox_coords (BTREE on coordinates)
-- - idx_trails_bbox_validation (BTREE on coordinates with WHERE clause)

-- 3. IDENTIFY STAGING SCHEMAS (should be cleaned up)
-- Multiple staging schemas with identical structures:
-- - staging_boulder_1753750759428
-- - staging_boulder_1753750866110
-- - staging_boulder_1753750899097
-- - staging_boulder_1753751096706
-- - staging_boulder_1753751126664
-- - staging_boulder_1753751363911
-- - staging_boulder_1753751589033
-- - staging_boulder_1753752594710

-- 4. IDENTIFY UNUSED FUNCTIONS
-- Check which functions are actually being used

-- ============================================================================
-- CLEANUP RECOMMENDATIONS
-- ============================================================================

-- A. REMOVE REDUNDANT GEOMETRY INDEXES
-- Keep: idx_trails_3d_geometry (partial index for 3D geometry)
-- Keep: idx_trails_geometry (full geometry index)
-- Remove: idx_trails_3d_geometry_complete (redundant with idx_trails_3d_geometry)
-- Remove: idx_trails_geometry_gist (redundant with idx_trails_geometry)
-- Remove: idx_trails_geom (redundant with idx_trails_geometry)
-- Remove: idx_trails_geom_spatial (redundant with idx_trails_geometry)

-- B. REMOVE REDUNDANT BBOX INDEXES
-- Keep: idx_trails_bbox (GIST on ST_MakeEnvelope)
-- Keep: idx_trails_bbox_coords (BTREE on coordinates)
-- Remove: idx_trails_bbox_spatial (redundant with idx_trails_bbox)
-- Remove: idx_trails_bbox_validation (redundant with idx_trails_bbox_coords)

-- C. CLEAN UP STAGING SCHEMAS
-- These should be dropped as they're temporary test schemas

-- D. IDENTIFY UNUSED FUNCTIONS
-- Check which functions are actually called by the application

-- ============================================================================
-- EXECUTION SCRIPT
-- ============================================================================

-- Step 1: Drop redundant geometry indexes
DROP INDEX IF EXISTS idx_trails_3d_geometry_complete;
DROP INDEX IF EXISTS idx_trails_geometry_gist;
DROP INDEX IF EXISTS idx_trails_geom;
DROP INDEX IF EXISTS idx_trails_geom_spatial;

-- Step 2: Drop redundant bbox indexes
DROP INDEX IF EXISTS idx_trails_bbox_spatial;
DROP INDEX IF EXISTS idx_trails_bbox_validation;

-- Step 3: Clean up staging schemas (BE CAREFUL - only if they're truly unused)
-- Uncomment these lines only if you're sure the staging schemas are not needed
/*
DROP SCHEMA IF EXISTS staging_boulder_1753750759428 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753750866110 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753750899097 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753751096706 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753751126664 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753751363911 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753751589033 CASCADE;
DROP SCHEMA IF EXISTS staging_boulder_1753752594710 CASCADE;
*/

-- Step 4: Verify cleanup
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'trails' 
AND schemaname = 'public'
ORDER BY indexname;

-- Step 5: Check for any remaining redundant indexes
SELECT 
    indexname,
    COUNT(*) as duplicate_count
FROM pg_indexes 
WHERE tablename = 'trails' 
AND schemaname = 'public'
GROUP BY indexname
HAVING COUNT(*) > 1;

-- Step 6: List all functions to identify unused ones
SELECT 
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname; 