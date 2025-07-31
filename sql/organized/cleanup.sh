#!/bin/bash
# Carthorse Database Cleanup Script
# Generated: 2025-07-31T20:31:01.747Z

set -e

echo "🧹 Cleaning up Carthorse Database..."

# Drop old staging schemas (>24h old)
echo "📋 Finding old staging schemas..."
OLD_SCHEMAS=$(psql -t -d carthorse_db -c "
  SELECT schema_name 
  FROM information_schema.schemata 
  WHERE schema_name LIKE 'staging_%'
  AND EXTRACT(EPOCH FROM (NOW() - to_timestamp(
    split_part(schema_name, '_', 3)::bigint / 1000
  ))) > 86400
")

if [ ! -z "$OLD_SCHEMAS" ]; then
    echo "🗑️  Dropping old staging schemas..."
    echo "$OLD_SCHEMAS" | while read schema; do
        if [ ! -z "$schema" ]; then
            echo "  Dropping $schema"
            psql -d carthorse_db -c "DROP SCHEMA IF EXISTS $schema CASCADE;"
        fi
    done
else
    echo "✅ No old staging schemas to clean up"
fi

echo "✅ Cleanup complete!"
