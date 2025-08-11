#!/bin/bash

REGION=${1:-boulder}
DB=trail_master_db_test

# Find latest staging schema
SCHEMA=$(psql -d $DB -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'staging_${REGION}_%' ORDER BY schema_name DESC LIMIT 1" | xargs)

if [ -z "$SCHEMA" ]; then
  echo "[ERROR] No staging schema found for region '$REGION'"
  exit 1
fi

echo "Using staging schema: $SCHEMA"

echo "--- Tables in $SCHEMA ---"
psql -d $DB -c "SELECT table_name FROM information_schema.tables WHERE table_schema = '$SCHEMA' ORDER BY table_name;" 