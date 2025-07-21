#!/bin/bash

# Create Trimmed Test Database from Production
# This script creates a smaller, faster test database for development

set -e

# Configuration
SOURCE_DB="${SOURCE_DB:-trail_master_db}"
TARGET_DB="${TARGET_DB:-trail_master_db_test}"
DB_USER="tester"  # Use 'tester' ONLY for test environments; must not exist in production
DB_HOST="localhost"
DB_PORT="5432"

# Superuser for dropping/creating the test database (must have sufficient privileges)
SUPERUSER="${SUPERUSER:-tester}"

# Production read-only user for schema export (must exist in production with schema-only privileges)
# NOTE: Must be the table owner for pg_dump to include all tables
PROD_USER="${PROD_USER:-shaydu}"
PROD_PASSWORD="${PROD_PASSWORD:-your_shaydu_password}"
PROD_HOST="${PROD_HOST:-localhost}"

# Required environment variables for production schema export
REQUIRED_VARS=(PROD_HOST PROD_USER PROD_PASSWORD SOURCE_DB)
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Required environment variable $var is not set. Aborting!"
    exit 1
  fi
  echo "$var=${!var}"
done

# Set environment variables for all downstream processes and test runs (test safety)
export PGDATABASE="${TARGET_DB:-trail_master_db_test}"
export PGUSER="${DB_USER:-tester}"
export PGPASSWORD="${PGPASSWORD:-your_password_here}"
export PGHOST="${DB_HOST}"
export PGPORT="${DB_PORT}"

# Safety check: abort if trying to use production database
if [[ "$PGDATABASE" == "trail_master_db" ]]; then
  echo "❌ Refusing to run against production database!"
  exit 1
fi

echo "🔎 Checking current database context..."
CURRENT_DB=$(psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -tAc "SELECT current_database();")
echo "Current database: $CURRENT_DB"
# Show connection info for current DB_USER and TARGET_DB
echo "[DIAG] Connection info for test DB as $DB_USER:"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
if [ "$CURRENT_DB" != "trail_master_db_test" ]; then
  echo "❌ Refusing to run: current database is $CURRENT_DB, expected trail_master_db_test";
  exit 1
fi

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
            ROUND(AVG(elevation_gain)::numeric, 1) as avg_elevation_gain
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
# Parse --yes flag for non-interactive mode
auto_confirm=false
for arg in "$@"; do
  if [[ "$arg" == "--yes" ]]; then
    auto_confirm=true
  fi
done

if [ "$auto_confirm" = true ]; then
  echo -e "${GREEN}Auto-confirm enabled by --yes flag. Proceeding without prompt.${NC}"
else
  read -p "Continue? (y/N): " -n 1 -r REPLY
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Operation cancelled${NC}"
    exit 1
  fi
fi

echo "🔎 Terminating all active connections to $TARGET_DB (requires superuser: $SUPERUSER)..."
psql -h $DB_HOST -U $SUPERUSER -d postgres -c '\conninfo'
psql -h $DB_HOST -U $SUPERUSER -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET_DB' AND pid <> pg_backend_pid();" || {
  echo "❌ Failed to terminate active connections to $TARGET_DB. You may need superuser privileges."; exit 1;
}

echo "🗑️  Dropping test database $TARGET_DB (requires superuser or owner: $SUPERUSER)..."
psql -h $DB_HOST -U $SUPERUSER -d postgres -c '\conninfo'
psql -h $DB_HOST -U $SUPERUSER -d postgres -c "DROP DATABASE IF EXISTS $TARGET_DB;" || {
  echo "❌ Failed to drop test database $TARGET_DB. You may need to run this as a superuser or the database owner."; exit 1;
}

# Step 2: Create new test database
create_database "$TARGET_DB"

# Ensure the test database is owned by the correct user
CURRENT_OWNER=$(psql -h $DB_HOST -U $DB_USER -d postgres -tAc "SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$TARGET_DB';")
echo "Current owner of $TARGET_DB: $CURRENT_OWNER"
if [ "$CURRENT_OWNER" != "$DB_USER" ]; then
  echo "Changing owner of $TARGET_DB to $DB_USER..."
  psql -h $DB_HOST -U $DB_USER -d postgres -c "ALTER DATABASE $TARGET_DB OWNER TO $DB_USER;" || {
    echo "❌ Failed to change database owner. You may need superuser privileges."; exit 1;
  }
fi

# Always export and import the full schema for a clean test DB setup
# Remove skip logic for /tmp/latest_prod_schema.sql
# Export the full schema (all tables, functions, triggers, types, etc.)
# If schema import fails, delete the dump and abort

# Debug: print effective user and environment
whoami
echo "HOME: $HOME"
echo "PATH: $PATH"
ls -l ~/.pgpass || echo ".pgpass not found"
cat ~/.pgpass 2>/dev/null || echo ".pgpass not readable"
# Debug: print the exact pg_dump command and environment variables
echo "[DEBUG] Running pg_dump with the following parameters:"
echo "  PGPASSWORD=*** pg_dump --schema-only --no-owner --no-privileges -h $PROD_HOST -U $PROD_USER -d $SOURCE_DB > /tmp/latest_prod_schema.sql"
echo "  PROD_USER: $PROD_USER"
echo "  PROD_PASSWORD: (hidden)"
echo "  PROD_HOST: $PROD_HOST"
echo "  SOURCE_DB: $SOURCE_DB"

# Run pg_dump with full schema export
echo "📤 Exporting full production schema..."
PGPASSWORD='' pg_dump --schema-only --no-owner --no-privileges -h $PROD_HOST -U $PROD_USER -d $SOURCE_DB > /tmp/latest_prod_schema.sql || { echo "❌ Failed to export production schema."; rm -f /tmp/latest_prod_schema.sql; exit 1; }

# Debug: print the first 20 lines of the schema dump
printf '\n\n\n'  # Add blank lines for easier copy/paste
echo "[DEBUG] First 20 lines of /tmp/latest_prod_schema.sql:"
head -20 /tmp/latest_prod_schema.sql
printf '\n\n\n'  # Add blank lines after for easier copy/paste

# After exporting the schema, check for 'CREATE TABLE trails'
echo "🔍 Verifying schema dump contains 'trails' table..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
grep -qiE 'CREATE TABLE (public\.)?trails' /tmp/latest_prod_schema.sql || {
  echo "❌ Schema dump does not contain 'CREATE TABLE trails'. Aborting!"; rm -f /tmp/latest_prod_schema.sql; exit 1;
}

# Apply the schema to the test database
export PGPASSWORD="$PGPASSWORD"
echo "🗺️  Enabling PostGIS and related extensions in test DB $TARGET_DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;" || echo "(postgis_topology not available)"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_raster;" || echo "(postgis_raster not available)"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;" || echo "(fuzzystrmatch not available)"
# Note: SpatiaLite is for SQLite, not PostgreSQL. If using SpatiaLite, enable extensions in SQLite setup scripts.
echo "📥 Applying latest production schema to test DB $TARGET_DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -f /tmp/latest_prod_schema.sql || { echo "❌ Failed to apply production schema to test DB."; rm -f /tmp/latest_prod_schema.sql; exit 1; }

# After importing the schema, check that 'trails' table exists
echo "🔍 Verifying 'trails' table exists in test DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "\dt" | grep -q 'trails' || {
  echo "❌ 'trails' table does not exist in test DB after schema import. Aborting!"; rm -f /tmp/latest_prod_schema.sql; exit 1;
}

# Step 4: Copy sample data
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
copy_sample_data "boulder" "$BOULDER_SAMPLE_SIZE"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
copy_sample_data "seattle" "$SEATTLE_SAMPLE_SIZE"

# Step 5: Create indexes
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
create_indexes

# Removed redundant spatial index creation and detail output for idx_trails_geom, idx_routing_nodes_geometry, and idx_routing_edges_geometry, as these should be created by the schema copy step.
echo "Table schema and indexes for trails:"
psql "$TARGET_DB" -c "\d trails"

echo "Table schema and indexes for routing_nodes:"
psql "$TARGET_DB" -c "\d routing_nodes"

echo "Table schema and indexes for routing_edges:"
psql "$TARGET_DB" -c "\d routing_edges"

# Step 6: Analyze database
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
analyze_database

# Step 7: Show statistics
echo ""
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
show_stats

echo ""
echo -e "${GREEN}✅ Test database created successfully!${NC}"
echo -e "${BLUE}📝 To use this database for testing, set:${NC}"
echo -e "${BLUE}   export PGDATABASE=$TARGET_DB${NC}"
echo -e "${BLUE}   export PGUSER=$DB_USER${NC}"
echo ""
echo -e "${BLUE}🧪 You can now run tests with:${NC}"
echo -e "${BLUE}   PGDATABASE=$TARGET_DB npm test${NC}" 