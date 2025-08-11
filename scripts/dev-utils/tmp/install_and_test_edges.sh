#!/bin/bash
# Install build_routing_edges and run edge detection tests
# Usage: ./install_and_test_edges.sh [staging_schema] [trails_table]
# Example: ./install_and_test_edges.sh staging_boulder_1234567890 trails

set -euo pipefail

SCHEMA="${1:-staging_boulder_1234567890}"
TRAILS_TABLE="${2:-trails}"

export PGDATABASE=trail_master_db_test

echo "[Step 1] Installing/updating PostGIS functions in $PGDATABASE..."
psql -f ../../../sql/carthorse-postgis-intersection-functions.sql

echo "[Step 2] Running edge tolerance sweep for schema: $SCHEMA, table: $TRAILS_TABLE..."
./edge_tolerance_sweep.sh "$SCHEMA" "$TRAILS_TABLE"

echo "\nAll steps completed. Review the output above for edge detection results.\n" 