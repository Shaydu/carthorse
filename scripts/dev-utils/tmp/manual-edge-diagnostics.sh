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

psql -d $DB <<EOF
\echo '--- Running build_routing_edges ---'
DO \$
BEGIN
  BEGIN
    PERFORM $SCHEMA.build_routing_edges('$SCHEMA', 'split_trails', 20.0);
    RAISE NOTICE 'build_routing_edges ran successfully';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'build_routing_edges failed: %', SQLERRM;
  END;
END
\$;

\echo '--- routing_edges count ---'
SELECT COUNT(*) AS edge_count FROM $SCHEMA.routing_edges;
\echo '--- Sample routing_edges rows ---'
SELECT * FROM $SCHEMA.routing_edges LIMIT 5;

\echo '--- routing_nodes count ---'
SELECT COUNT(*) AS node_count FROM $SCHEMA.routing_nodes;
\echo '--- Sample routing_nodes rows ---'
SELECT * FROM $SCHEMA.routing_nodes LIMIT 5;
\echo '--- Node types breakdown ---'
SELECT node_type, COUNT(*) FROM $SCHEMA.routing_nodes GROUP BY node_type;

\echo '--- split_trails count ---'
SELECT COUNT(*) AS split_trail_count FROM $SCHEMA.split_trails;
\echo '--- Sample split_trails rows ---'
SELECT * FROM $SCHEMA.split_trails LIMIT 5;
EOF 