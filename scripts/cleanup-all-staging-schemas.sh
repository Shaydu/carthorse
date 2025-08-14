#!/bin/bash

# Cleanup script to delete all carthorse staging schemas
# This will permanently delete all staging data

DB_NAME="trail_master_db"

echo "🗑️  Carthorse Staging Schema Cleanup"
echo "====================================="
echo ""

# Get all carthorse schemas
echo "🔍 Finding all carthorse staging schemas..."
SCHEMAS=$(psql -d "$DB_NAME" -t -c "
  SELECT schema_name 
  FROM information_schema.schemata 
  WHERE schema_name LIKE 'carthorse_%' 
  ORDER BY schema_name
" | xargs)

if [ -z "$SCHEMAS" ]; then
  echo "✅ No carthorse staging schemas found to delete."
  exit 0
fi

echo "📋 Found the following staging schemas:"
echo "$SCHEMAS" | tr ' ' '\n' | nl
echo ""

# Count total schemas
SCHEMA_COUNT=$(echo "$SCHEMAS" | wc -w)
echo "📊 Total schemas to delete: $SCHEMA_COUNT"
echo ""

# Confirm deletion
read -p "⚠️  Are you sure you want to delete ALL $SCHEMA_COUNT staging schemas? This cannot be undone! (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Deletion cancelled."
  exit 0
fi

echo ""
echo "🗑️  Starting deletion..."

# Delete each schema
DELETED_COUNT=0
for schema in $SCHEMAS; do
  echo "   Deleting $schema..."
  psql -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS $schema CASCADE;" > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "   ✅ Deleted $schema"
    ((DELETED_COUNT++))
  else
    echo "   ❌ Failed to delete $schema"
  fi
done

echo ""
echo "🎉 Cleanup completed!"
echo "📊 Schemas deleted: $DELETED_COUNT/$SCHEMA_COUNT"

# Verify cleanup
REMAINING=$(psql -d "$DB_NAME" -t -c "
  SELECT COUNT(*) 
  FROM information_schema.schemata 
  WHERE schema_name LIKE 'carthorse_%'
" | xargs)

if [ "$REMAINING" -eq 0 ]; then
  echo "✅ All carthorse staging schemas have been successfully deleted."
else
  echo "⚠️  $REMAINING carthorse schemas still remain."
fi
