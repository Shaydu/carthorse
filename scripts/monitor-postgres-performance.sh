#!/bin/bash

# PostgreSQL Performance Monitoring Script
# Usage: ./monitor-postgres-performance.sh [duration_seconds]

DURATION=${1:-60}  # Default to 60 seconds
DB_NAME="trail_master_db"
DB_USER="carthorse"

echo "🔍 Monitoring PostgreSQL performance for $DURATION seconds..."
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Press Ctrl+C to stop early"
echo ""

# Function to show current active queries
show_active_queries() {
    echo "=== Active Queries $(date) ==="
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            pid,
            now() - pg_stat_activity.query_start AS duration,
            state,
            LEFT(query, 100) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
          AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY duration DESC;
    " 2>/dev/null || echo "❌ Could not connect to database"
    echo ""
}

# Function to show query statistics
show_query_stats() {
    echo "=== Query Statistics ==="
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            query,
            calls,
            total_time,
            mean_time,
            rows
        FROM pg_stat_statements 
        WHERE query LIKE '%ST_Intersects%' 
           OR query LIKE '%ST_Intersection%'
           OR query LIKE '%detect_trail_intersections%'
        ORDER BY total_time DESC
        LIMIT 10;
    " 2>/dev/null || echo "❌ pg_stat_statements not available"
    echo ""
}

# Function to show table statistics
show_table_stats() {
    echo "=== Table Statistics ==="
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            schemaname,
            tablename,
            n_tup_ins,
            n_tup_upd,
            n_tup_del,
            n_live_tup,
            n_dead_tup
        FROM pg_stat_user_tables 
        WHERE schemaname LIKE 'carthorse_%'
        ORDER BY n_live_tup DESC
        LIMIT 5;
    " 2>/dev/null || echo "❌ Could not get table statistics"
    echo ""
}

# Function to show index usage
show_index_usage() {
    echo "=== Index Usage ==="
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE schemaname LIKE 'carthorse_%'
          AND indexname LIKE '%geometry%'
        ORDER BY idx_scan DESC
        LIMIT 5;
    " 2>/dev/null || echo "❌ Could not get index usage"
    echo ""
}

# Function to show system resources
show_system_resources() {
    echo "=== System Resources ==="
    echo "CPU Usage: $(top -l 1 | grep "CPU usage" | awk '{print $3}')"
    echo "Memory Usage: $(top -l 1 | grep "PhysMem" | awk '{print $2}')"
    echo "PostgreSQL Processes: $(ps aux | grep postgres | grep -v grep | wc -l | tr -d ' ')"
    echo ""
}

# Main monitoring loop
for i in $(seq 1 $DURATION); do
    clear
    echo "🕐 Monitoring PostgreSQL Performance - $(date)"
    echo "⏱️  Elapsed: $i/$DURATION seconds"
    echo "================================================"
    
    show_active_queries
    show_query_stats
    show_table_stats
    show_index_usage
    show_system_resources
    
    if [ $i -lt $DURATION ]; then
        sleep 1
    fi
done

echo "✅ Monitoring complete!"
