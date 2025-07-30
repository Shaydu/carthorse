#!/bin/bash

# Apply Elevation Fix Script
# This script fixes the missing elevation data issue by:
# 1. Applying the elevation calculation trigger
# 2. Updating all existing trails with missing elevation data
# 3. Validating the results

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_HOST=${PGHOST:-localhost}
DB_PORT=${PGPORT:-5432}
DB_USER=${PGUSER:-tester}
TEST_DB=${PGDATABASE:-trail_master_db_test}
PROD_DB="trail_master_db"

echo -e "${BLUE}🗻 Applying Elevation Data Fix${NC}"
echo "======================================"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo "Test DB: $TEST_DB"
echo "Production DB: $PROD_DB"
echo ""

# Function to check elevation data status
check_elevation_status() {
    local db_name="$1"
    local description="$2"
    
    echo -e "${YELLOW}📊 Checking elevation status in $description ($db_name)...${NC}"
    
    # Check trails with zero elevation data
    local zero_elevation=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$db_name" -t -c "
        SELECT COUNT(*) FROM trails 
        WHERE max_elevation = 0.0 OR min_elevation = 0.0 OR avg_elevation = 0.0
    " | tr -d ' ')
    
    # Check trails with 3D geometry
    local trails_3d=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$db_name" -t -c "
        SELECT COUNT(*) FROM trails 
        WHERE ST_NDims(geometry) = 3
    " | tr -d ' ')
    
    # Check trails with valid elevation data
    local valid_elevation=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$db_name" -t -c "
        SELECT COUNT(*) FROM trails 
        WHERE max_elevation > 0 AND min_elevation > 0 AND avg_elevation > 0
    " | tr -d ' ')
    
    echo "   - Trails with zero elevation: $zero_elevation"
    echo "   - Trails with 3D geometry: $trails_3d"
    echo "   - Trails with valid elevation: $valid_elevation"
    
    return $zero_elevation
}

# Function to apply elevation fix to a database
apply_elevation_fix_to_db() {
    local db_name="$1"
    local description="$2"
    
    echo -e "${YELLOW}🔧 Applying elevation fix to $description ($db_name)...${NC}"
    
    # Step 1: Apply the elevation calculation trigger
    echo "   📝 Applying elevation calculation trigger..."
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$db_name" -f docs/sql/fix-elevation-calculation-trigger.sql
    
    # Step 2: Update all existing trails with missing elevation data
    echo "   📊 Updating existing trails with missing elevation data..."
    local update_result=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$db_name" -t -c "
        SELECT * FROM update_all_missing_elevation_data();
    " | tr -d ' ')
    
    echo "   ✅ Updated elevation data for trails: $update_result"
    
    echo -e "${GREEN}✅ Elevation fix applied to $description${NC}"
}

# Safety check for production
echo -e "${RED}⚠️  WARNING: This will fix elevation data in both test and production databases${NC}"
echo "   This includes:"
echo "   - Adding automatic elevation calculation trigger"
echo "   - Updating all trails with missing elevation data"
echo "   - Calculating max_elevation, min_elevation, avg_elevation from 3D geometry"
echo ""

read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "❌ Operation cancelled"
    exit 1
fi

# Check initial status
echo -e "${BLUE}📊 Initial Elevation Status Check${NC}"
echo "======================================"

check_elevation_status "$TEST_DB" "test database"
test_zero_elevation=$?

check_elevation_status "$PROD_DB" "production database"
prod_zero_elevation=$?

echo ""

# Apply fix to test database first
if [ $test_zero_elevation -gt 0 ]; then
    apply_elevation_fix_to_db "$TEST_DB" "test database"
else
    echo -e "${GREEN}✅ Test database already has valid elevation data${NC}"
fi

echo ""
echo -e "${RED}⚠️  PRODUCTION DATABASE WARNING${NC}"
echo "   About to fix elevation data in production database: $PROD_DB"
echo "   This will affect all production operations"
echo ""

read -p "Continue with production database? (yes/no): " prod_confirm
if [ "$prod_confirm" != "yes" ]; then
    echo "❌ Production update cancelled"
    echo "✅ Test database updated successfully"
    exit 0
fi

# Apply fix to production database
if [ $prod_zero_elevation -gt 0 ]; then
    apply_elevation_fix_to_db "$PROD_DB" "production database"
else
    echo -e "${GREEN}✅ Production database already has valid elevation data${NC}"
fi

# Final validation
echo ""
echo -e "${BLUE}📊 Final Elevation Status Validation${NC}"
echo "=========================================="

check_elevation_status "$TEST_DB" "test database"
check_elevation_status "$PROD_DB" "production database"

echo ""
echo -e "${GREEN}🎉 Elevation data fix completed successfully!${NC}"
echo ""
echo "What was fixed:"
echo "  - Added automatic elevation calculation trigger"
echo "  - Updated all trails with missing elevation data"
echo "  - Calculated max_elevation, min_elevation, avg_elevation from 3D geometry"
echo "  - Preserved existing elevation_gain and elevation_loss data"
echo ""
echo "The elevation data will now be automatically calculated for new trails."
echo "All existing trails have been updated with proper elevation values." 