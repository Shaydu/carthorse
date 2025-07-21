#!/bin/bash

# Advanced Test Database Creator
# Creates different sized test databases for various testing scenarios

set -e

# Configuration
SOURCE_DB="trail_master_db"
TARGET_DB="trail_master_db_test"
DB_USER="shaydu"
DB_HOST="localhost"
DB_PORT="5432"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to show usage
show_usage() {
    echo -e "${GREEN}Usage: $0 [size] [target_db_name]${NC}"
    echo ""
    echo -e "${BLUE}Available sizes:${NC}"
    echo -e "  ${YELLOW}tiny${NC}     - 10 Boulder, 5 Seattle trails (fastest)"
    echo -e "  ${YELLOW}small${NC}    - 50 Boulder, 25 Seattle trails (fast)"
    echo -e "  ${YELLOW}medium${NC}   - 200 Boulder, 100 Seattle trails (balanced)"
    echo -e "  ${YELLOW}large${NC}    - 500 Boulder, 250 Seattle trails (comprehensive)"
    echo -e "  ${YELLOW}custom${NC}   - Specify custom sizes"
    echo ""
    echo -e "${BLUE}Examples:${NC}"
    echo -e "  $0 tiny"
    echo -e "  $0 medium trail_master_db_test_medium"
    echo -e "  $0 custom 100 50 trail_master_db_custom"
    echo ""
}

# Function to get sample sizes based on preset
get_sample_sizes() {
    local size=$1
    case $size in
        "tiny")
            echo "10 5"
            ;;
        "small")
            echo "50 25"
            ;;
        "medium")
            echo "200 100"
            ;;
        "large")
            echo "500 250"
            ;;
        *)
            echo "Invalid size: $size"
            show_usage
            exit 1
            ;;
    esac
}

# Function to check if database exists
database_exists() {
    local db_name=$1
    psql -h $DB_HOST -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_name'" 2>/dev/null | grep -q 1
}

# Function to drop database if it exists
drop_database() {
    local db_name=$1
    if database_exists "$db_name"; then
        echo -e "${YELLOW}🗑️  Dropping existing database: $db_name${NC}"
        psql -h $DB_HOST -U $DB_USER -d postgres -c "DROP DATABASE $db_name;"
    fi
}

# Function to create database
create_database() {
    local db_name=$1
    echo -e "${GREEN}📁 Creating database: $db_name${NC}"
    psql -h $DB_HOST -U $DB_USER -d postgres -c "CREATE DATABASE $db_name OWNER $DB_USER;"
}

# Function to copy schema
copy_schema() {
    echo -e "${BLUE}📋 Copying database schema...${NC}"
    pg_dump -h $DB_HOST -U $DB_USER -d $SOURCE_DB --schema-only | psql -h $DB_HOST -U $DB_USER -d $TARGET_DB
}

# Function to copy sample data
copy_sample_data() {
    local region=$1
    local sample_size=$2
    
    echo -e "${BLUE}📊 Copying $sample_size $region trails...${NC}"
    
    # Copy trails with random sampling using pg_dump and psql
    pg_dump -h $DB_HOST -U $DB_USER -d $SOURCE_DB \
        --data-only \
        --table=trails \
        --where="region = '$region'" \
        --no-owner --no-privileges | \
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB
    
    # Limit the data to the specified sample size
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        DELETE FROM trails 
        WHERE region = '$region' 
        AND id NOT IN (
            SELECT id FROM trails 
            WHERE region = '$region' 
            ORDER BY RANDOM() 
            LIMIT $sample_size
        );
    "
}

# Function to create indexes
create_indexes() {
    echo -e "${BLUE}🔍 Creating indexes...${NC}"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        CREATE INDEX IF NOT EXISTS idx_trails_region ON trails(region);
        CREATE INDEX IF NOT EXISTS idx_trails_bbox ON trails(bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
        CREATE INDEX IF NOT EXISTS idx_trails_geometry ON trails USING GIST(geometry);
        CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON trails(app_uuid);
    "
}

# Function to analyze database
analyze_database() {
    echo -e "${BLUE}📈 Analyzing database...${NC}"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "ANALYZE;"
}

# Function to show database stats
show_stats() {
    echo -e "${GREEN}📊 Test Database Statistics:${NC}"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        SELECT 
            region,
            COUNT(*) as trail_count,
            pg_size_pretty(pg_total_relation_size('trails')) as table_size,
            ROUND(AVG(length_km), 2) as avg_length_km,
            ROUND(AVG(elevation_gain), 1) as avg_elevation_gain
        FROM trails 
        GROUP BY region 
        ORDER BY trail_count DESC;
    "
    
    echo -e "${GREEN}📏 Total Database Size:${NC}"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        SELECT pg_size_pretty(pg_database_size('$TARGET_DB')) as database_size;
    "
}

# Function to create test configuration
create_test_config() {
    local config_file="test_db_config.env"
    echo -e "${BLUE}📝 Creating test configuration file: $config_file${NC}"
    
    cat > "$config_file" << EOF
# Test Database Configuration
# Generated on $(date)

# Database connection
PGHOST=$DB_HOST
PGPORT=$DB_PORT
PGUSER=$DB_USER
PGDATABASE=$TARGET_DB

# Test data info
BOULDER_TRAILS=$1
SEATTLE_TRAILS=$2
TOTAL_TRAILS=$(( $1 + $2 ))

# Usage instructions
# To use this test database:
#   source $config_file
#   npm test
EOF

    echo -e "${GREEN}✅ Configuration saved to $config_file${NC}"
}

# Main execution
if [ $# -eq 0 ]; then
    show_usage
    exit 1
fi

SIZE=$1
TARGET_DB=${2:-"trail_master_db_test"}

# Handle custom size
if [ "$SIZE" = "custom" ]; then
    if [ $# -lt 4 ]; then
        echo -e "${RED}❌ Custom size requires boulder_count seattle_count [db_name]${NC}"
        show_usage
        exit 1
    fi
    BOULDER_SAMPLE_SIZE=$3
    SEATTLE_SAMPLE_SIZE=$4
    TARGET_DB=${5:-"trail_master_db_test"}
else
    # Get sample sizes from preset
    read BOULDER_SAMPLE_SIZE SEATTLE_SAMPLE_SIZE <<< $(get_sample_sizes "$SIZE")
fi

echo -e "${GREEN}🔧 Creating $SIZE test database...${NC}"
echo -e "${BLUE}Source: $SOURCE_DB${NC}"
echo -e "${BLUE}Target: $TARGET_DB${NC}"
echo -e "${BLUE}Boulder sample: $BOULDER_SAMPLE_SIZE trails${NC}"
echo -e "${BLUE}Seattle sample: $SEATTLE_SAMPLE_SIZE trails${NC}"
echo ""

# Confirm action
echo -e "${YELLOW}⚠️  This will create a new test database with sample data from production${NC}"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Operation cancelled${NC}"
    exit 1
fi

# Step 1: Drop existing test database
drop_database "$TARGET_DB"

# Step 2: Create new test database
create_database "$TARGET_DB"

# Step 3: Copy schema
copy_schema

# Step 4: Copy sample data
copy_sample_data "boulder" "$BOULDER_SAMPLE_SIZE"
copy_sample_data "seattle" "$SEATTLE_SAMPLE_SIZE"

# Step 5: Create indexes
create_indexes

# Step 6: Analyze database
analyze_database

# Step 7: Show statistics
echo ""
show_stats

# Step 8: Create test configuration
create_test_config "$BOULDER_SAMPLE_SIZE" "$SEATTLE_SAMPLE_SIZE"

echo ""
echo -e "${GREEN}✅ Test database created successfully!${NC}"
echo -e "${BLUE}📝 To use this database for testing:${NC}"
echo -e "${BLUE}   export PGDATABASE=$TARGET_DB${NC}"
echo -e "${BLUE}   export PGUSER=$DB_USER${NC}"
echo ""
echo -e "${BLUE}🧪 Or load the configuration:${NC}"
echo -e "${BLUE}   source test_db_config.env${NC}"
echo -e "${BLUE}   npm test${NC}" 