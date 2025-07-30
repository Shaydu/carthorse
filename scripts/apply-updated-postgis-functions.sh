#!/bin/bash

# Apply Updated PostGIS Functions Script
# This script applies the updated PostGIS functions that fix the geometry_hash column issue

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME=${PGDATABASE:-trail_master_db}
DB_HOST=${PGHOST:-localhost}
DB_PORT=${PGPORT:-5432}
DB_USER=${PGUSER:-postgres}

echo -e "${BLUE}🔧 Applying Updated PostGIS Functions${NC}"
echo "=========================================="
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo ""

# Function to run SQL query and display result
run_query_verbose() {
    local query="$1"
    local description="$2"
    echo -e "${YELLOW}🔍 $description${NC}"
    PGDATABASE=$DB_NAME psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "$query"
    echo ""
}

# Step 1: Apply the updated PostGIS functions
echo -e "${BLUE}📥 Applying updated PostGIS functions...${NC}"
run_query_verbose "
-- Apply the updated copy_and_split_trails_to_staging_native function
$(cat migrations/V3__add_postgis_functions.sql)
" "Applying updated PostGIS functions"

# Step 2: Verify the function was updated
echo -e "${BLUE}✅ Verifying function update...${NC}"
run_query_verbose "
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines 
WHERE routine_name = 'copy_and_split_trails_to_staging_native'
  AND routine_schema = 'public';
" "Verifying function exists"

echo -e "${GREEN}✅ Updated PostGIS functions applied successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Summary:${NC}"
echo "- Updated copy_and_split_trails_to_staging_native function"
echo "- Fixed geometry_hash column handling"
echo "- Function now explicitly selects columns from production database"
echo "- Function generates geometry_hash for staging schema"
echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo "- Test the export process with: npm run export -- --region boulder"
echo "- The geometry_hash column issue should now be resolved" 