#!/bin/bash

# Create Trimmed Test Database from Production
# This script creates a smaller, faster test database for development

set -e

# Configuration
SOURCE_DB="trail_master_db"
TARGET_DB="trail_master_db_test"
DB_USER="shaydu"
DB_HOST="localhost"
DB_PORT="5432"

# Sample sizes for each region
BOULDER_SAMPLE_SIZE=100  # ~4% of production data
SEATTLE_SAMPLE_SIZE=50   # ~8% of production data

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔧 Creating trimmed test database...${NC}"
echo -e "${BLUE}Source: $SOURCE_DB${NC}"
echo -e "${BLUE}Target: $TARGET_DB${NC}"
echo -e "${BLUE}Boulder sample: $BOULDER_SAMPLE_SIZE trails${NC}"
echo -e "${BLUE}Seattle sample: $SEATTLE_SAMPLE_SIZE trails${NC}"
echo ""

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
    
    # Copy trails with random sampling
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        INSERT INTO trails (
            app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            geometry, region, created_at, updated_at
        )
        SELECT 
            app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            geometry, region, created_at, updated_at
        FROM trails 
        WHERE region = '$region' 
        ORDER BY RANDOM() 
        LIMIT $sample_size;
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
            ROUND(AVG(length_km)::numeric, 2) as avg_length_km,
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

# Main execution
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

echo "Creating spatial index on trails.geom..."
psql "$TARGET_DB" -c "CREATE INDEX IF NOT EXISTS idx_trails_geom ON trails USING GIST (geom);"
echo "Index definition for idx_trails_geom:"
psql "$TARGET_DB" -c "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_trails_geom';"
echo "Full index properties for idx_trails_geom:"
psql "$TARGET_DB" -c "SELECT c.relname AS index_name, t.relname AS table_name, a.amname AS index_type, pg_size_pretty(pg_relation_size(c.oid)) AS index_size, i.indisunique AS is_unique, i.indisprimary AS is_primary, pg_get_indexdef(i.indexrelid) AS indexdef FROM pg_class c JOIN pg_index i ON c.oid = i.indexrelid JOIN pg_class t ON i.indrelid = t.oid JOIN pg_am a ON c.relam = a.oid WHERE c.relname = 'idx_trails_geom';"
echo "Table schema and indexes for trails:"
psql "$TARGET_DB" -c "\d trails"

echo "Creating spatial index on routing_nodes.geometry..."
psql "$TARGET_DB" -c "CREATE INDEX IF NOT EXISTS idx_routing_nodes_geometry ON routing_nodes USING GIST (geometry);"
echo "Index definition for idx_routing_nodes_geometry:"
psql "$TARGET_DB" -c "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_routing_nodes_geometry';"
echo "Full index properties for idx_routing_nodes_geometry:"
psql "$TARGET_DB" -c "SELECT c.relname AS index_name, t.relname AS table_name, a.amname AS index_type, pg_size_pretty(pg_relation_size(c.oid)) AS index_size, i.indisunique AS is_unique, i.indisprimary AS is_primary, pg_get_indexdef(i.indexrelid) AS indexdef FROM pg_class c JOIN pg_index i ON c.oid = i.indexrelid JOIN pg_class t ON i.indrelid = t.oid JOIN pg_am a ON c.relam = a.oid WHERE c.relname = 'idx_routing_nodes_geometry';"
echo "Table schema and indexes for routing_nodes:"
psql "$TARGET_DB" -c "\d routing_nodes"

echo "Creating spatial index on routing_edges.geometry..."
psql "$TARGET_DB" -c "CREATE INDEX IF NOT EXISTS idx_routing_edges_geometry ON routing_edges USING GIST (geometry);"
echo "Index definition for idx_routing_edges_geometry:"
psql "$TARGET_DB" -c "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_routing_edges_geometry';"
echo "Full index properties for idx_routing_edges_geometry:"
psql "$TARGET_DB" -c "SELECT c.relname AS index_name, t.relname AS table_name, a.amname AS index_type, pg_size_pretty(pg_relation_size(c.oid)) AS index_size, i.indisunique AS is_unique, i.indisprimary AS is_primary, pg_get_indexdef(i.indexrelid) AS indexdef FROM pg_class c JOIN pg_index i ON c.oid = i.indexrelid JOIN pg_class t ON i.indrelid = t.oid JOIN pg_am a ON c.relam = a.oid WHERE c.relname = 'idx_routing_edges_geometry';"
echo "Table schema and indexes for routing_edges:"
psql "$TARGET_DB" -c "\d routing_edges"

# Step 6: Analyze database
analyze_database

# Step 7: Show statistics
echo ""
show_stats

echo ""
echo -e "${GREEN}✅ Test database created successfully!${NC}"
echo -e "${BLUE}📝 To use this database for testing, set:${NC}"
echo -e "${BLUE}   export PGDATABASE=$TARGET_DB${NC}"
echo -e "${BLUE}   export PGUSER=$DB_USER${NC}"
echo ""
echo -e "${BLUE}🧪 You can now run tests with:${NC}"
echo -e "${BLUE}   PGDATABASE=$TARGET_DB npm test${NC}" 