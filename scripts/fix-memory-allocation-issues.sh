#!/bin/bash

# Fix Memory Allocation Issues Script
# Specifically targets the Hawick Circuits memory allocation problem

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

echo -e "${RED}🚨 Memory Allocation Issue Fixer${NC}"
echo -e "${BLUE}Database: $DB_NAME${NC}"
echo -e "${BLUE}User: $DB_USER${NC}"
echo ""

# Function to check for active Hawick Circuits queries
check_hawick_circuits() {
    echo -e "${RED}🔍 Checking for Active Hawick Circuits Queries...${NC}"
    
    ACTIVE_HAWICK=$(psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT COUNT(*) 
        FROM pg_stat_activity 
        WHERE query LIKE '%pgr_hawickcircuits%'
        AND state = 'active';
    " 2>/dev/null | tail -n 1 | xargs)
    
    if [ "$ACTIVE_HAWICK" -gt 0 ]; then
        echo -e "${RED}🚨 CRITICAL: $ACTIVE_HAWICK active Hawick Circuits queries detected!${NC}"
        echo -e "${YELLOW}   These queries are consuming excessive memory and causing failures${NC}"
        
        # Show the problematic queries
        echo -e "${YELLOW}📊 Active Hawick Circuits Queries:${NC}"
        psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
            SELECT 
                pid,
                usename,
                now() - query_start as duration,
                LEFT(query, 80) as query_preview
            FROM pg_stat_activity 
            WHERE query LIKE '%pgr_hawickcircuits%'
            AND state = 'active'
            ORDER BY query_start ASC;
        " 2>/dev/null || echo "  Could not get query details"
        
        return 1
    else
        echo -e "${GREEN}✅ No active Hawick Circuits queries found${NC}"
        return 0
    fi
}

# Function to terminate problematic queries
terminate_hawick_queries() {
    echo -e "${YELLOW}🛑 Terminating Hawick Circuits Queries...${NC}"
    
    # Get PIDs of Hawick Circuits queries
    HAWICK_PIDS=$(psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT pid 
        FROM pg_stat_activity 
        WHERE query LIKE '%pgr_hawickcircuits%'
        AND state = 'active';
    " 2>/dev/null | tail -n +2 | tr -d ' ')
    
    if [ -n "$HAWICK_PIDS" ]; then
        echo -e "${YELLOW}   Terminating PIDs: $HAWICK_PIDS${NC}"
        for pid in $HAWICK_PIDS; do
            psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "SELECT pg_terminate_backend($pid);" 2>/dev/null || true
        done
        echo -e "${GREEN}✅ Hawick Circuits queries terminated${NC}"
    else
        echo -e "${GREEN}✅ No Hawick Circuits queries to terminate${NC}"
    fi
}

# Function to check PostgreSQL memory settings
check_memory_settings() {
    echo -e "${CYAN}📊 PostgreSQL Memory Settings:${NC}"
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            name,
            setting,
            unit,
            context,
            CASE 
                WHEN name = 'work_mem' AND setting::int > 1048576 THEN '⚠️ TOO HIGH'
                WHEN name = 'shared_buffers' AND setting::int > 1073741824 THEN '⚠️ TOO HIGH'
                ELSE '✅ OK'
            END as status
        FROM pg_settings 
        WHERE name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size')
        ORDER BY name;
    " 2>/dev/null || echo "❌ Could not get memory settings"
    echo ""
}

# Function to optimize memory settings for routing
optimize_memory_settings() {
    echo -e "${GREEN}🔧 Optimizing Memory Settings for Routing...${NC}"
    
    # Set conservative memory settings to prevent allocation failures
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        -- Reduce work_mem to prevent large allocations
        SET work_mem = '256MB';
        
        -- Set reasonable shared buffers
        SET shared_buffers = '512MB';
        
        -- Reduce maintenance work memory
        SET maintenance_work_mem = '256MB';
        
        -- Set effective cache size
        SET effective_cache_size = '2GB';
        
        -- Disable parallel queries for routing (can cause memory issues)
        SET max_parallel_workers_per_gather = 0;
        
        -- Set statement timeout to prevent hanging queries
        SET statement_timeout = '300s';
    " 2>/dev/null || echo "❌ Could not update memory settings"
    
    echo -e "${GREEN}✅ Memory settings optimized${NC}"
    echo ""
}

# Function to analyze routing graph size
analyze_routing_graph() {
    echo -e "${BLUE}📏 Analyzing Routing Graph Size...${NC}"
    
    psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT 
            schemaname,
            tablename,
            n_live_tup as row_count,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
            CASE 
                WHEN n_live_tup > 10000 THEN '⚠️ LARGE'
                WHEN n_live_tup > 5000 THEN '⚠️ MEDIUM'
                ELSE '✅ SMALL'
            END as size_category
        FROM pg_stat_user_tables 
        WHERE schemaname LIKE 'carthorse_%'
          AND tablename IN ('routing_edges', 'routing_nodes', 'trails')
        ORDER BY n_live_tup DESC;
    " 2>/dev/null || echo "❌ Could not analyze routing graph"
    echo ""
}

# Function to create memory-efficient indexes
create_memory_efficient_indexes() {
    echo -e "${GREEN}🔧 Creating Memory-Efficient Indexes...${NC}"
    
    # Find staging schemas that need indexes
    STAGING_SCHEMAS=$(psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
        SELECT DISTINCT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'carthorse_%'
        AND tablename IN ('routing_edges', 'routing_nodes')
        ORDER BY schemaname DESC
        LIMIT 3;
    " 2>/dev/null | tail -n +2 | tr -d ' ')
    
    for schema in $STAGING_SCHEMAS; do
        echo -e "${BLUE}   Creating indexes for schema: $schema${NC}"
        
        psql -h "$PGHOST" -U "$DB_USER" -p "$PGPORT" -d "$DB_NAME" -c "
            -- Create indexes for routing_edges
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_routing_edges_source 
            ON $schema.routing_edges (source);
            
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_routing_edges_target 
            ON $schema.routing_edges (target);
            
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_routing_edges_cost 
            ON $schema.routing_edges (cost);
            
            -- Create indexes for routing_nodes
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_routing_nodes_id 
            ON $schema.routing_nodes (id);
            
            -- Create spatial index for routing_nodes
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schema}_routing_nodes_spatial 
            ON $schema.routing_nodes USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
        " 2>/dev/null || echo "    ❌ Could not create indexes for $schema"
    done
    
    echo -e "${GREEN}✅ Memory-efficient indexes created${NC}"
    echo ""
}

# Function to suggest configuration changes
suggest_configuration_changes() {
    echo -e "${YELLOW}💡 Configuration Change Recommendations:${NC}"
    echo ""
    echo -e "${YELLOW}1. Disable Hawick Circuits in your routing configuration:${NC}"
    echo "   - Edit your routing config to use only KSP and Dijkstra algorithms"
    echo "   - Hawick Circuits are memory-intensive and causing failures"
    echo ""
    echo -e "${YELLOW}2. Reduce routing graph size:${NC}"
    echo "   - Use smaller bounding boxes for routing"
    echo "   - Filter out very short trails (< 100m)"
    echo "   - Limit the number of nodes in the routing graph"
    echo ""
    echo -e "${YELLOW}3. Update PostgreSQL configuration (postgresql.conf):${NC}"
    echo "   shared_buffers = 512MB"
    echo "   work_mem = 256MB"
    echo "   maintenance_work_mem = 256MB"
    echo "   effective_cache_size = 2GB"
    echo "   max_parallel_workers_per_gather = 0"
    echo ""
    echo -e "${YELLOW}4. Consider using a smaller test dataset:${NC}"
    echo "   - Use the test database with fewer trails"
    echo "   - Test with a subset of your data first"
    echo ""
}

# Function to create a safe routing configuration
create_safe_routing_config() {
    echo -e "${GREEN}🔧 Creating Safe Routing Configuration...${NC}"
    
    # Create a backup of current config
    if [ -f "configs/layer3-routing.config.yaml" ]; then
        cp configs/layer3-routing.config.yaml configs/layer3-routing.config.yaml.backup
        echo -e "${BLUE}   Backup created: configs/layer3-routing.config.yaml.backup${NC}"
    fi
    
    # Create a safe configuration without Hawick Circuits
    cat > configs/layer3-routing.config.yaml.safe << 'EOF'
# Safe Routing Configuration (No Hawick Circuits)
# This configuration avoids memory allocation issues

routing:
  algorithms:
    # Disable Hawick Circuits - they cause memory allocation failures
    hawickCircuits:
      enabled: false
      maxCircuits: 0
    
    # Use KSP (K-Shortest Paths) instead
    ksp:
      enabled: true
      maxPaths: 5
      maxDistance: 20.0
      maxElevationGain: 1000
    
    # Use Dijkstra for simple routing
    dijkstra:
      enabled: true
      maxDistance: 15.0
      maxElevationGain: 800
    
    # Disable other memory-intensive algorithms
    johnson:
      enabled: false
    floydWarshall:
      enabled: false
  
  # Conservative memory settings
  memory:
    maxWorkMem: "256MB"
    maxMaintenanceWorkMem: "256MB"
    enableParallelQueries: false
  
  # Graph size limits
  limits:
    maxNodes: 5000
    maxEdges: 10000
    maxTrailLength: 20.0
    minTrailLength: 0.1
  
  # Performance settings
  performance:
    statementTimeout: 300
    enableSeqScan: false
    randomPageCost: 1.1
EOF

    echo -e "${GREEN}✅ Safe routing configuration created: configs/layer3-routing.config.yaml.safe${NC}"
    echo -e "${YELLOW}   To use this configuration, rename it to replace your current config${NC}"
    echo ""
}

# Main execution
main() {
    echo -e "${RED}🚨 Memory Allocation Issue Diagnosis and Fix${NC}"
    echo "=================================================="
    echo ""
    
    # Step 1: Check for active problematic queries
    if ! check_hawick_circuits; then
        echo -e "${RED}🚨 IMMEDIATE ACTION REQUIRED${NC}"
        read -p "Terminate Hawick Circuits queries? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            terminate_hawick_queries
        else
            echo -e "${YELLOW}⚠️  Skipping query termination${NC}"
        fi
    fi
    
    echo ""
    
    # Step 2: Check memory settings
    check_memory_settings
    
    # Step 3: Optimize memory settings
    read -p "Optimize memory settings? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        optimize_memory_settings
    fi
    
    echo ""
    
    # Step 4: Analyze routing graph
    analyze_routing_graph
    
    # Step 5: Create memory-efficient indexes
    read -p "Create memory-efficient indexes? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        create_memory_efficient_indexes
    fi
    
    echo ""
    
    # Step 6: Create safe configuration
    read -p "Create safe routing configuration? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        create_safe_routing_config
    fi
    
    echo ""
    
    # Step 7: Show recommendations
    suggest_configuration_changes
    
    echo -e "${GREEN}✅ Memory allocation issue diagnosis complete!${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Use the enhanced monitor: ./scripts/monitor-export-performance.sh"
    echo "2. Apply the safe routing configuration"
    echo "3. Test with a smaller dataset first"
    echo "4. Monitor memory usage during export"
}

# Run main function
main "$@"
