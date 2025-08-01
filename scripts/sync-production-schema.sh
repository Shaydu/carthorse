#!/bin/bash

# Sync Production Schema Script
# This script exports the production database schema and updates our schema files
# to ensure test database installation matches production exactly

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROD_DB=${PGDATABASE:-trail_master_db}
PROD_HOST=${PGHOST:-localhost}
PROD_PORT=${PGPORT:-5432}
PROD_USER=${PGUSER:-tester}
BACKUP_DIR="backups/schema-sync-$(date +%Y%m%d_%H%M%S)"

echo -e "${BLUE}🔄 Syncing Production Schema${NC}"
echo "=================================="
echo "Production DB: $PROD_DB"
echo "Host: $PROD_HOST:$PROD_PORT"
echo "User: $PROD_USER"
echo "Backup Dir: $BACKUP_DIR"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Function to run SQL query and display result
run_query_verbose() {
    local query="$1"
    local description="$2"
    echo -e "${YELLOW}🔍 $description${NC}"
    PGDATABASE=$PROD_DB psql -h $PROD_HOST -p $PROD_PORT -U $PROD_USER -c "$query"
    echo ""
}

# Step 1: Export complete production schema
echo -e "${BLUE}📦 Exporting production schema...${NC}"
PGPASSWORD='' pg_dump --schema-only --no-owner --no-privileges \
  -h $PROD_HOST -U $PROD_USER -d $PROD_DB > "$BACKUP_DIR/production-schema.sql"

echo -e "${GREEN}✅ Production schema exported to: $BACKUP_DIR/production-schema.sql${NC}"

# Step 2: Export only functions (for missing-functions.sql)
echo -e "${BLUE}🔧 Exporting production functions...${NC}"
# Extract functions from the complete schema export
grep -A 1000 "CREATE OR REPLACE FUNCTION\|CREATE FUNCTION" "$BACKUP_DIR/production-schema.sql" > "$BACKUP_DIR/production-functions.sql"

echo -e "${GREEN}✅ Production functions exported to: $BACKUP_DIR/production-functions.sql${NC}"

# Step 3: Analyze what's different between production and our schema files
echo -e "${BLUE}🔍 Analyzing schema differences...${NC}"

# Get list of functions in production
run_query_verbose "
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
ORDER BY routine_name;" "Production functions"

# Get list of tables in production
run_query_verbose "
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;" "Production tables"

# Step 4: Create updated schema files
echo -e "${BLUE}📝 Creating updated schema files...${NC}"

# Copy production schema as the new complete schema
cp "$BACKUP_DIR/production-schema.sql" "sql/schemas/carthorse-complete-schema.sql"
echo -e "${GREEN}✅ Updated sql/schemas/carthorse-complete-schema.sql${NC}"

# Extract functions for missing-functions.sql
echo -e "${BLUE}🔧 Creating missing-functions.sql...${NC}"
cat > "sql/schemas/missing-functions.sql" << 'EOF'
-- Missing Functions and Tables (Auto-generated from production)
-- This file contains functions and tables that were found in production
-- but not in the base schema file

-- Generated on: $(date)
-- Source: Production database schema export

EOF

# Extract functions from production schema
grep -A 1000 "CREATE OR REPLACE FUNCTION" "$BACKUP_DIR/production-schema.sql" >> "sql/schemas/missing-functions.sql"

echo -e "${GREEN}✅ Updated sql/schemas/missing-functions.sql${NC}"

# Step 5: Verify the updated schema works
echo -e "${BLUE}🧪 Testing updated schema...${NC}"
echo -e "${YELLOW}💡 To test the updated schema, run:${NC}"
echo "   PGDATABASE=trail_master_db_test npx ts-node test-install.js"

# Step 6: Create a summary report
echo -e "${BLUE}📊 Creating sync summary...${NC}"
cat > "$BACKUP_DIR/sync-summary.md" << EOF
# Schema Sync Summary

**Generated:** $(date)
**Production DB:** $PROD_DB
**Source:** $PROD_HOST:$PROD_PORT

## Files Updated
- \`sql/schemas/carthorse-complete-schema.sql\` - Complete production schema
- \`sql/schemas/missing-functions.sql\` - Production functions

## Backup Files
- \`$BACKUP_DIR/production-schema.sql\` - Raw production schema export
- \`$BACKUP_DIR/production-functions.sql\` - Production functions only

## Next Steps
1. Test the updated schema: \`PGDATABASE=trail_master_db_test npx ts-node test-install.js\`
2. Run tests: \`npm test\`
3. If issues found, check the backup files for comparison

EOF

echo -e "${GREEN}✅ Sync summary created: $BACKUP_DIR/sync-summary.md${NC}"

echo ""
echo -e "${GREEN}🎉 Production schema sync completed!${NC}"
echo -e "${BLUE}📁 Backup files: $BACKUP_DIR${NC}"
echo -e "${BLUE}📝 Updated files: sql/schemas/carthorse-complete-schema.sql, missing-functions.sql${NC}"
echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo "   1. Test the updated schema: PGDATABASE=trail_master_db_test npx ts-node test-install.js"
echo "   2. Run tests: npm test"
echo "   3. If issues found, check the backup files for comparison" 