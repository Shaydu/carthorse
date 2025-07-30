#!/bin/bash

# Optimize Minimal Test Database Script
# This script optimizes PostgreSQL settings for better index usage

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

echo -e "${GREEN}🚀 Optimizing minimal test database for better index usage...${NC}"
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

echo -e "${YELLOW}📊 Current PostgreSQL settings:${NC}"
psql -c "SELECT name, setting FROM pg_settings WHERE name IN ('enable_seqscan', 'random_page_cost', 'effective_cache_size', 'work_mem', 'maintenance_work_mem');"

echo ""
echo -e "${GREEN}🔧 Optimizing PostgreSQL settings for index usage...${NC}"

# Optimize settings for better index usage
psql -c "SET random_page_cost = 1.1;"  # Lower cost for SSD
psql -c "SET effective_cache_size = '256MB';"  # Smaller cache for test DB
psql -c "SET work_mem = '64MB';"  # Adequate work memory
psql -c "SET maintenance_work_mem = '128MB';"  # For index maintenance
psql -c "SET enable_seqscan = off;"  # Force index usage when possible

echo ""
echo -e "${GREEN}📊 Updated PostgreSQL settings:${NC}"
psql -c "SELECT name, setting FROM pg_settings WHERE name IN ('enable_seqscan', 'random_page_cost', 'effective_cache_size', 'work_mem', 'maintenance_work_mem');"

echo ""
echo -e "${GREEN}🔧 Updating table statistics...${NC}"
psql -c "ANALYZE trails;"
psql -c "ANALYZE routing_nodes;"
psql -c "ANALYZE routing_edges;"

echo ""
echo -e "${GREEN}📊 Testing spatial index usage...${NC}"
echo "Testing spatial intersection query:"
psql -c "EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*) FROM trails WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.3, 39.98, -105.26, 40.01, 4326));"

echo ""
echo -e "${GREEN}📊 Testing region index usage...${NC}"
echo "Testing region query:"
psql -c "EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*) FROM trails WHERE region = 'boulder';"

echo ""
echo -e "${GREEN}📊 Testing materialized view performance...${NC}"
echo "Testing materialized view query:"
psql -c "EXPLAIN (ANALYZE, BUFFERS) SELECT geojson FROM trails_boulder_geojson LIMIT 10;"

echo ""
echo -e "${GREEN}📊 Index usage statistics:${NC}"
psql -c "
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('trails', 'routing_nodes', 'routing_edges')
ORDER BY idx_scan DESC;
"

echo ""
echo -e "${GREEN}✅ Database optimization complete!${NC}"
echo -e "${BLUE}📝 Optimizations applied:${NC}"
echo -e "${BLUE}   - Lowered random_page_cost for SSD optimization${NC}"
echo -e "${BLUE}   - Reduced effective_cache_size for test environment${NC}"
echo -e "${BLUE}   - Disabled sequential scans to force index usage${NC}"
echo -e "${BLUE}   - Updated table statistics for better query planning${NC}"
echo ""
echo -e "${YELLOW}💡 Expected improvements:${NC}"
echo -e "${YELLOW}   - Better index usage for spatial queries${NC}"
echo -e "${YELLOW}   - Faster query planning with updated statistics${NC}"
echo -e "${YELLOW}   - Optimized settings for small test datasets${NC}" 