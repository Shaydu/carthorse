#!/bin/bash

# Rename Test Databases Script
# This script renames the current test database to trail_master_db_test_300
# and prepares for the new minimal database trail_master_db_test_40

set -e

# Configuration
CURRENT_DB="trail_master_db_test"
RENAMED_DB="trail_master_db_test_300"
NEW_MINIMAL_DB="trail_master_db_test_40"
DB_USER="tester"
DB_HOST="localhost"
DB_PORT="5432"

# Superuser for database operations
SUPERUSER="${SUPERUSER:-tester}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔄 Renaming Test Databases${NC}"
echo "================================"
echo -e "${BLUE}Current: $CURRENT_DB${NC}"
echo -e "${BLUE}Renamed: $RENAMED_DB${NC}"
echo -e "${BLUE}New Minimal: $NEW_MINIMAL_DB${NC}"
echo ""

# Function to check if database exists
database_exists() {
    local db_name=$1
    psql -h $DB_HOST -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_name'" 2>/dev/null | grep -q 1
}

# Function to get database size
get_database_size() {
    local db_name=$1
    psql -h $DB_HOST -U $DB_USER -d postgres -tAc "
        SELECT pg_size_pretty(pg_database_size('$db_name'))
    " 2>/dev/null || echo "Unknown"
}

# Function to get trail count
get_trail_count() {
    local db_name=$1
    psql -h $DB_HOST -U $DB_USER -d $db_name -tAc "SELECT COUNT(*) FROM trails;" 2>/dev/null || echo "0"
}

# Check current state
echo -e "${YELLOW}📊 Current Database State:${NC}"
if database_exists "$CURRENT_DB"; then
    echo "   ✅ $CURRENT_DB exists"
    echo "   📏 Size: $(get_database_size $CURRENT_DB)"
    echo "   🏃 Trails: $(get_trail_count $CURRENT_DB)"
else
    echo "   ❌ $CURRENT_DB does not exist"
fi

if database_exists "$RENAMED_DB"; then
    echo "   ✅ $RENAMED_DB exists"
    echo "   📏 Size: $(get_database_size $RENAMED_DB)"
    echo "   🏃 Trails: $(get_trail_count $RENAMED_DB)"
else
    echo "   ❌ $RENAMED_DB does not exist"
fi

if database_exists "$NEW_MINIMAL_DB"; then
    echo "   ✅ $NEW_MINIMAL_DB exists"
    echo "   📏 Size: $(get_database_size $NEW_MINIMAL_DB)"
    echo "   🏃 Trails: $(get_trail_count $NEW_MINIMAL_DB)"
else
    echo "   ❌ $NEW_MINIMAL_DB does not exist"
fi

echo ""

# Ask for confirmation
echo -e "${YELLOW}⚠️  This will:${NC}"
echo "  • Rename $CURRENT_DB to $RENAMED_DB"
echo "  • Prepare for new minimal database $NEW_MINIMAL_DB"
echo "  • Update environment variables"
echo ""
read -p "Continue with renaming? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Renaming cancelled${NC}"
    exit 1
fi

echo ""

# Step 1: Rename current test database
if database_exists "$CURRENT_DB"; then
    echo -e "${GREEN}🔄 Renaming $CURRENT_DB to $RENAMED_DB...${NC}"
    
    # Disconnect all connections to the database
    echo "   Disconnecting all connections..."
    psql -h $DB_HOST -U $SUPERUSER -d postgres -c "
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = '$CURRENT_DB' 
        AND pid <> pg_backend_pid();
    " 2>/dev/null || echo "    No active connections to terminate"
    
    # Rename the database
    psql -h $DB_HOST -U $SUPERUSER -d postgres -c "ALTER DATABASE $CURRENT_DB RENAME TO $RENAMED_DB;" || {
        echo -e "${RED}❌ Failed to rename database. You may need superuser privileges.${NC}"
        exit 1
    }
    
    echo -e "${GREEN}✅ Successfully renamed $CURRENT_DB to $RENAMED_DB${NC}"
else
    echo -e "${YELLOW}⚠️  $CURRENT_DB does not exist, skipping rename${NC}"
fi

# Step 2: Drop new minimal database if it exists
if database_exists "$NEW_MINIMAL_DB"; then
    echo -e "${YELLOW}🗑️  Dropping existing $NEW_MINIMAL_DB...${NC}"
    psql -h $DB_HOST -U $SUPERUSER -d postgres -c "DROP DATABASE $NEW_MINIMAL_DB;" || {
        echo -e "${RED}❌ Failed to drop $NEW_MINIMAL_DB. You may need superuser privileges.${NC}"
        exit 1
    }
    echo -e "${GREEN}✅ Dropped $NEW_MINIMAL_DB${NC}"
fi

echo ""

# Step 3: Show final state
echo -e "${GREEN}📊 Final Database State:${NC}"
if database_exists "$RENAMED_DB"; then
    echo "   ✅ $RENAMED_DB exists"
    echo "   📏 Size: $(get_database_size $RENAMED_DB)"
    echo "   🏃 Trails: $(get_trail_count $RENAMED_DB)"
else
    echo "   ❌ $RENAMED_DB does not exist"
fi

if database_exists "$NEW_MINIMAL_DB"; then
    echo "   ✅ $NEW_MINIMAL_DB exists"
    echo "   📏 Size: $(get_database_size $NEW_MINIMAL_DB)"
    echo "   🏃 Trails: $(get_trail_count $NEW_MINIMAL_DB)"
else
    echo "   ❌ $NEW_MINIMAL_DB does not exist (ready for creation)"
fi

echo ""
echo -e "${GREEN}✅ Database renaming complete!${NC}"
echo ""
echo -e "${BLUE}📝 Next steps:${NC}"
echo -e "${BLUE}   1. Run: ./scripts/create_minimal_test_database.sh${NC}"
echo -e "${BLUE}   2. Set environment: export PGDATABASE=$NEW_MINIMAL_DB${NC}"
echo -e "${BLUE}   3. Run tests: PGDATABASE=$NEW_MINIMAL_DB npm test${NC}"
echo ""
echo -e "${YELLOW}💡 To switch between databases:${NC}"
echo -e "${YELLOW}   • For 300-trail tests: export PGDATABASE=$RENAMED_DB${NC}"
echo -e "${YELLOW}   • For 40-trail tests: export PGDATABASE=$NEW_MINIMAL_DB${NC}" 