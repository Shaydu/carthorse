#!/bin/bash
# Export routing nodes and edges as GeoJSON for Boulder Valley Ranch bbox
# Usage: bash export_bvr_geojson.sh
# Output: nodes-bvr.geojson and edges-bvr.geojson in current directory

DB="test-boulder-export.db"
MIN_LNG=-105.29
MAX_LNG=-105.23
MIN_LAT=40.07
MAX_LAT=40.10

# Export routing nodes
spatialite "$DB" "
SELECT
  '{\"type\":\"FeatureCollection\",\"features\":[' ||
  group_concat(
    '{\"type\":\"Feature\",\"geometry\":' || AsGeoJSON(coordinate, 6) ||
    ',\"properties\":' ||
    json_object('node_uuid', node_uuid, 'node_type', node_type, 'elevation', elevation)
  ) || ']}' AS geojson
FROM routing_nodes
WHERE lng BETWEEN $MIN_LNG AND $MAX_LNG AND lat BETWEEN $MIN_LAT AND $MAX_LAT;
" | jq -r .geojson > nodes-bvr.geojson

echo "Exported nodes to nodes-bvr.geojson"

# Export routing edges for nodes in bbox
spatialite "$DB" "
WITH bbox_nodes AS (
  SELECT id FROM routing_nodes
  WHERE lng BETWEEN $MIN_LNG AND $MAX_LNG AND lat BETWEEN $MIN_LAT AND $MAX_LAT
)
SELECT
  '{\"type\":\"FeatureCollection\",\"features\":[' ||
  group_concat(
    '{\"type\":\"Feature\",\"geometry\":' || AsGeoJSON(geometry, 6) ||
    ',\"properties\":' ||
    json_object('from_node_id', from_node_id, 'to_node_id', to_node_id, 'trail_id', trail_id, 'distance_km', distance_km)
  ) || ']}' AS geojson
FROM routing_edges
WHERE from_node_id IN (SELECT id FROM bbox_nodes) OR to_node_id IN (SELECT id FROM bbox_nodes);
" | jq -r .geojson > edges-bvr.geojson

echo "Exported edges to edges-bvr.geojson" 