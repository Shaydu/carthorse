#!/bin/bash

# Create Minimal Test Database with Chautauqua Area Trails
# This script creates a very small test database for fast development

set -e

# Configuration
SOURCE_DB="${SOURCE_DB:-trail_master_db}"
TARGET_DB="${TARGET_DB:-trail_master_db_test_40}"
DB_USER="tester"  # Use 'tester' ONLY for test environments
DB_HOST="localhost"
DB_PORT="5432"

# Superuser for dropping/creating the test database
SUPERUSER="${SUPERUSER:-tester}"

# Production read-only user for schema export
PROD_USER="${PROD_USER:-shaydu}"
PROD_PASSWORD="${PROD_PASSWORD:-your_shaydu_password}"
PROD_HOST="${PROD_HOST:-localhost}"

# Required environment variables
REQUIRED_VARS=(PROD_HOST PROD_USER PROD_PASSWORD SOURCE_DB)
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Required environment variable $var is not set. Aborting!"
    exit 1
  fi
  echo "$var=${!var}"
done

# Set environment variables for all downstream processes
export PGDATABASE="${TARGET_DB:-trail_master_db_test_40}"
export PGUSER="${DB_USER:-tester}"
export PGPASSWORD="${PGPASSWORD:-your_password_here}"
export PGHOST="${DB_HOST}"
export PGPORT="${DB_PORT}"

# Safety check: abort if trying to use production database
if [[ "$PGDATABASE" == "trail_master_db" ]]; then
  echo "❌ Refusing to run against production database!"
  exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔧 Creating minimal test database with Chautauqua trails...${NC}"
echo -e "${BLUE}Source: $SOURCE_DB${NC}"
echo -e "${BLUE}Target: $TARGET_DB${NC}"
echo -e "${BLUE}Chautauqua trails: 40 trails${NC}"
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

# Function to create indexes
create_indexes() {
    echo -e "${GREEN}🔧 Creating essential indexes...${NC}"
    
    # Create spatial indexes
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_gist 
        ON trails USING GIST (geometry);
    " 2>/dev/null || echo "    Failed to create spatial index on trails"
    
    # Create composite indexes for common queries
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        CREATE INDEX IF NOT EXISTS idx_trails_region_geometry 
        ON trails (region) WHERE geometry IS NOT NULL;
    " 2>/dev/null || echo "    Failed to create region index"
    
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        CREATE INDEX IF NOT EXISTS idx_trails_elevation_geometry 
        ON trails (elevation_gain, elevation_loss) WHERE geometry IS NOT NULL;
    " 2>/dev/null || echo "    Failed to create elevation index"
    
    # Create indexes for routing tables
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        CREATE INDEX IF NOT EXISTS idx_routing_nodes_geometry_gist 
        ON routing_nodes USING GIST (geometry);
    " 2>/dev/null || echo "    Failed to create routing_nodes spatial index"
    
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        CREATE INDEX IF NOT EXISTS idx_routing_edges_from_to 
        ON routing_edges (from_node_id, to_node_id);
    " 2>/dev/null || echo "    Failed to create routing_edges index"
}

# Function to analyze database
analyze_database() {
    echo -e "${GREEN}📊 Analyzing database statistics...${NC}"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "ANALYZE trails;" 2>/dev/null || echo "    Failed to analyze trails"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "ANALYZE regions;" 2>/dev/null || echo "    Failed to analyze regions"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "ANALYZE routing_nodes;" 2>/dev/null || echo "    Failed to analyze routing_nodes"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "ANALYZE routing_edges;" 2>/dev/null || echo "    Failed to analyze routing_edges"
}

# Function to show statistics
show_stats() {
    echo -e "${GREEN}📊 Database Statistics:${NC}"
    psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "
        SELECT 
            'trails' as table_name,
            COUNT(*) as record_count,
            COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_count,
            COUNT(CASE WHEN region = 'seattle' THEN 1 END) as seattle_count,
            COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as three_d_count,
            COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as elevation_count
        FROM trails
        UNION ALL
        SELECT 
            'routing_nodes' as table_name,
            COUNT(*) as record_count,
            NULL as boulder_count,
            NULL as seattle_count,
            NULL as three_d_count,
            NULL as elevation_count
        FROM routing_nodes
        UNION ALL
        SELECT 
            'routing_edges' as table_name,
            COUNT(*) as record_count,
            NULL as boulder_count,
            NULL as seattle_count,
            NULL as three_d_count,
            NULL as elevation_count
        FROM routing_edges;
    " 2>/dev/null || echo "    Could not get statistics"
}

# Main process
echo -e "${GREEN}🚀 Starting minimal test database creation...${NC}"
echo ""

# Step 1: Drop existing test database
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

# Step 3: Export and import the full schema
echo "📤 Exporting full production schema..."
PGPASSWORD='' pg_dump --schema-only --no-owner --no-privileges -h $PROD_HOST -U $PROD_USER -d $SOURCE_DB > /tmp/minimal_test_schema.sql || { 
  echo "❌ Failed to export production schema."; 
  rm -f /tmp/minimal_test_schema.sql; 
  exit 1; 
}

# Apply the schema to the test database
echo "🗺️  Enabling PostGIS and related extensions in test DB $TARGET_DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;" || echo "(postgis_topology not available)"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS postgis_raster;" || echo "(postgis_raster not available)"
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;" || echo "(fuzzystrmatch not available)"

echo "📥 Applying latest production schema to test DB $TARGET_DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -f /tmp/minimal_test_schema.sql || { 
  echo "❌ Failed to apply production schema to test DB."; 
  rm -f /tmp/minimal_test_schema.sql; 
  exit 1; 
}

# After importing the schema, check that 'trails' table exists
echo "🔍 Verifying 'trails' table exists in test DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "\dt" | grep -q 'trails' || {
  echo "❌ 'trails' table does not exist in test DB after schema import. Aborting!"; 
  rm -f /tmp/minimal_test_schema.sql; 
  exit 1;
}

# Step 4: Insert required regions for referential integrity
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c \
  "INSERT INTO regions (region_key, name) VALUES
    ('boulder', 'Boulder Test Region')
   ON CONFLICT (region_key) DO NOTHING;"

# Step 5: Copy Chautauqua area trails from production
echo "📥 Copying 40 Chautauqua area trails from production..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'

# Copy Chautauqua trails using a bounding box around Chautauqua Park
# Chautauqua Park is roughly at 39.9950, -105.2810
# We'll use a bounding box around this area
psql -h $PROD_HOST -U $PROD_USER -d $SOURCE_DB -c "
COPY (
    SELECT * FROM trails 
    WHERE region = 'boulder' 
    AND ST_Within(
        geometry, 
        ST_MakeEnvelope(-105.3, 39.98, -105.26, 40.01, 4326)
    )
    LIMIT 40
) TO STDOUT WITH CSV HEADER
" > /tmp/chautauqua_trails.csv

echo "📥 Importing Chautauqua trails into $TARGET_DB..."
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c "COPY trails FROM STDIN WITH CSV HEADER" < /tmp/chautauqua_trails.csv
rm -f /tmp/chautauqua_trails.csv

# Step 6: Create indexes
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
create_indexes

echo "Table schema and indexes for trails:"
psql "$TARGET_DB" -c "\d trails"

echo "Table schema and indexes for routing_nodes:"
psql "$TARGET_DB" -c "\d routing_nodes"

echo "Table schema and indexes for routing_edges:"
psql "$TARGET_DB" -c "\d routing_edges"

# Step 7: Analyze database
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
analyze_database

# Step 8: Show statistics
echo ""
psql -h $DB_HOST -U $DB_USER -d $TARGET_DB -c '\conninfo'
show_stats

echo ""
echo -e "${GREEN}✅ Minimal test database created successfully!${NC}"
echo -e "${BLUE}📝 To use this database for testing, set:${NC}"
echo -e "${BLUE}   export PGDATABASE=$TARGET_DB${NC}"
echo -e "${BLUE}   export PGUSER=$DB_USER${NC}"
echo ""
echo -e "${BLUE}🧪 You can now run tests with:${NC}"
echo -e "${BLUE}   PGDATABASE=$TARGET_DB npm test${NC}"
echo ""
echo -e "${YELLOW}📊 Database contains:${NC}"
echo -e "${YELLOW}   - 40 Chautauqua area trails from Boulder${NC}"
echo -e "${YELLOW}   - Full schema with PostGIS extensions${NC}"
echo -e "${YELLOW}   - Optimized indexes for fast testing${NC}"

# Clean up temporary files
rm -f /tmp/minimal_test_schema.sql 