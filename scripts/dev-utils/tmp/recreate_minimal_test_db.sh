#!/bin/bash
# Recreate a minimal test database with only Boulder or Seattle region trails
# Usage: ./recreate_minimal_test_db.sh [boulder|seattle]
# Example: ./recreate_minimal_test_db.sh boulder

set -euo pipefail

REGION="${1:-boulder}"
MINIMAL_DB="trail_master_db_test_minimal"
BACKUP_FILE="../../../backups/backup_trail_master_db_full_20250723_072033.sql"
INSTALL_FN_SCRIPT="./install_function_in_schema.sh"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file $BACKUP_FILE not found!"
  exit 1
fi
if [[ ! -f "$INSTALL_FN_SCRIPT" ]]; then
  echo "Function installer $INSTALL_FN_SCRIPT not found!"
  exit 1
fi

# Step 1: Drop and recreate the minimal test database
echo "[Step 1] Dropping and recreating $MINIMAL_DB..."
dropdb --if-exists "$MINIMAL_DB"
createdb "$MINIMAL_DB"
echo "Minimal test database $MINIMAL_DB created."

# Step 2: Create required tables (trails, routing_nodes, routing_edges)
echo "[Step 2] Creating required tables in $MINIMAL_DB..."
psql "$MINIMAL_DB" <<'EOSQL'
CREATE TABLE public.trails (
  id SERIAL PRIMARY KEY,
  region TEXT,
  name TEXT,
  geometry GEOMETRY,
  -- Add other columns as needed for your workflow
  -- ...
  -- For minimal test, only include required columns
  -- You can adjust this schema as needed
  -- Example columns:
  length_km REAL,
  elevation_gain REAL
);
CREATE TABLE public.routing_nodes (
  id SERIAL PRIMARY KEY,
  node_uuid TEXT UNIQUE,
  lat REAL,
  lng REAL,
  elevation REAL,
  node_type TEXT,
  connected_trails TEXT
);
CREATE TABLE public.routing_edges (
  id SERIAL PRIMARY KEY,
  from_node_id INTEGER,
  to_node_id INTEGER,
  trail_id TEXT,
  trail_name TEXT,
  distance_km REAL,
  elevation_gain REAL
);
EOSQL

# Step 3: Extract and load only the region's trails from the backup
echo "[Step 3] Extracting and loading $REGION region trails from backup..."
# Dump only the region's trails to a temp file
TMP_TRAILS_SQL="/tmp/${REGION}_trails.sql"
PGDATABASE=trail_master_db psql -At -c "COPY (SELECT * FROM public.trails WHERE region = '$REGION') TO STDOUT" > "$TMP_TRAILS_SQL"
# Load into minimal test DB
psql "$MINIMAL_DB" -c "COPY public.trails FROM STDIN" < "$TMP_TRAILS_SQL"
rm "$TMP_TRAILS_SQL"
echo "Region trails loaded."

# Step 4: Install PostGIS functions in the minimal test DB
echo "[Step 4] Installing PostGIS functions in $MINIMAL_DB..."
$INSTALL_FN_SCRIPT public "$MINIMAL_DB"
echo "Functions installed."

echo "Minimal test database $MINIMAL_DB is ready with only the $REGION region trails." 