#!/bin/bash

# Run Tests with PostGIS Performance Monitoring
# This script runs tests while monitoring PostGIS performance in the background

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
MONITOR_INTERVAL=${1:-2}  # Default 2 seconds
TEST_COMMAND=${2:-"npm test"}  # Default test command
MONITOR_LOG="/tmp/test_monitor_$(date +%Y%m%d_%H%M%S).log"

echo -e "${GREEN}🚀 Running Tests with PostGIS Performance Monitoring${NC}"
echo "=========================================================="
echo -e "${BLUE}📊 Monitor interval: ${MONITOR_INTERVAL}s${NC}"
echo -e "${BLUE}🧪 Test command: $TEST_COMMAND${NC}"
echo -e "${BLUE}📝 Monitor log: $MONITOR_LOG${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Not in carthorse project directory${NC}"
    exit 1
fi

# Check if test database is available
if [ "$PGDATABASE" != "trail_master_db_test" ]; then
    echo -e "${YELLOW}⚠️  Warning: PGDATABASE not set to test database${NC}"
    echo -e "${YELLOW}   Current: $PGDATABASE${NC}"
    echo -e "${YELLOW}   Expected: trail_master_db_test${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Start monitoring in background
echo -e "${CYAN}🔍 Starting PostGIS performance monitor...${NC}"
./scripts/dev-utils/test-performance-monitor.sh "$MONITOR_INTERVAL" > "$MONITOR_LOG" 2>&1 &
MONITOR_PID=$!

echo -e "${GREEN}✅ Monitor started (PID: $MONITOR_PID)${NC}"
echo ""

# Wait a moment for monitor to initialize
sleep 3

# Run the tests
echo -e "${PURPLE}🧪 Running tests...${NC}"
echo "================================"

# Capture test start time
TEST_START=$(date +%s)

# Run the test command
if eval "$TEST_COMMAND"; then
    TEST_EXIT_CODE=0
    echo -e "${GREEN}✅ Tests completed successfully${NC}"
else
    TEST_EXIT_CODE=$?
    echo -e "${RED}❌ Tests failed with exit code $TEST_EXIT_CODE${NC}"
fi

# Capture test end time
TEST_END=$(date +%s)
TEST_DURATION=$((TEST_END - TEST_START))

# Stop the monitor
echo ""
echo -e "${CYAN}🛑 Stopping performance monitor...${NC}"
kill $MONITOR_PID 2>/dev/null || true

# Wait for monitor to stop
sleep 2

# Show test results
echo ""
echo -e "${GREEN}📊 Test Results Summary${NC}"
echo "========================"
echo -e "${BLUE}   Test duration: ${TEST_DURATION}s${NC}"
echo -e "${BLUE}   Test exit code: $TEST_EXIT_CODE${NC}"
echo -e "${BLUE}   Monitor log: $MONITOR_LOG${NC}"

# Show key metrics from monitor log
echo ""
echo -e "${CYAN}🔍 Key Performance Metrics from Monitor:${NC}"
echo "=============================================="

if [ -f "$MONITOR_LOG" ]; then
    # Extract key metrics
    echo -e "${BLUE}📊 Trail counts:${NC}"
    grep "Total trails:" "$MONITOR_LOG" | tail -3 || echo "  No trail count data"
    
    echo ""
    echo -e "${BLUE}🗺️ Spatial index usage:${NC}"
    grep -A 5 "Spatial Index Usage:" "$MONITOR_LOG" | tail -10 || echo "  No spatial index data"
    
    echo ""
    echo -e "${BLUE}🐌 Slow operations:${NC}"
    grep -A 3 "Slow PostGIS Operations" "$MONITOR_LOG" | tail -10 || echo "  No slow operations found"
    
    echo ""
    echo -e "${BLUE}💾 Cache performance:${NC}"
    grep -A 3 "Cache Hit Ratios:" "$MONITOR_LOG" | tail -10 || echo "  No cache data"
    
    echo ""
    echo -e "${BLUE}🔒 Locks:${NC}"
    grep -A 3 "Test Locks:" "$MONITOR_LOG" | tail -10 || echo "  No lock data"
    
    echo ""
    echo -e "${BLUE}💻 System resources:${NC}"
    grep -A 3 "System Resources:" "$MONITOR_LOG" | tail -10 || echo "  No system resource data"
else
    echo -e "${RED}❌ Monitor log not found${NC}"
fi

# Show recommendations
echo ""
echo -e "${YELLOW}💡 Performance Recommendations:${NC}"
echo "================================"

# Check for common issues
if [ -f "$MONITOR_LOG" ]; then
    # Check for missing spatial indexes
    if grep -q "Missing spatial indexes" "$MONITOR_LOG"; then
        echo "  ⚠️  Missing spatial indexes detected"
        echo "     Consider running: scripts/optimize-test-database.sh"
    fi
    
    # Check for slow operations
    if grep -q "Slow PostGIS Operations" "$MONITOR_LOG"; then
        echo "  ⚠️  Slow PostGIS operations detected"
        echo "     Consider: Adding indexes, optimizing queries, or pre-computing results"
    fi
    
    # Check for low cache hit ratios
    if grep -q "cache_hit_ratio" "$MONITOR_LOG"; then
        low_cache=$(grep "cache_hit_ratio" "$MONITOR_LOG" | grep -E "[0-9]+\.[0-9]+" | awk '{if($NF < 80) print $0}' | wc -l)
        if [ "$low_cache" -gt 0 ]; then
            echo "  ⚠️  Low cache hit ratios detected"
            echo "     Consider: Increasing shared_buffers or work_mem"
        fi
    fi
    
    # Check for blocking locks
    if grep -q "Test Locks:" "$MONITOR_LOG" && ! grep -q "No blocking locks found" "$MONITOR_LOG"; then
        echo "  ⚠️  Database locks detected"
        echo "     Consider: Optimizing transaction isolation or query patterns"
    fi
fi

echo ""
echo -e "${GREEN}✅ Test run with monitoring complete${NC}"
echo -e "${BLUE}📝 Full monitor log: $MONITOR_LOG${NC}"

# Exit with test exit code
exit $TEST_EXIT_CODE 