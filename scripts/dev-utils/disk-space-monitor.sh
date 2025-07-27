#!/bin/bash

# Disk Space Monitor for Carthorse
# This script helps monitor disk space usage and identify large files/directories

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT=$(dirname "$(dirname "$(dirname "$0")")")
DB_NAME=${PGDATABASE:-trail_master_db_test}
PGUSER=${PGUSER:-tester}
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}

echo -e "${BLUE}🔍 Carthorse Disk Space Monitor${NC}"
echo "=================================="

# Check overall disk usage
echo -e "\n${BLUE}📊 Overall Disk Usage:${NC}"
df -h . | grep -E "(Filesystem|/dev/)"

# Check project directory sizes
echo -e "\n${BLUE}📁 Project Directory Sizes:${NC}"
cd "$PROJECT_ROOT"

# Check common directories
for dir in data tmp logs downloads; do
    if [ -d "$dir" ]; then
        size=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "  $dir/: $size"
    fi
done

# Check for large files
echo -e "\n${BLUE}📄 Large Files (>100MB):${NC}"
find . -type f -size +100M -exec ls -lh {} \; 2>/dev/null | head -10 || echo "  No files larger than 100MB found"

# Check PostgreSQL database size
echo -e "\n${BLUE}🗄️ PostgreSQL Database Sizes:${NC}"
if command -v psql &> /dev/null; then
    # Get database sizes
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d postgres -tAc "
        SELECT 
            datname as database,
            pg_size_pretty(pg_database_size(datname)) as size
        FROM pg_database 
        WHERE datname LIKE '%trail%' OR datname LIKE '%test%'
        ORDER BY pg_database_size(datname) DESC;
    " 2>/dev/null || echo "  Could not connect to PostgreSQL"
else
    echo "  psql not found"
fi

# Check staging schemas
echo -e "\n${BLUE}🏗️ Staging Schemas:${NC}"
if command -v psql &> /dev/null; then
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT 
            nspname as schema,
            COUNT(*) as tables,
            pg_size_pretty(COALESCE(SUM(pg_total_relation_size(c.oid)), 0)) as size
        FROM pg_namespace n
        LEFT JOIN pg_class c ON c.relnamespace = n.oid
        WHERE nspname LIKE 'staging_%'
        GROUP BY nspname
        ORDER BY COALESCE(SUM(pg_total_relation_size(c.oid)), 0) DESC;
    " 2>/dev/null || echo "  Could not connect to PostgreSQL"
else
    echo "  psql not found"
fi

# Check for old staging schemas
echo -e "\n${BLUE}🗑️ Old Staging Schemas (potential cleanup targets):${NC}"
if command -v psql &> /dev/null; then
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT 
            nspname as schema,
            COUNT(*) as tables
        FROM pg_namespace n
        LEFT JOIN pg_class c ON c.relnamespace = n.oid
        WHERE nspname LIKE 'staging_%'
        GROUP BY nspname
        HAVING COUNT(*) > 0
        ORDER BY nspname;
    " 2>/dev/null || echo "  Could not connect to PostgreSQL"
else
    echo "  psql not found"
fi

# Check temp files
echo -e "\n${BLUE}🗂️ Temporary Files:${NC}"
find /tmp -name "*carthorse*" -o -name "*trail*" -o -name "*test*" 2>/dev/null | head -10 || echo "  No temporary files found"

# Recommendations
echo -e "\n${BLUE}💡 Recommendations:${NC}"
echo "  • Run: carthorse --cleanup-disk-space"
echo "  • Run: carthorse --clean-test-data"
echo "  • Run: carthorse --region boulder --out test.db --max-staging-schemas 1"
echo "  • Check: scripts/dev-utils/drop_all_staging_schemas.sh"

# Check if cleanup is needed
echo -e "\n${BLUE}⚠️ Cleanup Needed?${NC}"
if command -v psql &> /dev/null; then
    staging_count=$(psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_namespace WHERE nspname LIKE 'staging_%';
    " 2>/dev/null || echo "0")
    
    if [ "$staging_count" -gt 5 ]; then
        echo -e "  ${YELLOW}Yes! Found $staging_count staging schemas${NC}"
        echo -e "  ${YELLOW}Recommend running: carthorse --cleanup-disk-space${NC}"
    else
        echo -e "  ${GREEN}No, only $staging_count staging schemas found${NC}"
    fi
else
    echo "  Could not check (psql not available)"
fi

echo -e "\n${GREEN}✅ Disk space monitoring complete${NC}" 