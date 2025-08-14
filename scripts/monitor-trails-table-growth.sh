#!/bin/bash

# Monitor trail_master_db.public.trails table growth
# This script checks the table size and row count at regular intervals

DB_NAME="trail_master_db"
TABLE_NAME="public.trails"
LOG_FILE="logs/trails-table-monitor.log"
INTERVAL_SECONDS=300  # Check every 5 minutes

# Create logs directory if it doesn't exist
mkdir -p logs

echo "Starting trails table monitoring at $(date)" | tee -a "$LOG_FILE"
echo "Monitoring: $DB_NAME.$TABLE_NAME" | tee -a "$LOG_FILE"
echo "Check interval: $INTERVAL_SECONDS seconds" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "----------------------------------------" | tee -a "$LOG_FILE"

# Function to get table statistics
get_table_stats() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Get row count
    local row_count=$(psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM $TABLE_NAME WHERE source = 'cotrex';" 2>/dev/null | xargs)
    
    # Get table size in MB
    local table_size=$(psql -d "$DB_NAME" -t -c "
        SELECT ROUND(pg_total_relation_size('$TABLE_NAME') / 1024.0 / 1024.0, 2) 
        AS size_mb;" 2>/dev/null | xargs)
    
    # Get index size in MB
    local index_size=$(psql -d "$DB_NAME" -t -c "
        SELECT ROUND(pg_indexes_size('$TABLE_NAME') / 1024.0 / 1024.0, 2) 
        AS index_size_mb;" 2>/dev/null | xargs)
    
    echo "$timestamp | Rows: $row_count | Table Size: ${table_size}MB | Index Size: ${index_size}MB" | tee -a "$LOG_FILE"
}

# Initial stats
echo "Initial table statistics:" | tee -a "$LOG_FILE"
get_table_stats

# Monitor loop
while true; do
    sleep "$INTERVAL_SECONDS"
    get_table_stats
done
