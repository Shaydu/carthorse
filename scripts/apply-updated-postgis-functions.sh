#!/bin/bash

# Apply Updated PostGIS Functions Script
# This script applies the updated functions without force2d to both databases

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

echo -e "${BLUE}🔧 Applying Updated PostGIS Functions${NC}"
echo "=========================================="
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo "Test DB: $TEST_DB"
echo "Production DB: $PROD_DB"
echo ""

# Function to apply functions to a database
apply_functions_to_db() {
    local db_name="$1"
    local description="$2"
    
    echo -e "${YELLOW}📝 Applying updated functions to $description ($db_name)...${NC}"
    
    # Apply the updated functions
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d "$db_name" -f docs/sql/fix_routing_functions.sql
    
    echo -e "${GREEN}✅ Functions applied to $description${NC}"
}

# Safety check for production
echo -e "${RED}⚠️  WARNING: This will update functions in both test and production databases${NC}"
echo "   This includes:"
echo "   - build_routing_nodes() (updated without force2d)"
echo "   - build_routing_edges() (updated without force2d)"
echo "   - All functions will preserve 3D elevation data"
echo ""

read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "❌ Operation cancelled"
    exit 1
fi

# Apply to test database first
apply_functions_to_db "$TEST_DB" "test database"

echo ""
echo -e "${RED}⚠️  PRODUCTION DATABASE WARNING${NC}"
echo "   About to update functions in production database: $PROD_DB"
echo "   This will affect all production operations"
echo ""

read -p "Continue with production database? (yes/no): " prod_confirm
if [ "$prod_confirm" != "yes" ]; then
    echo "❌ Production update cancelled"
    echo "✅ Test database updated successfully"
    exit 0
fi

# Apply to production database
apply_functions_to_db "$PROD_DB" "production database"

echo ""
echo -e "${GREEN}🎉 All functions updated successfully!${NC}"
echo ""
echo "Updated functions:"
echo "  - build_routing_nodes() - Now preserves 3D elevation data"
echo "  - build_routing_edges() - Now preserves 3D elevation data"
echo "  - All functions now use ST_Force3D() instead of ST_Force2D()"
echo ""
echo "The functions will be available immediately for all new operations." 