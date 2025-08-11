#!/bin/bash
# Install PostGIS functions into a specific schema
# Usage: ./install_function_in_schema.sh <target_schema> [database_name] [sql_file]
# Example: ./install_function_in_schema.sh staging_boulder_1752119760538 trail_master_db ../../../sql/carthorse-postgis-intersection-functions.sql
# NOTE: Please manually back up your database/schema before running this script if needed.

set -euo pipefail

TARGET_SCHEMA="${1:-}"
DB_NAME="${2:-trail_master_db}"
SQL_FILE="${3:-../../../sql/carthorse-postgis-intersection-functions.sql}"

if [[ -z "$TARGET_SCHEMA" ]]; then
  echo "Usage: $0 <target_schema> [database_name] [sql_file]"
  exit 1
fi

# Step 1: Rewrite SQL file for target schema
TMP_SQL="/tmp/${TARGET_SCHEMA}_functions.sql"
echo "[Step 1] Rewriting SQL file for schema $TARGET_SCHEMA..."
sed \
  -e "s/CREATE OR REPLACE FUNCTION build_routing_nodes/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.build_routing_nodes/g" \
  -e "s/CREATE OR REPLACE FUNCTION build_routing_edges/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.build_routing_edges/g" \
  -e "s/CREATE OR REPLACE FUNCTION detect_trail_intersections/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.detect_trail_intersections/g" \
  -e "s/CREATE OR REPLACE FUNCTION get_intersection_stats/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.get_intersection_stats/g" \
  -e "s/CREATE OR REPLACE FUNCTION validate_intersection_detection/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.validate_intersection_detection/g" \
  -e "s/CREATE OR REPLACE FUNCTION validate_spatial_data_integrity/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.validate_spatial_data_integrity/g" \
  -e "s/CREATE OR REPLACE FUNCTION split_trails_at_intersections/CREATE OR REPLACE FUNCTION $TARGET_SCHEMA.split_trails_at_intersections/g" \
  "$SQL_FILE" > "$TMP_SQL"
echo "SQL rewrite complete: $TMP_SQL"

# Step 2: Install functions into the target schema
export PGDATABASE="$DB_NAME"
echo "[Step 2] Installing functions into schema $TARGET_SCHEMA in $DB_NAME..."
psql -f "$TMP_SQL"
echo "Functions installed successfully."

# Cleanup
rm "$TMP_SQL"
echo "All done." 