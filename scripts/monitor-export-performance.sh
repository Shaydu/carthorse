#!/bin/bash

# Enhanced Export Process Performance Monitor
# Usage: ./scripts/monitor-export-performance.sh

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

DB_NAME="trail_master_db"
DB_USER="carthorse"

echo -e "${GREEN}🔍 Enhanced Export Process Performance Monitor${NC}"
echo -e "${BLUE}Database: $DB_NAME${NC}"
echo -e "${BLUE}User: $DB_USER${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Function to show critical memory issues
show_memory_issues() {
    echo -e "${RED}=== CRITICAL MEMORY ISSUES ===${NC}"
    
    # Check for memory allocation failures
    MEMORY_ERRORS=$(psql -U $DB_USER -d $DB_NAME -c "
        SELECT COUNT(*) as memory_errors
        FROM pg_stat_activity 
        WHERE query LIKE '%MemoryContextSizeFailure%'
        OR query LIKE '%invalid memory alloc request size%'
        OR query LIKE '%pgr_hawickcircuits%';
    " 2>/dev/null | tail -n 1 | xargs)
    
    if [ "$MEMORY_ERRORS" -gt 0 ]; then
        echo -e "${RED}🚨 CRITICAL: $MEMORY_ERRORS memory allocation errors detected!${NC}"
        echo -e "${RED}   This indicates the Hawick Circuits algorithm is consuming too much memory${NC}"
        echo -e "${YELLOW}   Recommendation: Disable Hawick Circuits or reduce graph size${NC}"
    else
        echo -e "${GREEN}✅ No memory allocation errors detected${NC}"
    fi
    
    # Check PostgreSQL memory settings
    echo -e "${CYAN}📊 PostgreSQL Memory Settings:${NC}"
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            name,
            setting,
            unit,
            context
        FROM pg_settings 
        WHERE name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size')
        ORDER BY name;
    " 2>/dev/null || echo "❌ Could not get memory settings"
    echo ""
}

# Function to show current active queries with memory focus
show_active_queries() {
    echo -e "${PURPLE}=== Active Queries $(date) ===${NC}"
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            pid,
            usename,
            now() - pg_stat_activity.query_start AS duration,
            state,
            CASE 
                WHEN query LIKE '%pgr_hawickcircuits%' THEN '🚨 HAWICK CIRCUITS'
                WHEN query LIKE '%pgr_%' THEN '🗺️ PGROUTING'
                WHEN query LIKE '%ST_%' THEN '📍 POSTGIS'
                ELSE '📝 REGULAR'
            END as query_type,
            LEFT(query, 60) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
          AND query NOT LIKE '%pg_stat_activity%'
          AND query NOT LIKE '%monitor%'
        ORDER BY duration DESC
        LIMIT 8;
    " 2>/dev/null || echo "❌ Could not connect to database"
    echo ""
}

# Function to show slow queries with memory analysis
show_slow_queries() {
    echo -e "${YELLOW}=== Slow Queries (>5 seconds) ===${NC}"
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            pid,
            usename,
            now() - query_start as duration,
            CASE 
                WHEN query LIKE '%pgr_hawickcircuits%' THEN '🚨 HAWICK CIRCUITS'
                WHEN query LIKE '%pgr_%' THEN '🗺️ PGROUTING'
                WHEN query LIKE '%ST_%' THEN '📍 POSTGIS'
                ELSE '📝 REGULAR'
            END as query_type,
            LEFT(query, 50) as query_preview
        FROM pg_stat_activity 
        WHERE state = 'active' 
        AND now() - query_start > interval '5 seconds'
        AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY query_start ASC;
    " 2>/dev/null || echo "  No slow queries found"
    echo ""
}

# Function to show routing graph statistics
show_routing_stats() {
    echo -e "${BLUE}=== Routing Graph Statistics ===${NC}"
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            schemaname,
            tablename,
            n_live_tup as row_count,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_stat_user_tables 
        WHERE schemaname LIKE 'carthorse_%'
          AND tablename IN ('routing_edges', 'routing_nodes', 'trails')
        ORDER BY schemaname DESC, tablename
        LIMIT 10;
    " 2>/dev/null || echo "❌ Could not get routing stats"
    echo ""
}

# Function to show index usage for routing tables
show_index_usage() {
    echo -e "${CYAN}=== Index Usage for Routing Tables ===${NC}"
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch,
            pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        FROM pg_stat_user_indexes 
        WHERE schemaname LIKE 'carthorse_%'
          AND tablename IN ('routing_edges', 'routing_nodes', 'trails')
        ORDER BY idx_scan DESC
        LIMIT 8;
    " 2>/dev/null || echo "❌ Could not get index usage"
    echo ""
}

# Function to show system resources with memory focus
show_system_resources() {
    echo -e "${GREEN}=== System Resources ===${NC}"
    
    # Get PostgreSQL memory usage
    PG_MEMORY=$(ps aux | grep postgres | grep -v grep | awk '{sum += $6} END {print sum/1024 " MB"}')
    echo -e "${BLUE}PostgreSQL Memory Usage: $PG_MEMORY${NC}"
    
    # Get system memory
    TOTAL_MEM=$(sysctl -n hw.memsize | awk '{print $0/1024/1024/1024 " GB"}')
    FREE_MEM=$(vm_stat | grep "Pages free" | awk '{print $3*4096/1024/1024 " MB"}')
    echo -e "${BLUE}System Memory: $FREE_MEM free of $TOTAL_MEM${NC}"
    
    # Get CPU usage
    CPU_USAGE=$(top -l 1 | grep "CPU usage" | awk '{print $3}')
    echo -e "${BLUE}CPU Usage: $CPU_USAGE${NC}"
    
    # Count processes
    PG_PROCESSES=$(ps aux | grep postgres | grep -v grep | wc -l | tr -d ' ')
    NODE_PROCESSES=$(ps aux | grep node | grep -v grep | wc -l | tr -d ' ')
    echo -e "${BLUE}PostgreSQL Processes: $PG_PROCESSES${NC}"
    echo -e "${BLUE}Node.js Processes: $NODE_PROCESSES${NC}"
    echo ""
}

# Function to show optimization recommendations
show_optimization_recommendations() {
    echo -e "${YELLOW}=== Performance Optimization Recommendations ===${NC}"
    
    # Check if Hawick Circuits are being used
    HAWICK_ACTIVE=$(psql -U $DB_USER -d $DB_NAME -c "
        SELECT COUNT(*) 
        FROM pg_stat_activity 
        WHERE query LIKE '%pgr_hawickcircuits%'
        AND state = 'active';
    " 2>/dev/null | tail -n 1 | xargs)
    
    if [ "$HAWICK_ACTIVE" -gt 0 ]; then
        echo -e "${RED}🚨 IMMEDIATE ACTION REQUIRED:${NC}"
        echo -e "${RED}   - Hawick Circuits are currently running and causing memory issues${NC}"
        echo -e "${YELLOW}   - Consider terminating these queries or reducing graph size${NC}"
        echo -e "${YELLOW}   - Alternative: Use KSP or Dijkstra algorithms instead${NC}"
    fi
    
    # Check for missing indexes
    MISSING_INDEXES=$(psql -U $DB_USER -d $DB_NAME -c "
        SELECT COUNT(*) 
        FROM pg_tables t
        WHERE schemaname LIKE 'carthorse_%'
        AND tablename IN ('routing_edges', 'routing_nodes')
        AND NOT EXISTS (
            SELECT 1 FROM pg_indexes i 
            WHERE i.schemaname = t.schemaname 
            AND i.tablename = t.tablename
        );
    " 2>/dev/null | tail -n 1 | xargs)
    
    if [ "$MISSING_INDEXES" -gt 0 ]; then
        echo -e "${YELLOW}📊 Missing Indexes: $MISSING_INDEXES routing tables without indexes${NC}"
        echo -e "${YELLOW}   Recommendation: Add spatial indexes to routing tables${NC}"
    fi
    
    # Check for large tables
    LARGE_TABLES=$(psql -U $DB_USER -d $DB_NAME -c "
        SELECT COUNT(*) 
        FROM pg_stat_user_tables 
        WHERE schemaname LIKE 'carthorse_%'
        AND n_live_tup > 10000;
    " 2>/dev/null | tail -n 1 | xargs)
    
    if [ "$LARGE_TABLES" -gt 0 ]; then
        echo -e "${YELLOW}📏 Large Tables: $LARGE_TABLES tables with >10k rows${NC}"
        echo -e "${YELLOW}   Recommendation: Consider partitioning or archiving old data${NC}"
    fi
    
    echo ""
}

# Function to show recent staging schemas
show_recent_schemas() {
    echo -e "${PURPLE}=== Recent Staging Schemas ===${NC}"
    psql -U $DB_USER -d $DB_NAME -c "
        SELECT 
            schemaname,
            COUNT(*) as table_count,
            SUM(n_live_tup) as total_rows,
            pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) as total_size
        FROM pg_tables t
        LEFT JOIN pg_stat_user_tables s ON t.schemaname = s.schemaname AND t.tablename = s.relname
        WHERE t.schemaname LIKE 'carthorse_%'
        GROUP BY t.schemaname
        ORDER BY t.schemaname DESC
        LIMIT 5;
    " 2>/dev/null || echo "❌ Could not get schema info"
    echo ""
}

# Main monitoring loop
while true; do
    clear
    echo -e "${GREEN}🕐 Enhanced Export Performance Monitor - $(date)${NC}"
    echo -e "${GREEN}================================================${NC}"
    
    show_memory_issues
    show_active_queries
    show_slow_queries
    show_routing_stats
    show_index_usage
    show_system_resources
    show_optimization_recommendations
    show_recent_schemas
    
    echo -e "${YELLOW}Press Ctrl+C to stop monitoring${NC}"
    sleep 3
done
