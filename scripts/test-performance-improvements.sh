#!/bin/bash
# Test performance improvements and measure speed gains
# This script measures query performance before and after optimizations

set -e

echo "🧪 Testing Performance Improvements"
echo "=================================="

# Test database connection
echo "📊 Checking test database..."
TRAIL_COUNT=$(psql -d trail_master_db_test -t -c "SELECT COUNT(*) FROM trails;" | xargs)
echo "   Test database has $TRAIL_COUNT trails"

# Test 1: Simple COUNT query
echo ""
echo "🔍 Test 1: Simple COUNT query"
echo "-----------------------------"
psql -d trail_master_db_test -c "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT COUNT(*) FROM trails WHERE region = 'boulder';"

# Test 2: GeoJSON conversion (the bottleneck)
echo ""
echo "🔍 Test 2: GeoJSON conversion (bottleneck)"
echo "------------------------------------------"
psql -d trail_master_db_test -c "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT ST_AsGeoJSON(geometry, 6, 0) as geojson FROM trails WHERE region = 'boulder' LIMIT 10;"

# Test 3: Complex query with joins
echo ""
echo "🔍 Test 3: Complex query with spatial operations"
echo "------------------------------------------------"
psql -d trail_master_db_test -c "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT t.name, t.length_km, ST_AsGeoJSON(t.geometry, 6, 0) as geojson FROM trails t WHERE t.region = 'boulder' AND t.length_km > 1.0 ORDER BY t.length_km DESC LIMIT 5;"

# Test 4: Index usage check
echo ""
echo "🔍 Test 4: Index usage analysis"
echo "-------------------------------"
psql -d trail_master_db_test -c "SELECT schemaname, relname as tablename, indexrelname as indexname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes WHERE relname = 'trails' ORDER BY idx_scan DESC;"

# Test 5: Database size and statistics
echo ""
echo "🔍 Test 5: Database statistics"
echo "------------------------------"
psql -d trail_master_db_test -c "SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE tablename = 'trails' 
ORDER BY attname;"

# Test 6: Performance comparison with production
echo ""
echo "🔍 Test 6: Performance comparison with production"
echo "------------------------------------------------"
echo "Test DB query time:"
time psql -d trail_master_db_test -c "SELECT COUNT(*) FROM trails WHERE region = 'boulder';" > /dev/null

echo ""
echo "Production DB query time:"
time psql -d trail_master_db -c "SELECT COUNT(*) FROM trails WHERE region = 'boulder';" > /dev/null

# Test 7: Check if optimizations are applied
echo ""
echo "🔍 Test 7: Optimization verification"
echo "-----------------------------------"
echo "Checking if our optimizations are applied..."

# Check if our composite indexes exist
COMPOSITE_INDEXES=$(psql -d trail_master_db_test -t -c "
SELECT indexname FROM pg_indexes 
WHERE tablename = 'trails' 
AND indexname LIKE '%composite%' 
OR indexname LIKE '%region_elevation%';" | wc -l)

if [ "$COMPOSITE_INDEXES" -gt 0 ]; then
    echo "✅ Composite indexes found: $COMPOSITE_INDEXES"
else
    echo "❌ No composite indexes found"
fi

# Check PostgreSQL settings
echo ""
echo "PostgreSQL performance settings:"
psql -d trail_master_db_test -c "SHOW random_page_cost;"
psql -d trail_master_db_test -c "SHOW effective_cache_size;"
psql -d trail_master_db_test -c "SHOW work_mem;"
psql -d trail_master_db_test -c "SHOW maintenance_work_mem;"

echo ""
echo "📈 Performance Test Summary"
echo "=========================="
echo "✅ Performance tests completed"
echo "📊 Check the query plans above for optimization opportunities"
echo "🎯 Target: 20% speed improvement"
echo ""
echo "💡 Recommendations:"
echo "1. If ST_AsGeoJSON is still slow, consider pre-computing GeoJSON"
echo "2. If indexes aren't being used, check query patterns"
echo "3. If production is faster, apply same optimizations to production" 