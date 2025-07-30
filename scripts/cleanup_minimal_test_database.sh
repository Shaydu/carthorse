#!/bin/bash

# Cleanup Minimal Test Database Script
# This script removes unnecessary indexes and optimizes the 40-record test database

set -e

# Configuration
DB_NAME="trail_master_db_test_40"
DB_USER="tester"
DB_HOST="localhost"
DB_PORT="5432"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🧹 Cleaning up minimal test database...${NC}"
echo -e "${BLUE}Database: $DB_NAME${NC}"
echo ""

# Check if we're connected to the test database
if [ "$PGDATABASE" != "$DB_NAME" ]; then
    echo -e "${YELLOW}⚠️  Warning: Not connected to $DB_NAME!${NC}"
    echo -e "${YELLOW}   Current: $PGDATABASE${NC}"
    echo -e "${YELLOW}   Expected: $DB_NAME${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${YELLOW}📊 Current database state:${NC}"
psql -c "
SELECT 
    COUNT(*) as total_trails,
    COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_trails,
    COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_d_geometry
FROM trails;
"

echo ""
echo -e "${YELLOW}📊 Current indexes (before cleanup):${NC}"
psql -c "
SELECT 
    COUNT(*) as total_indexes,
    COUNT(CASE WHEN schemaname = 'public' THEN 1 END) as public_indexes,
    COUNT(CASE WHEN schemaname LIKE 'staging_%' THEN 1 END) as staging_indexes
FROM pg_indexes 
WHERE tablename = 'trails';
"

echo ""
echo -e "${GREEN}🗑️  Removing staging schema indexes...${NC}"

# Drop all staging schema indexes
psql -c "
SELECT 'DROP INDEX IF EXISTS ' || schemaname || '.' || indexname || ';' as drop_statement
FROM pg_indexes 
WHERE schemaname LIKE 'staging_%' 
AND tablename = 'trails'
ORDER BY indexname;
" | grep 'DROP INDEX' | psql -f -

echo ""
echo -e "${GREEN}🗑️  Removing redundant indexes...${NC}"

# Drop redundant indexes
psql -c "DROP INDEX IF EXISTS idx_trails_geometry_gist;"  # Redundant with idx_trails_geometry
psql -c "DROP INDEX IF EXISTS idx_trails_region_elevation_composite;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_region_length_composite;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_region_surface_composite;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_complete_elevation;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_completeness_check;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_elevation_geometry;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_region_geometry;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_region_bbox;"  # Too complex for 40 records
psql -c "DROP INDEX IF EXISTS idx_trails_region_elevation;"  # Too complex for 40 records

echo ""
echo -e "${GREEN}🔄 Refreshing materialized view...${NC}"
psql -c "REFRESH MATERIALIZED VIEW trails_boulder_geojson;"

echo ""
echo -e "${GREEN}📊 Final index state (after cleanup):${NC}"
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
echo -e "${GREEN}📊 Performance test (after cleanup):${NC}"
echo "Testing GeoJSON query performance..."
psql -c "EXPLAIN (ANALYZE, BUFFERS) SELECT ST_AsGeoJSON(geometry, 6, 0) as geojson FROM trails WHERE region = 'boulder' LIMIT 10;"

echo ""
echo -e "${GREEN}📊 Materialized view test:${NC}"
psql -c "SELECT COUNT(*) as mv_count FROM trails_boulder_geojson;"

echo ""
echo -e "${GREEN}📊 Final database statistics:${NC}"
psql -c "
SELECT 
    'trails' as table_name,
    COUNT(*) as record_count,
    COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_count
FROM trails
UNION ALL
SELECT 
    'trails_boulder_geojson' as table_name,
    COUNT(*) as record_count,
    NULL as boulder_count
FROM trails_boulder_geojson;
"

echo ""
echo -e "${GREEN}✅ Minimal test database cleanup complete!${NC}"
echo -e "${BLUE}📝 Optimizations applied:${NC}"
echo -e "${BLUE}   - Removed staging schema indexes${NC}"
echo -e "${BLUE}   - Removed redundant composite indexes${NC}"
echo -e "${BLUE}   - Refreshed materialized view${NC}"
echo -e "${BLUE}   - Kept only essential indexes for 40 records${NC}"
echo ""
echo -e "${YELLOW}💡 Expected improvements:${NC}"
echo -e "${YELLOW}   - Faster query planning (fewer indexes to consider)${NC}"
echo -e "${YELLOW}   - Reduced index maintenance overhead${NC}"
echo -e "${YELLOW}   - Cleaner database structure${NC}" 