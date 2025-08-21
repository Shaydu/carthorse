#!/bin/bash

# Create Production Staging Schema Script
# This script creates a staging schema exactly like production workflow
# Uses timestamp-based naming and runs the full pipeline

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
OUTPUT_PATH=${2:-data/test-production-staging.db}

echo -e "${BLUE}🏭 Creating Production Staging Schema${NC}"
echo "=========================================="
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo "Region: $REGION"
echo "Output: $OUTPUT_PATH"
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

# Step 1: Generate staging schema name (like production)
TIMESTAMP=$(date +%s)
STAGING_SCHEMA="staging_${REGION}_${TIMESTAMP}"
echo -e "${GREEN}📋 Generated staging schema: $STAGING_SCHEMA${NC}"

# Step 2: Create staging schema
echo -e "${BLUE}🔧 Creating staging schema...${NC}"
run_query_verbose "DROP SCHEMA IF EXISTS $STAGING_SCHEMA CASCADE;" "Dropping existing schema (if any)"
run_query_verbose "CREATE SCHEMA $STAGING_SCHEMA;" "Creating staging schema"

# Step 3: Create staging tables (using production DDL)
echo -e "${BLUE}📊 Creating staging tables...${NC}"

# Create trails table
run_query_verbose "
CREATE TABLE $STAGING_SCHEMA.trails (
  id SERIAL PRIMARY KEY,
  app_uuid TEXT UNIQUE NOT NULL,
  osm_id TEXT,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  trail_type TEXT,
  surface TEXT,
  difficulty TEXT,
  source_tags JSONB,
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  length_km REAL,
  elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
  elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
  max_elevation REAL,
  min_elevation REAL,
  avg_elevation REAL,
  source TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  geometry GEOMETRY(LINESTRINGZ, 4326),
  geometry_text TEXT,
  geometry_hash TEXT NOT NULL
);" "Creating trails table"

# Create trail_hashes table
run_query_verbose "
CREATE TABLE $STAGING_SCHEMA.trail_hashes (
  id SERIAL PRIMARY KEY,
  app_uuid TEXT NOT NULL,
  geometry_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);" "Creating trail_hashes table"

# Create intersection_points table
run_query_verbose "
CREATE TABLE $STAGING_SCHEMA.intersection_points (
  id SERIAL PRIMARY KEY,
  point GEOMETRY(POINT, 4326),
  point_3d GEOMETRY(POINTZ, 4326),
  connected_trail_ids TEXT[],
  connected_trail_names TEXT[],
  node_type TEXT,
  distance_meters REAL,
  created_at TIMESTAMP DEFAULT NOW()
);" "Creating intersection_points table"

# Create split_trails table
run_query_verbose "
CREATE TABLE $STAGING_SCHEMA.split_trails (
  id SERIAL PRIMARY KEY,
  original_trail_id INTEGER,
  segment_number INTEGER,
  app_uuid TEXT UNIQUE NOT NULL,
  name TEXT,
  trail_type TEXT,
  surface TEXT,
  difficulty TEXT,
  source_tags TEXT,
  osm_id TEXT,
  elevation_gain REAL,
  elevation_loss REAL,
  max_elevation REAL,
  min_elevation REAL,
  avg_elevation REAL,
  length_km REAL,
  source TEXT,
  geometry GEOMETRY(LINESTRINGZ, 4326),
  bbox_min_lng REAL,
  bbox_max_lng REAL,
  bbox_min_lat REAL,
  bbox_max_lat REAL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);" "Creating split_trails table"

# Create routing_nodes table
run_query_verbose "
CREATE TABLE $STAGING_SCHEMA.routing_nodes (
  id SERIAL PRIMARY KEY,
  node_uuid TEXT UNIQUE,
  lat REAL,
  lng REAL,
  elevation REAL,
  node_type TEXT,
  connected_trails TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);" "Creating routing_nodes table"

# Create routing_edges table
run_query_verbose "
CREATE TABLE $STAGING_SCHEMA.routing_edges (
  id SERIAL PRIMARY KEY,
  source INTEGER NOT NULL,
  target INTEGER NOT NULL,
  trail_id TEXT NOT NULL,
  trail_name TEXT NOT NULL,
  distance_km REAL NOT NULL,
  elevation_gain REAL CHECK(elevation_gain IS NULL OR elevation_gain >= 0),
  elevation_loss REAL CHECK(elevation_loss IS NULL OR elevation_loss >= 0),
  is_bidirectional BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  geometry geometry(LineStringZ, 4326),
  geojson TEXT,
  FOREIGN KEY (source) REFERENCES $STAGING_SCHEMA.routing_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target) REFERENCES $STAGING_SCHEMA.routing_nodes(id) ON DELETE CASCADE
);" "Creating routing_edges table"

# Step 4: Create spatial indexes
echo -e "${BLUE}🔍 Creating spatial indexes...${NC}"
run_query_verbose "
CREATE INDEX IF NOT EXISTS idx_${STAGING_SCHEMA}_trails_geometry ON $STAGING_SCHEMA.trails USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_${STAGING_SCHEMA}_split_trails_geometry ON $STAGING_SCHEMA.split_trails USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_${STAGING_SCHEMA}_intersection_points ON $STAGING_SCHEMA.intersection_points USING GIST(point);
CREATE INDEX IF NOT EXISTS idx_${STAGING_SCHEMA}_routing_nodes_location ON $STAGING_SCHEMA.routing_nodes USING GIST(ST_SetSRID(ST_MakePoint(lng, lat), 4326));
CREATE INDEX IF NOT EXISTS idx_${STAGING_SCHEMA}_routing_edges_geometry ON $STAGING_SCHEMA.routing_edges USING GIST(geometry);" "Creating spatial indexes"

# Step 5: Create UUID generation trigger
echo -e "${BLUE}🔧 Creating UUID generation trigger...${NC}"
run_query_verbose "
DROP TRIGGER IF EXISTS trigger_generate_app_uuid ON $STAGING_SCHEMA.trails;
CREATE TRIGGER trigger_generate_app_uuid
  BEFORE INSERT ON $STAGING_SCHEMA.trails
  FOR EACH ROW
  EXECUTE FUNCTION generate_app_uuid();" "Creating UUID generation trigger"

# Step 5.5: Create auto_calculate_length trigger
echo -e "${BLUE}🔧 Creating auto_calculate_length trigger...${NC}"
run_query_verbose "
CREATE OR REPLACE FUNCTION $STAGING_SCHEMA.auto_calculate_length()
RETURNS trigger
LANGUAGE plpgsql
AS \$\$
BEGIN
  IF NEW.geometry IS NOT NULL AND (NEW.length_km IS NULL OR NEW.length_km <= 0) THEN
    NEW.length_km := ST_Length(NEW.geometry, true) / 1000.0; -- Convert meters to kilometers
  END IF;
  
  RETURN NEW;
END;
\$\$;" "Creating auto_calculate_length function"

run_query_verbose "
DROP TRIGGER IF EXISTS trigger_auto_calculate_length ON $STAGING_SCHEMA.trails;
CREATE TRIGGER trigger_auto_calculate_length
  BEFORE INSERT OR UPDATE ON $STAGING_SCHEMA.trails
  FOR EACH ROW
  EXECUTE FUNCTION $STAGING_SCHEMA.auto_calculate_length();" "Creating auto_calculate_length trigger"

# Step 6: Copy region data to staging
echo -e "${BLUE}📋 Copying region data to staging...${NC}"
run_query_verbose "
INSERT INTO $STAGING_SCHEMA.trails (
  app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
  bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
  elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
  source, geometry, geometry_text, geometry_hash
)
SELECT 
  app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
  bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
  elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
  source, geometry, ST_AsText(geometry), MD5(ST_AsText(geometry))
FROM trails 
WHERE region = '$REGION'
LIMIT 10;" "Copying region data to staging (limited to 10 trails for testing)"

# Step 7: Verify staging environment
echo -e "${BLUE}✅ Verifying staging environment...${NC}"
run_query_verbose "
SELECT 
  'trails' as table_name, COUNT(*) as count FROM $STAGING_SCHEMA.trails
UNION ALL
SELECT 'trail_hashes', COUNT(*) FROM $STAGING_SCHEMA.trail_hashes
UNION ALL
SELECT 'intersection_points', COUNT(*) FROM $STAGING_SCHEMA.intersection_points
UNION ALL
SELECT 'split_trails', COUNT(*) FROM $STAGING_SCHEMA.split_trails
UNION ALL
SELECT 'routing_nodes', COUNT(*) FROM $STAGING_SCHEMA.routing_nodes
UNION ALL
SELECT 'routing_edges', COUNT(*) FROM $STAGING_SCHEMA.routing_edges;" "Staging environment summary"

# Step 8: Run routing graph generation (if PostGIS functions are available)
echo -e "${BLUE}🔄 Running routing graph generation...${NC}"

# Check if PostGIS functions are available
FUNCTIONS_EXIST=$(run_query "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN ('build_routing_nodes', 'build_routing_edges')")

if [ "$FUNCTIONS_EXIST" -gt 0 ]; then
    echo -e "${GREEN}✅ PostGIS functions found, running routing graph generation...${NC}"
    
    # Build routing nodes
    run_query_verbose "SELECT build_routing_nodes('$STAGING_SCHEMA', 'trails', 2.0);" "Building routing nodes"
    
    # Build routing edges
    run_query_verbose "SELECT build_routing_edges('$STAGING_SCHEMA', 'trails');" "Building routing edges"
    
    # Show routing summary
    run_query_verbose "SELECT * FROM show_routing_summary();" "Routing graph summary"
else
    echo -e "${YELLOW}⚠️  PostGIS functions not found, skipping routing graph generation${NC}"
fi

# Step 9: Export to SQLite (optional)
if [ "$3" = "--export" ]; then
    echo -e "${BLUE}💾 Exporting to SQLite...${NC}"
    NODE_ENV=test PGDATABASE=$DB_NAME npx ts-node src/cli/export.ts --region $REGION --out $OUTPUT_PATH --staging-schema $STAGING_SCHEMA
    echo -e "${GREEN}✅ Export completed: $OUTPUT_PATH${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Production staging schema created successfully!${NC}"
echo -e "${BLUE}📋 Staging Schema: $STAGING_SCHEMA${NC}"
echo -e "${BLUE}📊 Database: $DB_NAME${NC}"
echo -e "${BLUE}🗺️  Region: $REGION${NC}"
echo ""
echo -e "${YELLOW}💡 To clean up the staging schema:${NC}"
echo -e "${YELLOW}   DROP SCHEMA IF EXISTS $STAGING_SCHEMA CASCADE;${NC}"
echo ""
echo -e "${YELLOW}💡 To export to SQLite:${NC}"
echo -e "${YELLOW}   ./scripts/create-production-staging.sh $REGION $OUTPUT_PATH --export${NC}" 