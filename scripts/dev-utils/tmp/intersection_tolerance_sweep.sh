#!/bin/bash
# Sweep detect_trail_intersections tolerance and output intersection counts
# Usage: ./intersection_tolerance_sweep.sh [schema] [table] [output_csv_tolerance]
# Example: ./intersection_tolerance_sweep.sh public trails 0.01
# The CSV and GeoJSON outputs can be visualized in QGIS or similar tools for sanity checking.

set -euo pipefail

SCHEMA="${1:-public}"
TABLE="${2:-trails}"
CSV_TOL="${3:-0.01}"
DB="trail_master_db_test"

TOLS=(0.001 0.005 0.01 0.05 0.1 0.5 1 2)

printf "\nIntersection Tolerance Sweep (schema: %s, table: %s)\n" "$SCHEMA" "$TABLE"
printf "%-12s | %-10s\n" "Tolerance" "Intersections"
printf "-------------|-------------\n"

for TOL in "${TOLS[@]}"; do
  COUNT=$(PGDATABASE=$DB psql -X -A -t -c "SELECT COUNT(*) FROM $SCHEMA.detect_trail_intersections('$SCHEMA', '$TABLE', $TOL);" | tr -d '[:space:]')
  if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    printf "%-12s | %-10s\n" "$TOL" "$COUNT"
  else
    printf "%-12s | %-10s   (error or no result: %s)\n" "$TOL" "$COUNT" "$COUNT"
  fi
done

# Output CSV for chosen tolerance
CSV_OUT="intersections_${SCHEMA}_${TABLE}_${CSV_TOL}.csv"
echo "\nExporting intersections for tolerance $CSV_TOL to $CSV_OUT..."
PGDATABASE=$DB psql -X -A -F',' -c "\COPY (SELECT ST_X(intersection_point) AS lng, ST_Y(intersection_point) AS lat, connected_trail_names, node_type, distance_meters FROM $SCHEMA.detect_trail_intersections('$SCHEMA', '$TABLE', $CSV_TOL)) TO '$CSV_OUT' WITH CSV HEADER"
echo "CSV export complete. You can visualize $CSV_OUT in QGIS or another GIS tool."

# Output GeoJSON for a small subset
GEOJSON_OUT="intersections_${SCHEMA}_${TABLE}_${CSV_TOL}.geojson"
echo "\nExporting first 100 intersections for tolerance $CSV_TOL to $GEOJSON_OUT..."
PGDATABASE=$DB psql -X -A -t -c "\COPY (SELECT jsonb_pretty(jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(intersection_point)::jsonb, 'properties', jsonb_build_object('connected_trail_names', connected_trail_names, 'node_type', node_type, 'distance_meters', distance_meters))) FROM (SELECT * FROM $SCHEMA.detect_trail_intersections('$SCHEMA', '$TABLE', $CSV_TOL) LIMIT 100) AS subset) TO '$GEOJSON_OUT'"
echo "GeoJSON export complete. You can visualize $GEOJSON_OUT in QGIS or another GIS tool." 