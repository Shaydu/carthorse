#!/bin/bash

# Test Performance Monitor for Carthorse
# Focused monitoring during test runs to identify PostGIS bottlenecks

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
MONITOR_INTERVAL=${1:-2}  # Default 2 seconds for test monitoring
LOG_FILE="/tmp/test_performance_$(date +%Y%m%d_%H%M%S).log"
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

# Function to monitor test-specific metrics
monitor_test_metrics() {
    echo -e "${CYAN}🧪 Test-Specific Metrics:${NC}"
    
    # Count trails in test database
    trail_count=$(get_pg_stats "SELECT COUNT(*) FROM trails;")
    echo "  📊 Total trails: $trail_count"
    
    # Count staging schemas
    staging_count=$(get_pg_stats "SELECT COUNT(*) FROM pg_namespace WHERE nspname LIKE 'staging_%';")
    echo "  🏗️  Staging schemas: $staging_count"
    
    # Count spatial indexes
    spatial_index_count=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_indexes 
        WHERE indexname LIKE '%gist%' OR indexname LIKE '%spatial%';
    ")
    echo "  🗺️  Spatial indexes: $spatial_index_count"
    
    # Check for 3D geometries
    three_d_count=$(get_pg_stats "SELECT COUNT(*) FROM trails WHERE ST_NDims(geometry) = 3;")
    echo "  📐 3D geometries: $three_d_count"
    
    # Check for missing elevation data
    missing_elevation=$(get_pg_stats "
        SELECT COUNT(*) FROM trails 
        WHERE elevation_gain IS NULL OR elevation_loss IS NULL;
    ")
    echo "  ⚠️  Missing elevation: $missing_elevation"
}

# Function to monitor active queries during tests
monitor_test_queries() {
    echo -e "${PURPLE}🔍 Active Test Queries:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            pid,
            usename,
            application_name,
            state,
            now() - query_start as duration,
            LEFT(query, 80) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
        AND query NOT LIKE '%pg_stat_activity%'
        AND query NOT LIKE '%monitor%'
        ORDER BY query_start ASC;
    " 2>/dev/null || echo "  No active queries found"
}

# Function to monitor slow PostGIS operations
monitor_slow_postgis() {
    echo -e "${YELLOW}🐌 Slow PostGIS Operations (>500ms):${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            pid,
            usename,
            application_name,
            now() - query_start as duration,
            LEFT(query, 60) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
        AND now() - query_start > interval '500 milliseconds'
        AND (query LIKE '%ST_%' OR query LIKE '%postgis%')
        ORDER BY query_start ASC;
    " 2>/dev/null || echo "  No slow PostGIS operations found"
}

# Function to monitor spatial index usage
monitor_spatial_index_usage() {
    echo -e "${GREEN}🗺️ Spatial Index Usage:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE indexname LIKE '%gist%' OR indexname LIKE '%spatial%'
        ORDER BY idx_scan DESC
        LIMIT 5;
    " 2>/dev/null || echo "  No spatial index usage data"
}

# Function to monitor cache performance
monitor_cache_performance() {
    echo -e "${BLUE}💾 Cache Hit Ratios:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            schemaname,
            tablename,
            ROUND(100.0 * heap_blks_hit / (heap_blks_hit + heap_blks_read), 1) as cache_hit_ratio
        FROM pg_statio_user_tables 
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        AND heap_blks_hit + heap_blks_read > 0
        ORDER BY cache_hit_ratio ASC
        LIMIT 5;
    " 2>/dev/null || echo "  No cache data available"
}

# Function to monitor PostGIS function calls
monitor_postgis_functions() {
    echo -e "${CYAN}🔧 PostGIS Function Calls:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            funcname,
            calls,
            total_time,
            mean_time
        FROM pg_stat_user_functions 
        WHERE funcname LIKE '%st_%' OR funcname LIKE '%postgis%'
        ORDER BY total_time DESC
        LIMIT 5;
    " 2>/dev/null || echo "  No PostGIS function statistics"
}

# Function to monitor locks during tests
monitor_test_locks() {
    echo -e "${RED}🔒 Test Locks:${NC}"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            l.pid,
            l.mode,
            l.granted,
            a.usename,
            a.state,
            now() - a.query_start as duration
        FROM pg_locks l
        JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE l.pid != pg_backend_pid()
        AND l.mode NOT IN ('AccessShareLock', 'RowShareLock')
        ORDER BY a.query_start ASC;
    " 2>/dev/null || echo "  No blocking locks found"
}

# Function to get system resources
get_system_resources() {
    echo -e "${BLUE}💻 System Resources:${NC}"
    
    # CPU usage
    cpu_usage=$(top -l 1 | grep "CPU usage" | awk '{print $3}' | sed 's/%//')
    echo "  CPU: ${cpu_usage}%"
    
    # Memory usage
    memory_info=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    total_memory=$(sysctl -n hw.memsize)
    free_memory=$((memory_info * 4096))
    used_memory=$((total_memory - free_memory))
    memory_percent=$((used_memory * 100 / total_memory))
    echo "  Memory: ${memory_percent}%"
    
    # Disk space
    disk_usage=$(df . | tail -1 | awk '{print $5}' | sed 's/%//')
    echo "  Disk: ${disk_usage}%"
}

# Function to show test-specific recommendations
show_test_recommendations() {
    echo -e "${YELLOW}💡 Test Performance Tips:${NC}"
    
    # Check for missing spatial indexes
    missing_indexes=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_tables t
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        AND tablename LIKE '%trail%'
        AND NOT EXISTS (
            SELECT 1 FROM pg_indexes i 
            WHERE i.tablename = t.tablename 
            AND i.indexdef LIKE '%USING gist%'
        );
    ")
    
    if [ "$missing_indexes" -gt 0 ]; then
        echo "  ⚠️  Missing spatial indexes on $missing_indexes tables"
    fi
    
    # Check for large tables
    large_tables=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_tables t
        WHERE schemaname IN ('public', 'staging_boulder_%', 'staging_seattle_%')
        AND pg_total_relation_size(schemaname||'.'||tablename) > 500000000;
    ")
    
    if [ "$large_tables" -gt 0 ]; then
        echo "  ⚠️  Found $large_tables large tables (>500MB)"
    fi
    
    # Check for old staging schemas
    old_schemas=$(get_pg_stats "
        SELECT COUNT(*) FROM pg_namespace 
        WHERE nspname LIKE 'staging_%' 
        AND nspname < 'staging_$(date -d '30 minutes ago' +%Y%m%d)';
    ")
    
    if [ "$old_schemas" -gt 0 ]; then
        echo "  ⚠️  Found $old_schemas old staging schemas"
    fi
    
    # Check PostgreSQL settings for tests
    echo "  📊 Test DB Settings:"
    psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            name as setting,
            setting as value
        FROM pg_settings 
        WHERE name IN ('work_mem', 'maintenance_work_mem', 'random_page_cost')
        ORDER BY name;
    " 2>/dev/null || echo "     Could not get settings"
}

# Main monitoring loop
echo -e "${GREEN}🚀 Starting Test Performance Monitor...${NC}"
echo -e "${BLUE}📊 Database: $DB_NAME${NC}"
echo -e "${BLUE}👤 User: $PGUSER${NC}"
echo -e "${BLUE}⏱️  Interval: ${MONITOR_INTERVAL}s${NC}"
echo -e "${BLUE}📝 Log: $LOG_FILE${NC}"
echo ""

# Initial test metrics
monitor_test_metrics

# Main monitoring loop
while true; do
    echo ""
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${PURPLE}🧪 Test Monitor - $(date)${NC}"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # System resources
    get_system_resources
    
    # Test-specific monitoring
    monitor_test_queries
    monitor_slow_postgis
    monitor_spatial_index_usage
    monitor_cache_performance
    monitor_postgis_functions
    monitor_test_locks
    
    # Recommendations
    show_test_recommendations
    
    # Session duration
    session_duration=$(( $(date +%s) - SESSION_START ))
    echo -e "${BLUE}⏱️  Session duration: ${session_duration}s${NC}"
    
    log_message "Test monitor cycle completed - Session duration: ${session_duration}s"
    
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop monitoring...${NC}"
    sleep "$MONITOR_INTERVAL"
done

# Final summary
echo ""
echo -e "${GREEN}📊 Test Monitoring Summary:${NC}"
echo -e "${BLUE}   Start time: $(date -r $SESSION_START)${NC}"
echo -e "${BLUE}   End time: $(date)${NC}"
echo -e "${BLUE}   Total duration: ${session_duration}s${NC}"
echo -e "${BLUE}   Log file: $LOG_FILE${NC}"
echo ""
echo -e "${GREEN}✅ Test performance monitoring complete${NC}" 