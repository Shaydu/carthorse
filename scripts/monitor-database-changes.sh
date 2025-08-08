#!/bin/bash

# Database Change Monitor Script
# Monitors staging schema creation, table changes, and data modifications

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME=${PGDATABASE:-trail_master_db_test}
DB_HOST=${PGHOST:-localhost}
DB_PORT=${PGPORT:-5432}
DB_USER=${PGUSER:-tester}

echo -e "${BLUE}🔍 Database Change Monitor${NC}"
echo "================================"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo ""

# Function to get current timestamp
get_timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# Function to monitor staging schemas
monitor_staging_schemas() {
    echo -e "${YELLOW}📋 Monitoring Staging Schemas...${NC}"
    
    # Get current staging schemas
    STAGING_SCHEMAS=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%' OR schema_name LIKE 'carthorse_%'
        ORDER BY schema_name;
    " 2>/dev/null | tr -d ' ')
    
    if [ -z "$STAGING_SCHEMAS" ]; then
        echo -e "${GREEN}✅ No staging schemas found${NC}"
    else
        echo -e "${BLUE}📊 Found staging schemas:${NC}"
        echo "$STAGING_SCHEMAS" | while read schema; do
            if [ ! -z "$schema" ]; then
                echo -e "  - ${GREEN}$schema${NC}"
            fi
        done
    fi
}

# Function to monitor table changes in a schema
monitor_schema_tables() {
    local schema=$1
    echo -e "${YELLOW}📊 Monitoring tables in schema: $schema${NC}"
    
    # Get table counts
    TABLE_COUNTS=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
        SELECT 
            table_name,
            (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = t.table_name) as exists,
            CASE 
                WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '$schema' AND table_name = t.table_name)
                THEN (SELECT COUNT(*) FROM $schema.\"${t.table_name}\")
                ELSE 0
            END as row_count
        FROM (
            SELECT 'trails' as table_name
            UNION SELECT 'routing_edges'
            UNION SELECT 'routing_nodes'
            UNION SELECT 'split_trails'
            UNION SELECT 'trail_hashes'
            UNION SELECT 'intersection_points'
            UNION SELECT 'ways_noded'
            UNION SELECT 'ways_noded_vertices_pgr'
        ) t
        ORDER BY table_name;
    " 2>/dev/null)
    
    if [ ! -z "$TABLE_COUNTS" ]; then
        echo "$TABLE_COUNTS" | while read line; do
            if [ ! -z "$line" ]; then
                echo "  $line"
            fi
        done
    fi
}

# Function to monitor recent activity
monitor_recent_activity() {
    echo -e "${YELLOW}🔄 Monitoring Recent Activity...${NC}"
    
    # Check for recent schema creations
    RECENT_SCHEMAS=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
        SELECT 
            schema_name,
            to_timestamp(CAST(SPLIT_PART(schema_name, '_', 3) AS BIGINT) / 1000) as created_at
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%' 
        AND to_timestamp(CAST(SPLIT_PART(schema_name, '_', 3) AS BIGINT) / 1000) > NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC;
    " 2>/dev/null)
    
    if [ ! -z "$RECENT_SCHEMAS" ]; then
        echo -e "${BLUE}📈 Recent schema creations (last hour):${NC}"
        echo "$RECENT_SCHEMAS" | while read line; do
            if [ ! -z "$line" ]; then
                echo "  $line"
            fi
        done
    else
        echo -e "${GREEN}✅ No recent schema creations${NC}"
    fi
}

# Function to monitor database size
monitor_database_size() {
    echo -e "${YELLOW}💾 Monitoring Database Size...${NC}"
    
    DB_SIZE=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
        SELECT 
            pg_size_pretty(pg_database_size('$DB_NAME')) as database_size,
            pg_size_pretty(pg_total_relation_size('information_schema.schemata')) as schemas_size;
    " 2>/dev/null)
    
    if [ ! -z "$DB_SIZE" ]; then
        echo -e "${BLUE}📊 Database size:${NC}"
        echo "$DB_SIZE" | while read line; do
            if [ ! -z "$line" ]; then
                echo "  $line"
            fi
        done
    fi
}

# Main monitoring loop
monitor_loop() {
    local interval=${1:-30}  # Default 30 seconds
    
    echo -e "${BLUE}🔄 Starting continuous monitoring (interval: ${interval}s)${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop monitoring${NC}"
    echo ""
    
    while true; do
        echo -e "${BLUE}================================${NC}"
        echo -e "${BLUE}$(get_timestamp) - Database Status${NC}"
        echo -e "${BLUE}================================${NC}"
        
        monitor_staging_schemas
        echo ""
        
        monitor_recent_activity
        echo ""
        
        monitor_database_size
        echo ""
        
        # Monitor each staging schema if they exist
        STAGING_SCHEMAS=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'staging_%' OR schema_name LIKE 'carthorse_%'
            ORDER BY schema_name;
        " 2>/dev/null | tr -d ' ')
        
        if [ ! -z "$STAGING_SCHEMAS" ]; then
            echo "$STAGING_SCHEMAS" | while read schema; do
                if [ ! -z "$schema" ]; then
                    monitor_schema_tables "$schema"
                    echo ""
                fi
            done
        fi
        
        echo -e "${YELLOW}⏰ Next update in ${interval} seconds...${NC}"
        echo ""
        sleep $interval
    done
}

# Function to show current state
show_current_state() {
    echo -e "${BLUE}📊 Current Database State${NC}"
    echo "================================"
    
    monitor_staging_schemas
    echo ""
    
    monitor_recent_activity
    echo ""
    
    monitor_database_size
    echo ""
}

# Parse command line arguments
case "${1:-}" in
    "monitor"|"watch")
        monitor_loop "${2:-30}"
        ;;
    "state"|"status")
        show_current_state
        ;;
    "help"|"--help"|"-h")
        echo "Usage: $0 [command] [interval]"
        echo ""
        echo "Commands:"
        echo "  monitor [interval]  - Start continuous monitoring (default: 30s)"
        echo "  watch [interval]    - Alias for monitor"
        echo "  state               - Show current database state"
        echo "  status              - Alias for state"
        echo "  help                - Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 monitor          - Monitor with 30s interval"
        echo "  $0 watch 10         - Monitor with 10s interval"
        echo "  $0 state            - Show current state once"
        ;;
    *)
        show_current_state
        ;;
esac
