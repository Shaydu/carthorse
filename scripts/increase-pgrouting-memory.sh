#!/bin/bash

# Increase pgRouting Memory Allocation Script
# This script increases PostgreSQL memory settings specifically for pgRouting operations

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
DB_NAME=${PGDATABASE:-trail_master_db}
DB_USER=${PGUSER:-carthorse}
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}

echo -e "${GREEN}🚀 Increasing pgRouting Memory Allocation${NC}"
echo -e "${BLUE}Database: $DB_NAME${NC}"
echo -e "${BLUE}User: $DB_USER${NC}"
echo ""

# Function to check current memory settings
check_current_settings() {
    echo -e "${CYAN}📊 Current PostgreSQL Memory Settings:${NC}"
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            name,
            setting,
            unit,
            context,
            CASE 
                WHEN name = 'work_mem' AND setting::int < 1048576 THEN '⚠️ TOO LOW'
                WHEN name = 'shared_buffers' AND setting::int < 1073741824 THEN '⚠️ TOO LOW'
                ELSE '✅ OK'
            END as status
        FROM pg_settings 
        WHERE name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size', 'max_connections')
        ORDER BY name;
    " 2>/dev/null || echo "❌ Could not get memory settings"
    echo ""
}

# Function to increase memory settings for pgRouting
increase_memory_settings() {
    echo -e "${GREEN}🔧 Increasing Memory Settings for pgRouting...${NC}"
    
    # Set higher memory settings to handle large routing operations
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        -- Increase work_mem for complex routing queries
        SET work_mem = '1GB';
        
        -- Increase shared buffers for better caching
        SET shared_buffers = '2GB';
        
        -- Increase maintenance work memory for index operations
        SET maintenance_work_mem = '1GB';
        
        -- Set effective cache size (should be 75% of total RAM)
        SET effective_cache_size = '8GB';
        
        -- Enable parallel queries for routing (can help with large datasets)
        SET max_parallel_workers_per_gather = 4;
        SET max_parallel_workers = 8;
        
        -- Increase statement timeout for long-running routing queries
        SET statement_timeout = '1800s';
        
        -- Optimize for routing workloads
        SET random_page_cost = 1.1;
        SET seq_page_cost = 1.0;
        
        -- Increase hash table sizes for joins
        SET hash_mem_multiplier = 2.0;
        
        -- Optimize for large result sets
        SET temp_buffers = '256MB';
    " 2>/dev/null || echo "❌ Could not update memory settings"
    
    echo -e "${GREEN}✅ Memory settings increased for pgRouting${NC}"
    echo ""
}

# Function to create permanent configuration
create_permanent_config() {
    echo -e "${YELLOW}💡 Creating Permanent Configuration...${NC}"
    
    # Create a PostgreSQL configuration snippet
    cat > postgresql-pgrouting-optimization.conf << 'EOF'
# PostgreSQL Configuration for pgRouting Optimization
# Add these settings to your postgresql.conf file

# Memory Settings for Large Routing Operations
shared_buffers = 2GB                    # 25% of total RAM
work_mem = 1GB                          # Per-operation memory
maintenance_work_mem = 1GB              # For index maintenance
effective_cache_size = 8GB              # 75% of total RAM
temp_buffers = 256MB                    # Temporary table memory

# Parallel Processing
max_parallel_workers_per_gather = 4     # Parallel workers per query
max_parallel_workers = 8                # Total parallel workers
max_parallel_maintenance_workers = 4    # Parallel maintenance workers

# Query Optimization
random_page_cost = 1.1                  # SSD optimization
seq_page_cost = 1.0                     # Sequential scan cost
hash_mem_multiplier = 2.0               # Hash table memory multiplier

# Timeouts
statement_timeout = 1800s                # 30 minutes for routing queries
lock_timeout = 30s                      # Lock timeout

# Connection Settings
max_connections = 100                   # Adjust based on your needs

# Logging (for debugging routing issues)
log_min_duration_statement = 1000       # Log queries taking > 1 second
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on

# WAL Settings (for better performance)
wal_buffers = 64MB
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min
max_wal_size = 4GB
min_wal_size = 1GB
EOF

    echo -e "${GREEN}✅ Permanent configuration created: postgresql-pgrouting-optimization.conf${NC}"
    echo -e "${YELLOW}   To apply permanently:${NC}"
    echo -e "${YELLOW}   1. Copy these settings to your postgresql.conf${NC}"
    echo -e "${YELLOW}   2. Restart PostgreSQL service${NC}"
    echo -e "${YELLOW}   3. Or use ALTER SYSTEM commands for dynamic settings${NC}"
    echo ""
}

# Function to apply dynamic settings
apply_dynamic_settings() {
    echo -e "${GREEN}🔧 Applying Dynamic Settings (No Restart Required)...${NC}"
    
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        -- Apply settings that don't require restart
        ALTER SYSTEM SET work_mem = '1GB';
        ALTER SYSTEM SET maintenance_work_mem = '1GB';
        ALTER SYSTEM SET effective_cache_size = '8GB';
        ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
        ALTER SYSTEM SET max_parallel_workers = 8;
        ALTER SYSTEM SET statement_timeout = '1800s';
        ALTER SYSTEM SET random_page_cost = 1.1;
        ALTER SYSTEM SET hash_mem_multiplier = 2.0;
        ALTER SYSTEM SET temp_buffers = '256MB';
        
        -- Reload configuration
        SELECT pg_reload_conf();
    " 2>/dev/null || echo "❌ Could not apply dynamic settings"
    
    echo -e "${GREEN}✅ Dynamic settings applied${NC}"
    echo ""
}

# Function to test memory allocation
test_memory_allocation() {
    echo -e "${BLUE}🧪 Testing Memory Allocation...${NC}"
    
    # Test with a simple routing query
    echo -e "${YELLOW}   Testing with simple routing query...${NC}"
    
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        -- Test memory allocation with a simple routing query
        EXPLAIN (ANALYZE, BUFFERS) 
        SELECT COUNT(*) 
        FROM (
            SELECT * 
            FROM pgr_dijkstra(
                'SELECT id, source, target, cost FROM carthorse_1757192500578.ways_noded LIMIT 100',
                1, 2, false
            )
        ) as test_route;
    " 2>/dev/null || echo "❌ Could not test memory allocation"
    
    echo ""
}

# Function to monitor memory usage
monitor_memory_usage() {
    echo -e "${BLUE}📊 Current Memory Usage:${NC}"
    
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            'Current Memory Usage' as metric,
            pg_size_pretty(pg_database_size(current_database())) as database_size,
            (SELECT setting FROM pg_settings WHERE name = 'work_mem') as work_mem,
            (SELECT setting FROM pg_settings WHERE name = 'shared_buffers') as shared_buffers,
            (SELECT setting FROM pg_settings WHERE name = 'maintenance_work_mem') as maintenance_work_mem;
    " 2>/dev/null || echo "❌ Could not get memory usage"
    
    echo ""
}

# Function to suggest system-level optimizations
suggest_system_optimizations() {
    echo -e "${YELLOW}💡 System-Level Optimization Recommendations:${NC}"
    echo ""
    echo -e "${YELLOW}1. System RAM:${NC}"
    echo "   - Ensure you have at least 16GB RAM for large routing operations"
    echo "   - Consider 32GB+ for very large trail networks"
    echo ""
    echo -e "${YELLOW}2. PostgreSQL Configuration:${NC}"
    echo "   - Use the generated postgresql-pgrouting-optimization.conf"
    echo "   - Restart PostgreSQL after applying permanent settings"
    echo ""
    echo -e "${YELLOW}3. Disk I/O:${NC}"
    echo "   - Use SSD storage for better I/O performance"
    echo "   - Consider RAID 0 or 10 for better throughput"
    echo ""
    echo -e "${YELLOW}4. Network Size Limits:${NC}"
    echo "   - Consider processing smaller geographic areas"
    echo "   - Use bounding box filters to limit network size"
    echo "   - Filter out very short trail segments"
    echo ""
    echo -e "${YELLOW}5. Alternative Algorithms:${NC}"
    echo "   - Use KSP (K-Shortest Paths) instead of Hawick Circuits"
    echo "   - Implement targeted loop detection"
    echo "   - Use Dijkstra with distance limits"
    echo ""
}

# Main execution
main() {
    echo -e "${GREEN}🚀 pgRouting Memory Allocation Increase${NC}"
    echo "=============================================="
    echo ""
    
    # Step 1: Check current settings
    check_current_settings
    
    # Step 2: Apply dynamic settings
    read -p "Apply dynamic memory settings? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        apply_dynamic_settings
    fi
    
    # Step 3: Increase session settings
    read -p "Increase session memory settings? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        increase_memory_settings
    fi
    
    # Step 4: Create permanent configuration
    read -p "Create permanent configuration file? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        create_permanent_config
    fi
    
    # Step 5: Test memory allocation
    read -p "Test memory allocation? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        test_memory_allocation
    fi
    
    # Step 6: Monitor memory usage
    monitor_memory_usage
    
    # Step 7: Show recommendations
    suggest_system_optimizations
    
    echo -e "${GREEN}✅ Memory allocation increase complete!${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Test your routing operations with the increased memory"
    echo "2. Monitor memory usage during large operations"
    echo "3. Consider implementing more efficient algorithms if issues persist"
    echo "4. Apply permanent configuration if results are satisfactory"
}

# Run main function
main "$@"
