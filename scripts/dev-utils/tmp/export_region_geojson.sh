#!/bin/bash
# Export trails, nodes, edges, and intersections as GeoJSON for a region with visual styling for geojson.io
# Usage: ./export_region_geojson.sh min_lng min_lat max_lng max_lat output_prefix [schema]
# Example: ./export_region_geojson.sh -105.29 39.99 -105.27 40.02 chautauqua staging_bvr_1234567890
# Visualize the output in geojson.io or QGIS

set -euo pipefail

MIN_LNG="$1"
MIN_LAT="$2"
MAX_LNG="$3"
MAX_LAT="$4"
PREFIX="$5"
SCHEMA="${6:-public}"
DB="trail_master_db_test"

# Export trails (default black lines)
echo "Exporting trails..."
PGDATABASE=$DB psql -X -A -t -c "\COPY (SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(geometry)::jsonb, 'properties', jsonb_build_object('id', id, 'name', name)) FROM ${SCHEMA}.trails WHERE geometry && ST_MakeEnvelope($MIN_LNG, $MIN_LAT, $MAX_LNG, $MAX_LAT, 4326) LIMIT 100) TO '${PREFIX}_trails.geojson'"

# Export routing nodes as large, bright blue points
echo "Exporting routing nodes..."
PGDATABASE=$DB psql -X -A -t -c "\COPY (SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(lng, lat), 4326))::jsonb, 'properties', jsonb_build_object('node_type', node_type, 'id', id, 'marker-color', '#0074D9', 'marker-size', 'large')) FROM ${SCHEMA}.routing_nodes WHERE lng BETWEEN $MIN_LNG AND $MAX_LNG AND lat BETWEEN $MIN_LAT AND $MAX_LAT LIMIT 100) TO '${PREFIX}_nodes.geojson'"

# Export routing edges as pink dotted lines
echo "Exporting routing edges..."
PGDATABASE=$DB psql -X -A -t -c "\COPY (SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(ST_MakeLine(ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326), ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)))::jsonb, 'properties', jsonb_build_object('edge_id', e.id, 'trail_id', e.trail_id, 'stroke', '#ff69b4', 'stroke-dasharray', '5,5', 'stroke-width', 3)) FROM ${SCHEMA}.routing_edges e JOIN ${SCHEMA}.routing_nodes n1 ON e.from_node_id = n1.id JOIN ${SCHEMA}.routing_nodes n2 ON e.to_node_id = n2.id WHERE n1.lng BETWEEN $MIN_LNG AND $MAX_LNG AND n1.lat BETWEEN $MIN_LAT AND $MAX_LAT LIMIT 100) TO '${PREFIX}_edges.geojson'"

# Export intersection points as large, bright red points
echo "Exporting intersection points..."
PGDATABASE=$DB psql -X -A -t -c "\COPY (SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(point)::jsonb, 'properties', jsonb_build_object('intersection_id', id, 'marker-color', '#ff0000', 'marker-size', 'large')) FROM ${SCHEMA}.intersection_points WHERE ST_X(point) BETWEEN $MIN_LNG AND $MAX_LNG AND ST_Y(point) BETWEEN $MIN_LAT AND $MAX_LAT LIMIT 100) TO '${PREFIX}_intersections.geojson'"

# Combine all features into a single FeatureCollection (pretty-printed)
echo "Combining all features into ${PREFIX}_all.geojson..."
echo '{"type":"FeatureCollection","features":' > tmp_features.json
jq -s '.' ${PREFIX}_trails.geojson ${PREFIX}_nodes.geojson ${PREFIX}_edges.geojson ${PREFIX}_intersections.geojson >> tmp_features.json
echo '}' >> tmp_features.json
jq . tmp_features.json > ${PREFIX}_all.geojson
rm tmp_features.json

echo "Done. Visualize ${PREFIX}_all.geojson in geojson.io or QGIS." 