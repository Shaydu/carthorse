#!/bin/bash

# Routing Graph Quality Validation Script
# This script automatically validates the quality of routing nodes and edges
# Can be run in CI/CD or as a standalone validation tool

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

echo -e "${BLUE}🔍 Routing Graph Quality Validation${NC}"
echo "=================================="
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo ""

# Function to run SQL query and get result
run_query() {
    local query="$1"
    local result=$(PGDATABASE=$DB_NAME psql -h $DB_HOST -p $DB_PORT -U $DB_USER -t -c "$query" 2>/dev/null | tr -d ' ')
    echo "$result"
}

# Function to check if query returns non-zero
check_query() {
    local query="$1"
    local expected="$2"
    local description="$3"
    
    local result=$(run_query "$query")
    
    if [ "$result" = "$expected" ]; then
        echo -e "${GREEN}✅ $description${NC}"
        return 0
    else
        echo -e "${RED}❌ $description (got: $result, expected: $expected)${NC}"
        return 1
    fi
}

# Function to check if query returns greater than threshold
check_greater_than() {
    local query="$1"
    local threshold="$2"
    local description="$3"
    
    local result=$(run_query "$query")
    
    if [ "$result" -gt "$threshold" ] 2>/dev/null; then
        echo -e "${GREEN}✅ $description ($result > $threshold)${NC}"
        return 0
    else
        echo -e "${RED}❌ $description ($result <= $threshold)${NC}"
        return 1
    fi
}

# Function to check if query returns less than threshold
check_less_than() {
    local query="$1"
    local threshold="$2"
    local description="$3"
    
    local result=$(run_query "$query")
    
    if [ "$result" -lt "$threshold" ] 2>/dev/null; then
        echo -e "${GREEN}✅ $description ($result < $threshold)${NC}"
        return 0
    else
        echo -e "${RED}❌ $description ($result >= $threshold)${NC}"
        return 1
    fi
}

# Function to display metric
show_metric() {
    local query="$1"
    local description="$2"
    
    local result=$(run_query "$query")
    echo -e "${BLUE}📊 $description: $result${NC}"
}

# Track overall success
overall_success=true

echo -e "${YELLOW}🔍 Basic Metrics${NC}"
echo "----------------"

# Check if routing tables exist
if ! check_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'routing_nodes'" "1" "Routing nodes table exists"; then
    overall_success=false
fi

if ! check_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'routing_edges'" "1" "Routing edges table exists"; then
    overall_success=false
fi

# Show basic counts
show_metric "SELECT COUNT(*) FROM routing_nodes" "Total Nodes"
show_metric "SELECT COUNT(*) FROM routing_edges" "Total Edges"
show_metric "SELECT COUNT(*) FROM trails" "Total Trails"

echo ""
echo -e "${YELLOW}🔍 Quality Checks${NC}"
echo "----------------"

# Check for orphaned nodes
if ! check_query "
    SELECT COUNT(*) FROM routing_nodes n
    WHERE NOT EXISTS (
        SELECT 1 FROM routing_edges e 
        WHERE e.source = n.id OR e.target = n.id
    )
" "0" "No orphaned nodes"; then
    overall_success=false
fi

# Check for self-loops (should be minimal)
self_loops=$(run_query "SELECT COUNT(*) FROM routing_edges WHERE source = target")
total_edges=$(run_query "SELECT COUNT(*) FROM routing_edges")
if [ "$total_edges" -gt 0 ]; then
    self_loop_percentage=$((self_loops * 100 / total_edges))
    if [ "$self_loop_percentage" -lt 10 ]; then
        echo -e "${GREEN}✅ Self-loops are minimal ($self_loops/$total_edges = ${self_loop_percentage}%)${NC}"
    else
        echo -e "${RED}❌ Too many self-loops ($self_loops/$total_edges = ${self_loop_percentage}%)${NC}"
        overall_success=false
    fi
else
    echo -e "${YELLOW}⚠️ No edges found${NC}"
fi

# Check node-to-trail ratio
node_count=$(run_query "SELECT COUNT(*) FROM routing_nodes")
trail_count=$(run_query "SELECT COUNT(*) FROM trails")
if [ "$trail_count" -gt 0 ]; then
    ratio=$((node_count * 100 / trail_count))
    if [ "$ratio" -gt 100 ] && [ "$ratio" -lt 1000 ]; then
        echo -e "${GREEN}✅ Node-to-trail ratio is reasonable (${ratio}%)${NC}"
    else
        echo -e "${RED}❌ Node-to-trail ratio is unusual (${ratio}%)${NC}"
        overall_success=false
    fi
fi

# Check for invalid coordinates
if ! check_query "
    SELECT COUNT(*) FROM routing_nodes 
    WHERE lng IS NULL OR lat IS NULL 
       OR lng < -180 OR lng > 180 
       OR lat < -90 OR lat > 90
" "0" "All nodes have valid coordinates"; then
    overall_success=false
fi

# Check for invalid edge connections
if ! check_query "
    SELECT COUNT(*) FROM routing_edges e
    LEFT JOIN routing_nodes n1 ON e.source = n1.id
    LEFT JOIN routing_nodes n2 ON e.target = n2.id
    WHERE n1.id IS NULL OR n2.id IS NULL
" "0" "All edges have valid node connections"; then
    overall_success=false
fi

# Check edge distances
valid_length_edges=$(run_query "
    SELECT COUNT(*) FROM routing_edges 
    WHERE length_km > 0 AND length_km < 100
")
total_edges_with_length=$(run_query "
    SELECT COUNT(*) FROM routing_edges 
    WHERE length_km IS NOT NULL
")
if [ "$total_edges_with_length" -gt 0 ]; then
    if [ "$valid_length_edges" -eq "$total_edges_with_length" ]; then
        echo -e "${GREEN}✅ All edges have reasonable lengths${NC}"
    else
        echo -e "${RED}❌ Some edges have invalid lengths ($valid_length_edges/$total_edges_with_length)${NC}"
        overall_success=false
    fi
fi

echo ""
echo -e "${YELLOW}🔍 Performance Checks${NC}"
echo "----------------"

# Check for spatial indexes
spatial_indexes=$(run_query "
    SELECT COUNT(*) FROM pg_indexes 
    WHERE tablename IN ('routing_nodes', 'routing_edges')
    AND indexdef LIKE '%GIST%'
")
if [ "$spatial_indexes" -gt 0 ]; then
    echo -e "${GREEN}✅ Spatial indexes found ($spatial_indexes)${NC}"
else
    echo -e "${YELLOW}⚠️ No spatial indexes found${NC}"
fi

# Show table sizes
echo -e "${BLUE}📊 Table sizes:${NC}"
PGDATABASE=$DB_NAME psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "
    SELECT 
        tablename,
        pg_size_pretty(pg_total_relation_size(tablename)) as size
    FROM pg_tables 
    WHERE tablename IN ('routing_nodes', 'routing_edges', 'trails')
    AND schemaname = 'public'
    ORDER BY tablename;
" 2>/dev/null || echo "Could not get table sizes"

echo ""
echo -e "${YELLOW}🔍 Data Integrity Checks${NC}"
echo "----------------"

# Check for duplicate edges
duplicate_edges=$(run_query "
    SELECT COUNT(*) FROM (
        SELECT source, target, COUNT(*) as edge_count
        FROM routing_edges
        GROUP BY source, target
        HAVING COUNT(*) > 1
    ) duplicates
")
if [ "$duplicate_edges" -eq 0 ]; then
    echo -e "${GREEN}✅ No duplicate edges${NC}"
else
    echo -e "${YELLOW}⚠️ Found $duplicate_edges duplicate edges${NC}"
fi

# Check for duplicate nodes at same location (some may be expected)
duplicate_nodes=$(run_query "
    SELECT COUNT(*) FROM (
        SELECT lng, lat, COUNT(*) as node_count
        FROM routing_nodes
        GROUP BY lng, lat
        HAVING COUNT(*) > 1
    ) duplicates
")
if [ "$duplicate_nodes" -lt 10 ]; then
    echo -e "${GREEN}✅ Duplicate nodes at same location are minimal ($duplicate_nodes)${NC}"
else
    echo -e "${YELLOW}⚠️ Many duplicate nodes at same location ($duplicate_nodes)${NC}"
fi

echo ""
echo -e "${YELLOW}📊 Comprehensive Report${NC}"
echo "----------------"

# Generate comprehensive report
PGDATABASE=$DB_NAME psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "
    SELECT 
        'Total Nodes' as metric, COUNT(*)::text as value FROM routing_nodes
    UNION ALL
    SELECT 'Total Edges', COUNT(*)::text FROM routing_edges
    UNION ALL
    SELECT 'Self Loops', COUNT(*)::text FROM routing_edges WHERE source = target
    UNION ALL
    SELECT 'Orphaned Nodes', COUNT(*)::text FROM routing_nodes WHERE id NOT IN (SELECT DISTINCT source FROM routing_edges) AND id NOT IN (SELECT DISTINCT target FROM routing_edges)
    UNION ALL
    SELECT 'Connected Components', COUNT(DISTINCT component)::text FROM (SELECT id, CASE WHEN source = target THEN id ELSE LEAST(source, target) END as component FROM routing_edges) as components
    UNION ALL
    SELECT 'Node-to-Trail Ratio', (COUNT(*)::numeric / (SELECT COUNT(*) FROM trails))::text FROM routing_nodes
    UNION ALL
    SELECT 'Average Edge Length (km)', AVG(length_km)::text FROM routing_edges WHERE length_km IS NOT NULL
    UNION ALL
    SELECT 'Max Edge Length (km)', MAX(length_km)::text FROM routing_edges WHERE length_km IS NOT NULL
    UNION ALL
    SELECT 'Min Edge Length (km)', MIN(length_km)::text FROM routing_edges WHERE length_km IS NOT NULL
    ORDER BY metric;
" 2>/dev/null || echo "Could not generate comprehensive report"

echo ""
echo "=================================="
if [ "$overall_success" = true ]; then
    echo -e "${GREEN}🎉 Routing graph quality validation PASSED${NC}"
    exit 0
else
    echo -e "${RED}❌ Routing graph quality validation FAILED${NC}"
    exit 1
fi 