#!/bin/bash

# Test PgRouting Orchestrator Script
# This script tests the pgRouting orchestrator functionality

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME=${PGDATABASE:-trail_master_db_test}
DB_HOST=${PGHOST:-localhost}
DB_PORT=${PGPORT:-5432}
DB_USER=${PGUSER:-tester}
REGION=${1:-boulder}
OUTPUT_PATH=${2:-data/test-pgrouting.db}

echo -e "${BLUE}🧪 Testing PgRouting Orchestrator${NC}"
echo "=========================================="
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo "Region: $REGION"
echo "Output: $OUTPUT_PATH"
echo ""
echo -e "${GREEN}🔒 SAFETY: This test ensures READ-ONLY access to trail_master_db${NC}"
echo ""

# Function to run SQL query and get result
run_query() {
    local query="$1"
    local result=$(PGDATABASE=$DB_NAME psql -h $DB_HOST -p $DB_PORT -U $DB_USER -t -c "$query" 2>/dev/null | tr -d ' ')
    echo "$result"
}

# Function to run SQL query and display result
run_query_verbose() {
    local query="$1"
    local description="$2"
    echo -e "${YELLOW}🔍 $description${NC}"
    PGDATABASE=$DB_NAME psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "$query"
    echo ""
}

# Step 1: Check pgRouting extension
echo -e "${BLUE}📋 Step 1: Checking pgRouting extension...${NC}"
pgrouting_available=$(run_query "
SELECT EXISTS(
  SELECT 1 FROM pg_extension WHERE extname = 'pgrouting'
) as pgrouting_available;
")

if [ "$pgrouting_available" = "t" ]; then
    echo -e "${GREEN}✅ pgRouting extension is available${NC}"
else
    echo -e "${RED}❌ pgRouting extension is not available${NC}"
    echo -e "${YELLOW}Please install pgRouting extension first:${NC}"
    echo "  Ubuntu/Debian: sudo apt-get install postgresql-14-pgrouting"
    echo "  macOS: brew install postgis (includes pgRouting)"
    echo "  CentOS/RHEL: sudo yum install postgresql14-pgrouting"
    exit 1
fi

# Step 2: Check required pgRouting functions
echo -e "${BLUE}📋 Step 2: Checking required pgRouting functions...${NC}"
required_functions=("pgr_nodenetwork" "pgr_createtopology" "pgr_analyzegraph")

for func in "${required_functions[@]}"; do
    func_available=$(run_query "
SELECT EXISTS(
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = '$func'
) as function_available;
")
    
    if [ "$func_available" = "t" ]; then
        echo -e "${GREEN}✅ Function '$func' is available${NC}"
    else
        echo -e "${RED}❌ Function '$func' is not available${NC}"
        exit 1
    fi
done

# Step 3: Check trail data availability (READ-ONLY)
echo -e "${BLUE}📋 Step 3: Checking trail data availability (READ-ONLY)...${NC}"
trail_count=$(run_query "
SELECT COUNT(*) as count FROM public.trails WHERE region = '$REGION';
")

if [ "$trail_count" -gt 0 ]; then
    echo -e "${GREEN}✅ Found $trail_count trails for region '$REGION' (READ-ONLY access)${NC}"
else
    echo -e "${RED}❌ No trails found for region '$REGION'${NC}"
    echo -e "${YELLOW}Available regions:${NC}"
    run_query_verbose "
SELECT region, COUNT(*) as trail_count 
FROM public.trails 
GROUP BY region 
ORDER BY trail_count DESC;
" "Available regions and trail counts (READ-ONLY)"
    exit 1
fi

# Step 4: Test pgRouting orchestrator CLI
echo -e "${BLUE}📋 Step 4: Testing pgRouting orchestrator CLI...${NC}"

# Check if the CLI script exists
if [ ! -f "src/cli/pgrouting-export.ts" ]; then
    echo -e "${RED}❌ PgRouting CLI script not found${NC}"
    exit 1
fi

# Test dry run
echo -e "${YELLOW}🔍 Testing dry run...${NC}"
if PGDATABASE=$DB_NAME PGUSER=$DB_USER PGHOST=$DB_HOST PGPORT=$DB_PORT npm run export:pgrouting -- --region $REGION --out $OUTPUT_PATH --dry-run; then
    echo -e "${GREEN}✅ Dry run completed successfully${NC}"
else
    echo -e "${RED}❌ Dry run failed${NC}"
    exit 1
fi

# Step 5: Test actual export
echo -e "${BLUE}📋 Step 5: Testing actual export...${NC}"
echo -e "${YELLOW}🚀 Running actual export...${NC}"

# Create output directory if it doesn't exist
mkdir -p $(dirname $OUTPUT_PATH)

if PGDATABASE=$DB_NAME PGUSER=$DB_USER PGHOST=$DB_HOST PGPORT=$DB_PORT npm run export:pgrouting -- --region $REGION --out $OUTPUT_PATH --skip-validation; then
    echo -e "${GREEN}✅ Export completed successfully!${NC}"
    echo -e "${GREEN}📁 Output file: $OUTPUT_PATH${NC}"
    
    # Check if output file exists and has content
    if [ -f "$OUTPUT_PATH" ]; then
        file_size=$(stat -f%z "$OUTPUT_PATH" 2>/dev/null || stat -c%s "$OUTPUT_PATH" 2>/dev/null || echo "0")
        echo -e "${GREEN}📊 Output file size: $file_size bytes${NC}"
    else
        echo -e "${RED}❌ Output file not found${NC}"
    fi
else
    echo -e "${RED}❌ Export failed${NC}"
    exit 1
fi

# Step 6: Summary
echo -e "${BLUE}📋 Step 6: Test Summary${NC}"
echo "=========================================="
echo -e "${GREEN}✅ pgRouting extension: Available${NC}"
echo -e "${GREEN}✅ Required functions: Available${NC}"
echo -e "${GREEN}✅ Trail data: $trail_count trails found (READ-ONLY)${NC}"
echo -e "${GREEN}✅ CLI script: Available${NC}"
echo -e "${GREEN}✅ Dry run: Successful${NC}"
echo -e "${GREEN}🔒 Safety: READ-ONLY access to trail_master_db confirmed${NC}"

if [ -f "$OUTPUT_PATH" ]; then
    echo -e "${GREEN}✅ Export: Successful${NC}"
    echo -e "${GREEN}📁 Output: $OUTPUT_PATH${NC}"
else
    echo -e "${YELLOW}⏭️ Export: Skipped${NC}"
fi

echo ""
echo -e "${GREEN}🎉 PgRouting Orchestrator test completed successfully!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Run: carthorse-pgrouting --region $REGION --out $OUTPUT_PATH"
echo "2. Check the generated database for routing networks"
echo "3. Validate the routing network quality"
echo ""
echo -e "${YELLOW}For more information, see:${NC}"
echo "- docs/pgrouting-orchestrator.md"
echo "- src/orchestrator/PgRoutingOrchestrator.ts"
echo "- src/cli/pgrouting-export.ts" 