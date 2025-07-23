#!/bin/bash

DB=trail_master_db
PGUSER=${PGUSER:-your_pg_user}
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}

# Get all unique region prefixes
regions=$(psql -d "$DB" -Atc "SELECT DISTINCT regexp_replace(schema_name, E'_\\d+$', '') FROM information_schema.schemata WHERE schema_name LIKE 'staging\_%' ORDER BY 1;")

for region in $regions; do
  # Get all schemas for this region, sorted DESC, skip the first (latest)
  schemas=$(psql -d "$DB" -Atc "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${region}_%' ORDER BY schema_name DESC OFFSET 1;")
  for schema in $schemas; do
    echo "Dropping schema: $schema"
    psql -d "$DB" -c "DROP SCHEMA IF EXISTS $schema CASCADE;"
  done
done

echo "All old staging_* schemas dropped (except the latest for each region)." 