#!/bin/bash
# Temporary diagnostic script for edge creation tolerance sweep
# Usage: ./edge_tolerance_sweep.sh [staging_schema] [trails_table]
# Example: ./edge_tolerance_sweep.sh staging_boulder_1234567890 trails

set -euo pipefail

SCHEMA="${1:-staging_boulder_1234567890}"
TRAILS_TABLE="${2:-trails}"

# List of tolerances to test (in meters)
TOLERANCES=(0.5 1 2 5 10 20 50)

# Print header
printf "\nEdge Creation Tolerance Sweep (schema: %s, table: %s)\n" "$SCHEMA" "$TRAILS_TABLE"
printf "%-12s | %-10s\n" "Tolerance(m)" "EdgeCount"
printf "-------------|-----------\n"

for TOL in "${TOLERANCES[@]}"; do
  # Run the build_routing_edges function and capture both stdout and stderr
  RAW_OUTPUT=$(psql -X -A -t -c "SELECT \"$SCHEMA\".build_routing_edges('$SCHEMA', '$TRAILS_TABLE', $TOL);" 2>&1)
  COUNT=$(echo "$RAW_OUTPUT" | tr -d '[:space:]')
  echo "DEBUG: Tolerance $TOL, Raw COUNT output: '$COUNT'"
  # Check if COUNT is a non-empty, all-digit value
  if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    printf "%-12s | %-10s\n" "$TOL" "$COUNT"
  else
    printf "%-12s | %-10s   (error or no result: %s)\n" "$TOL" "$COUNT" "$RAW_OUTPUT"
  fi
done

echo -e "\nDone. Review the table above to choose the best tolerance for edge creation.\n" 