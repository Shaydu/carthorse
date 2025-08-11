#!/bin/bash

# Cleanup script for old staging schemas
# This will reclaim significant disk space

set -e

echo "🧹 Cleaning up old staging schemas..."
echo "======================================"

# Check current disk usage
echo "📊 Current disk usage by staging schemas:"
psql -d trail_master_db -c "
SELECT 
    'Found ' || COUNT(*) || ' staging schemas using ' || 
    pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) || 
    ' of disk space' as summary
FROM pg_tables 
WHERE schemaname LIKE 'carthorse_%' OR schemaname LIKE 'staging_%';
"

echo ""
echo "📋 Sample of schemas to be dropped:"
psql -d trail_master_db -c "
SELECT 
    schemaname,
    COUNT(*) as table_count,
    pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) as size
FROM pg_tables 
WHERE schemaname LIKE 'carthorse_%' OR schemaname LIKE 'staging_%'
GROUP BY schemaname
ORDER BY schemaname
LIMIT 5;
"

echo ""
echo "⚠️  About to drop all staging schemas. This will reclaim ~2GB of disk space."
echo "Press Ctrl+C to cancel, or any key to continue..."
read -n 1 -s

echo ""
echo "🗑️  Dropping schemas..."

# Execute the cleanup
psql -d trail_master_db -f scripts/cleanup-staging-schemas.sql

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📊 Verification - remaining staging schemas:"
psql -d trail_master_db -c "
SELECT COUNT(*) as remaining_schemas
FROM information_schema.schemata 
WHERE schema_name LIKE 'carthorse_%' OR schema_name LIKE 'staging_%';
"

echo ""
echo "🎉 Disk space cleanup completed successfully!"
