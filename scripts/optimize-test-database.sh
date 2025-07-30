#!/bin/bash

# Optimize Test Database Script
# This script adds indexes and optimizations for faster test execution

set -e

echo "🚀 Optimizing test database for faster performance..."

# Check if we're connected to the test database
if [ "$PGDATABASE" != "trail_master_db_test" ]; then
    echo "⚠️  WARNING: Not connected to test database!"
    echo "   Current database: $PGDATABASE"
    echo "   Expected: trail_master_db_test"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📊 Current index state:"
psql -c "
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename = 'trails'
ORDER BY indexname;
"

echo ""
echo "🔧 Adding performance indexes..."

# Add composite indexes for common test queries
echo "   Adding composite indexes for region + elevation queries..."
psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_region_elevation_composite 
ON trails (region, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation);
"

psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_region_geometry_composite 
ON trails (region, ST_NDims(geometry), ST_NPoints(geometry));
"

# Add indexes for validation queries
echo "   Adding indexes for validation queries..."
psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_validation_null_elevation 
ON trails (elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation) 
WHERE elevation_gain IS NULL OR elevation_loss IS NULL OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL;
"

psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_validation_zero_elevation 
ON trails (elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation) 
WHERE elevation_gain = 0 AND elevation_loss = 0 AND max_elevation = 0 AND min_elevation = 0 AND avg_elevation = 0;
"

# Add indexes for geometry queries
echo "   Adding indexes for geometry queries..."
psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_geometry_3d 
ON trails USING GIST (geometry) 
WHERE ST_NDims(geometry) = 3;
"

psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_geometry_2d 
ON trails USING GIST (geometry) 
WHERE ST_NDims(geometry) = 2;
"

# Add indexes for name and UUID lookups
echo "   Adding indexes for name and UUID lookups..."
psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_name_lower 
ON trails (LOWER(name));
"

psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_app_uuid_region 
ON trails (app_uuid, region);
"

# Add indexes for test data queries
echo "   Adding indexes for test data queries..."
psql -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trails_test_data 
ON trails (name) 
WHERE name LIKE 'Test Trail%';
"

echo ""
echo "🔧 Optimizing table statistics..."
psql -c "ANALYZE trails;"
psql -c "ANALYZE regions;"

echo ""
echo "🔧 Setting query optimization parameters..."
psql -c "SET random_page_cost = 1.1;"
psql -c "SET effective_cache_size = '256MB';"
psql -c "SET work_mem = '64MB';"
psql -c "SET maintenance_work_mem = '128MB';"

echo ""
echo "📊 Final index state:"
psql -c "
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename = 'trails'
ORDER BY indexname;
"

echo ""
echo "📊 Performance test queries..."
echo "   Testing region + elevation query performance:"
psql -c "
EXPLAIN (ANALYZE, BUFFERS) 
SELECT COUNT(*) 
FROM trails 
WHERE region = 'boulder' 
AND elevation_gain IS NOT NULL 
AND elevation_loss IS NOT NULL;
"

echo ""
echo "   Testing geometry query performance:"
psql -c "
EXPLAIN (ANALYZE, BUFFERS) 
SELECT COUNT(*) 
FROM trails 
WHERE ST_NDims(geometry) = 3 
AND elevation_gain IS NULL;
"

echo ""
echo "✅ Test database optimization complete!"
echo "   - Added composite indexes for common queries"
echo "   - Added validation-specific indexes"
echo "   - Optimized geometry indexes"
echo "   - Updated table statistics"
echo "   - Set performance parameters"
echo ""
echo "🚀 Test database is now optimized for faster execution!" 