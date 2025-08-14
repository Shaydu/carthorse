#!/bin/bash

# Quick check of trail_master_db.public.trails table current state

DB_NAME="trail_master_db"
TABLE_NAME="public.trails"

echo "=== Current State of $DB_NAME.$TABLE_NAME ==="
echo "Timestamp: $(date)"
echo ""

# Row count
echo "Row count:"
psql -d "$DB_NAME" -c "SELECT COUNT(*) as total_rows FROM $TABLE_NAME;"

echo ""

# Table size breakdown
echo "Table size breakdown:"
psql -d "$DB_NAME" -c "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'trails';"

echo ""

# Recent activity (last 10 rows by ID if available)
echo "Most recent rows (if ID column exists):"
psql -d "$DB_NAME" -c "
SELECT id, name, created_at 
FROM $TABLE_NAME 
ORDER BY id DESC 
LIMIT 10;" 2>/dev/null || echo "Could not retrieve recent rows (ID column may not exist)"

echo ""

# Table statistics
echo "Table statistics:"
psql -d "$DB_NAME" -c "
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_rows,
    n_dead_tup as dead_rows,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables 
WHERE schemaname = 'public' AND tablename = 'trails';"
