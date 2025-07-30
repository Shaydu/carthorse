#!/bin/bash

# Real-time Query Hang Monitor for Carthorse
# Monitors for hanging queries during test runs

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
MONITOR_INTERVAL=${1:-1}  # Default 1 second for real-time monitoring
LOG_FILE="/tmp/query_hang_monitor_$(date +%Y%m%d_%H%M%S).log"
SESSION_START=$(date +%s)

# Function to log messages
log_message() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $message" | tee -a "$LOG_FILE"
}

# Function to check for hanging queries
check_hanging_queries() {
    local hanging_count=$(psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_stat_activity 
        WHERE state = 'active' 
        AND now() - query_start > interval '5 seconds'
        AND query NOT LIKE '%pg_stat_activity%';
    " 2>/dev/null || echo "0")
    
    if [ "$hanging_count" -gt 0 ]; then
        echo -e "${RED}🚨 HANGING QUERIES DETECTED: $hanging_count${NC}"
        psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
            SELECT 
                pid,
                usename,
                application_name,
                state,
                query_start,
                now() - query_start as duration,
                LEFT(query, 120) as query_preview
            FROM pg_stat_activity 
            WHERE state = 'active' 
            AND now() - query_start > interval '5 seconds'
            AND query NOT LIKE '%pg_stat_activity%'
            ORDER BY query_start ASC;
        " 2>/dev/null
    fi
}

# Function to check for blocked queries
check_blocked_queries() {
    local blocked_count=$(psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_stat_activity 
        WHERE state = 'active' 
        AND wait_event_type IS NOT NULL;
    " 2>/dev/null || echo "0")
    
    if [ "$blocked_count" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  BLOCKED QUERIES DETECTED: $blocked_count${NC}"
        psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -c "
            SELECT 
                pid,
                usename,
                application_name,
                state,
                wait_event_type,
                wait_event,
                query_start,
                now() - query_start as duration,
                LEFT(query, 80) as query_preview
            FROM pg_stat_activity 
            WHERE state = 'active' 
            AND wait_event_type IS NOT NULL
            ORDER BY query_start ASC;
        " 2>/dev/null
    fi
}

# Function to check for locks
check_locks() {
    local lock_count=$(psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_locks l
        JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE l.pid != pg_backend_pid()
        AND l.mode NOT IN ('AccessShareLock', 'RowShareLock');
    " 2>/dev/null || echo "0")
    
    if [ "$lock_count" -gt 0 ]; then
        echo -e "${PURPLE}🔒 LOCKS DETECTED: $lock_count${NC}"
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
        " 2>/dev/null
    fi
}

# Function to show all active queries
show_active_queries() {
    local active_count=$(psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_stat_activity 
        WHERE state = 'active' 
        AND query NOT LIKE '%pg_stat_activity%';
    " 2>/dev/null || echo "0")
    
    if [ "$active_count" -gt 0 ]; then
        echo -e "${CYAN}📊 Active Queries: $active_count${NC}"
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
            AND query NOT LIKE '%pg_stat_activity%'
            ORDER BY query_start ASC;
        " 2>/dev/null
    else
        echo -e "${GREEN}✅ No active queries${NC}"
    fi
}

# Function to show PostGIS-specific queries
show_postgis_queries() {
    local postgis_count=$(psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_stat_activity 
        WHERE state = 'active' 
        AND (query LIKE '%ST_%' OR query LIKE '%postgis%' OR query LIKE '%geometry%')
        AND query NOT LIKE '%pg_stat_activity%';
    " 2>/dev/null || echo "0")
    
    if [ "$postgis_count" -gt 0 ]; then
        echo -e "${BLUE}🗺️ PostGIS Queries: $postgis_count${NC}"
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
            AND (query LIKE '%ST_%' OR query LIKE '%postgis%' OR query LIKE '%geometry%')
            AND query NOT LIKE '%pg_stat_activity%'
            ORDER BY query_start ASC;
        " 2>/dev/null
    fi
}

# Function to show system stats
show_system_stats() {
    echo -e "${GREEN}💻 System Stats:${NC}"
    echo "  CPU: $(top -l 1 | grep "CPU usage" | awk '{print $3}')"
    echo "  Memory: $(top -l 1 | grep "PhysMem" | awk '{print $2}')"
    echo "  Disk: $(df -h / | tail -1 | awk '{print $5}')"
}

# Main monitoring loop
echo -e "${GREEN}🚀 Starting Query Hang Monitor...${NC}"
echo -e "${BLUE}📊 Database: $DB_NAME${NC}"
echo -e "${BLUE}👤 User: $PGUSER${NC}"
echo -e "${BLUE}🏠 Host: $PGHOST:$PGPORT${NC}"
echo -e "${BLUE}⏱️  Interval: ${MONITOR_INTERVAL}s${NC}"
echo -e "${BLUE}📝 Log: $LOG_FILE${NC}"
echo ""

# Main monitoring loop
while true; do
    echo ""
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${PURPLE}🔍 Query Monitor - $(date)${NC}"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Check for issues
    check_hanging_queries
    check_blocked_queries
    check_locks
    
    # Show current state
    show_active_queries
    show_postgis_queries
    
    # System stats
    show_system_stats
    
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
echo -e "${GREEN}✅ Query hang monitoring complete${NC}" 