#!/bin/bash

# PostGIS Performance Monitor for Carthorse
# This script monitors PostGIS performance during test runs to identify bottlenecks

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
DB_NAME=${PGDATABASE:-trail_master_db_test}
PGUSER=${PGUSER:-tester}
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}
MONITOR_INTERVAL=${1:-5}  # Default 5 seconds
LOG_FILE="/tmp/postgis_monitor_$(date +%Y%m%d_%H%M%S).log"
SESSION_START=$(date +%s)

# Function to log messages
log_message() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $message" | tee -a "$LOG_FILE"
}

# Function to get PostgreSQL stats
get_pg_stats() {
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo "0"
}

# Function to get PostGIS version and extensions
get_postgis_info() {
    echo -e "${CYAN}🔍 PostGIS Information:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            name as extension,
            default_version as version,
            installed_version
        FROM pg_available_extensions 
        WHERE name IN ('postgis', 'postgis_topology', 'postgis_raster')
        ORDER BY name;
    " 2>/dev/null || echo "  Could not connect to PostgreSQL"
}

# Function to monitor active queries
monitor_active_queries() {
    echo -e "${PURPLE}📊 Active Queries:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            pid,
            usename,
            application_name,
            client_addr,
            state,
            query_start,
            now() - query_start as duration,
            LEFT(query, 100) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
        AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY query_start ASC;
    " 2>/dev/null || echo "  No active queries found"
}

# Function to monitor slow queries
monitor_slow_queries() {
    echo -e "${YELLOW}🐌 Slow Queries (>1 second):${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            pid,
            usename,
            application_name,
            state,
            query_start,
            now() - query_start as duration,
            LEFT(query, 100) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
        AND now() - query_start > interval '1 second'
        AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY query_start ASC;
    " 2>/dev/null || echo "  No slow queries found"
}

# Function to monitor table sizes and indexes
monitor_table_sizes() {
    echo -e "${BLUE}📏 Table Sizes and Indexes:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
            pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
            (SELECT COUNT(*) FROM pg_indexes WHERE tablename = t.tablename AND schemaname = t.schemaname) as index_count
        FROM pg_tables t
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 10;
    " 2>/dev/null || echo "  Could not get table sizes"
}

# Function to monitor spatial indexes
monitor_spatial_indexes() {
    echo -e "${GREEN}🗺️ Spatial Index Usage:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch,
            pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        FROM pg_stat_user_indexes 
        WHERE indexname LIKE '%gist%' OR indexname LIKE '%spatial%'
        ORDER BY idx_scan DESC
        LIMIT 10;
    " 2>/dev/null || echo "  No spatial indexes found"
}

# Function to monitor cache hit ratios
monitor_cache_performance() {
    echo -e "${CYAN}💾 Cache Performance:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            schemaname,
            tablename,
            heap_blks_read,
            heap_blks_hit,
            CASE 
                WHEN heap_blks_hit + heap_blks_read = 0 THEN 0
                ELSE ROUND(100.0 * heap_blks_hit / (heap_blks_hit + heap_blks_read), 2)
            END as cache_hit_ratio
        FROM pg_statio_user_tables 
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        ORDER BY cache_hit_ratio ASC
        LIMIT 10;
    " 2>/dev/null || echo "  Could not get cache statistics"
}

# Function to monitor PostGIS function performance
monitor_postgis_functions() {
    echo -e "${PURPLE}🔧 PostGIS Function Performance:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            funcname,
            calls,
            total_time,
            mean_time,
            stddev_time
        FROM pg_stat_user_functions 
        WHERE funcname LIKE '%st_%' OR funcname LIKE '%postgis%'
        ORDER BY total_time DESC
        LIMIT 10;
    " 2>/dev/null || echo "  No PostGIS function statistics available"
}

# Function to monitor locks
monitor_locks() {
    echo -e "${RED}🔒 Database Locks:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            l.pid,
            l.mode,
            l.granted,
            a.usename,
            a.application_name,
            a.state,
            a.query_start,
            now() - a.query_start as duration
        FROM pg_locks l
        JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE l.pid != pg_backend_pid()
        AND l.mode NOT IN ('AccessShareLock', 'RowShareLock')
        ORDER BY a.query_start ASC;
    " 2>/dev/null || echo "  No blocking locks found"
}

# Function to monitor staging schemas
monitor_staging_schemas() {
    echo -e "${YELLOW}🏗️ Staging Schemas:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            nspname as schema,
            COUNT(*) as table_count,
            pg_size_pretty(COALESCE(SUM(pg_total_relation_size(c.oid)), 0)) as total_size
        FROM pg_namespace n
        LEFT JOIN pg_class c ON c.relnamespace = n.oid
        WHERE nspname LIKE 'staging_%'
        GROUP BY nspname
        ORDER BY COALESCE(SUM(pg_total_relation_size(c.oid)), 0) DESC;
    " 2>/dev/null || echo "  No staging schemas found"
}

# Function to get system resource usage
get_system_stats() {
    echo -e "${BLUE}💻 System Resources:${NC}"
    
    # CPU usage
    cpu_usage=$(top -l 1 | grep "CPU usage" | awk '{print $3}' | sed 's/%//')
    echo "  CPU Usage: ${cpu_usage}%"
    
    # Memory usage
    memory_info=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    total_memory=$(sysctl -n hw.memsize)
    free_memory=$((memory_info * 4096))
    used_memory=$((total_memory - free_memory))
    memory_percent=$((used_memory * 100 / total_memory))
    echo "  Memory Usage: ${memory_percent}%"
    
    # Disk I/O (if iostat available)
    if command -v iostat &> /dev/null; then
        echo "  Disk I/O: $(iostat -d 1 1 | tail -1 | awk '{print $2, $3}')"
    fi
}

# Function to monitor specific PostGIS operations
monitor_postgis_operations() {
    echo -e "${GREEN}🗺️ PostGIS Operation Statistics:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            'ST_Intersects calls' as operation,
            COUNT(*) as count
        FROM pg_stat_user_functions 
        WHERE funcname = 'st_intersects'
        UNION ALL
        SELECT 
            'ST_AsGeoJSON calls' as operation,
            COUNT(*) as count
        FROM pg_stat_user_functions 
        WHERE funcname = 'st_asgeojson'
        UNION ALL
        SELECT 
            'ST_Length calls' as operation,
            COUNT(*) as count
        FROM pg_stat_user_functions 
        WHERE funcname = 'st_length'
        UNION ALL
        SELECT 
            'ST_Simplify calls' as operation,
            COUNT(*) as count
        FROM pg_stat_user_functions 
        WHERE funcname = 'st_simplify';
    " 2>/dev/null || echo "  Could not get PostGIS operation statistics"
}

# Function to show performance recommendations
show_recommendations() {
    echo -e "${CYAN}💡 Performance Recommendations:${NC}"
    
    # Check for missing spatial indexes
    missing_indexes=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_tables t
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        AND tablename LIKE '%trail%'
        AND NOT EXISTS (
            SELECT 1 FROM pg_indexes i 
            WHERE i.tablename = t.tablename 
            AND i.indexname LIKE '%gist%'
        );
    ")
    
    if [ "$missing_indexes" -gt 0 ]; then
        echo "  ⚠️  Missing spatial indexes on $missing_indexes tables"
        echo "     Consider adding: CREATE INDEX ON table USING GIST (geometry);"
    fi
    
    # Check for large tables without clustering
    large_tables=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_tables t
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        AND pg_total_relation_size(schemaname||'.'||tablename) > 1000000000;
    ")
    
    if [ "$large_tables" -gt 0 ]; then
        echo "  ⚠️  Found $large_tables large tables (>1GB)"
        echo "     Consider: CLUSTER table USING index_name;"
    fi
    
    # Check for old staging schemas
    old_schemas=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_namespace 
        WHERE nspname LIKE 'staging_%' 
        AND nspname < 'staging_$(date -d '1 hour ago' +%Y%m%d)';
    ")
    
    if [ "$old_schemas" -gt 0 ]; then
        echo "  ⚠️  Found $old_schemas old staging schemas"
        echo "     Consider cleanup: DROP SCHEMA IF EXISTS old_schema CASCADE;"
    fi
    
    # Check PostgreSQL settings
    echo "  📊 PostgreSQL Settings:"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            name as setting,
            setting as value,
            unit
        FROM pg_settings 
        WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem', 'random_page_cost')
        ORDER BY name;
    " 2>/dev/null || echo "     Could not get PostgreSQL settings"
}

# Main monitoring loop
echo -e "${GREEN}🚀 Starting PostGIS Performance Monitor...${NC}"
echo -e "${BLUE}📊 Database: $DB_NAME${NC}"
echo -e "${BLUE}👤 User: $PGUSER${NC}"
echo -e "${BLUE}🏠 Host: $PGHOST:$PGPORT${NC}"
echo -e "${BLUE}⏱️  Interval: ${MONITOR_INTERVAL}s${NC}"
echo -e "${BLUE}📝 Log: $LOG_FILE${NC}"
echo ""

# Initial PostGIS info
get_postgis_info

# Main monitoring loop
while true; do
    echo ""
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${PURPLE}📊 PostGIS Monitor - $(date)${NC}"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # System stats
    get_system_stats
    
    # Database monitoring
    monitor_active_queries
    monitor_slow_queries
    monitor_locks
    monitor_table_sizes
    monitor_spatial_indexes
    monitor_cache_performance
    monitor_postgis_functions
    monitor_postgis_operations
    monitor_staging_schemas
    
    # Recommendations
    show_recommendations
    
    # Session duration
    session_duration=$(( $(date +%s) - SESSION_START ))
    echo -e "${BLUE}⏱️  Session duration: ${session_duration}s${NC}"
    
    log_message "Monitor cycle completed - Session duration: ${session_duration}s"
    
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop monitoring...${NC}"
    sleep "$MONITOR_INTERVAL"
done

# Final summary
echo ""
echo -e "${GREEN}📊 Monitoring Summary:${NC}"
echo -e "${BLUE}   Start time: $(date -r $SESSION_START)${NC}"
echo -e "${BLUE}   End time: $(date)${NC}"
echo -e "${BLUE}   Total duration: ${session_duration}s${NC}"
echo -e "${BLUE}   Log file: $LOG_FILE${NC}"
echo ""
echo -e "${GREEN}✅ PostGIS performance monitoring complete${NC}" 