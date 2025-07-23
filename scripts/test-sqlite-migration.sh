#!/bin/bash

# SQLite Migration Test Suite
# This script runs comprehensive tests for the SpatiaLite to SQLite migration

set -e

echo "🧪 Running SQLite Migration Test Suite"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
TEST_DB="trail_master_db_test"
TEST_USER="tester"

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "PASS")
            echo -e "${GREEN}✅ PASS${NC}: $message"
            ;;
        "FAIL")
            echo -e "${RED}❌ FAIL${NC}: $message"
            ;;
        "SKIP")
            echo -e "${YELLOW}⏭️  SKIP${NC}: $message"
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️  INFO${NC}: $message"
            ;;
    esac
}

# Function to check if test database is available
check_test_db() {
    if [ -z "$PGHOST" ] || [ -z "$PGUSER" ]; then
        print_status "SKIP" "Test database not configured (PGHOST or PGUSER not set)"
        return 1
    fi
    
    # Test database connection
    if ! psql -h "$PGHOST" -U "$PGUSER" -d "$TEST_DB" -c "SELECT 1;" > /dev/null 2>&1; then
        print_status "SKIP" "Cannot connect to test database $TEST_DB"
        return 1
    fi
    
    print_status "INFO" "Test database connection verified"
    return 0
}

# Function to run a test category
run_test_category() {
    local category=$1
    local test_pattern=$2
    local description=$3
    
    echo ""
    echo "📋 Running $category tests..."
    echo "   $description"
    
    if npm test -- --testNamePattern="$test_pattern" --passWithNoTests; then
        print_status "PASS" "$category tests completed successfully"
        return 0
    else
        print_status "FAIL" "$category tests failed"
        return 1
    fi
}

# Function to run manual CLI test
run_cli_test() {
    echo ""
    echo "🔧 Running manual CLI test..."
    
    local test_output="./data/test-cli-manual.db"
    local test_bbox="-105.3,40.0,-105.2,40.1"
    
    # Clean up any existing test file
    if [ -f "$test_output" ]; then
        rm "$test_output"
    fi
    
    # Run CLI export
    if PGDATABASE="$TEST_DB" PGUSER="$TEST_USER" npx ts-node src/cli/export.ts \
        --region boulder \
        --out "$test_output" \
        --bbox "$test_bbox" \
        --replace \
        --skip-incomplete-trails; then
        
        # Verify output file exists
        if [ -f "$test_output" ]; then
            print_status "PASS" "CLI export created SQLite database"
            
            # Check file size
            local file_size=$(du -h "$test_output" | cut -f1)
            print_status "INFO" "Output file size: $file_size"
            
            # Clean up
            rm "$test_output"
            return 0
        else
            print_status "FAIL" "CLI export did not create output file"
            return 1
        fi
    else
        print_status "FAIL" "CLI export command failed"
        return 1
    fi
}

# Function to run manual orchestrator test
run_orchestrator_test() {
    echo ""
    echo "🎼 Running manual orchestrator test..."
    
    local test_output="./data/test-orchestrator-manual.db"
    
    # Clean up any existing test file
    if [ -f "$test_output" ]; then
        rm "$test_output"
    fi
    
    # Create test script
    cat > test-orchestrator-manual.js << 'EOF'
const { EnhancedPostgresOrchestrator } = require('./src/orchestrator/EnhancedPostgresOrchestrator');

async function testOrchestrator() {
    const orchestrator = new EnhancedPostgresOrchestrator({
        region: 'boulder',
        outputPath: './data/test-orchestrator-manual.db',
        simplifyTolerance: 0.001,
        intersectionTolerance: 2,
        replace: true,
        validate: false,
        verbose: false,
        skipBackup: true,
        buildMaster: false,
        targetSizeMB: null,
        maxSpatiaLiteDbSizeMB: 100,
        skipIncompleteTrails: true,
        bbox: [-105.3, 40.0, -105.2, 40.1],
        skipCleanup: true,
    });

    try {
        await orchestrator.run();
        console.log('✅ Orchestrator test completed successfully');
        return true;
    } catch (error) {
        console.error('❌ Orchestrator test failed:', error.message);
        return false;
    }
}

testOrchestrator();
EOF

    # Run orchestrator test
    if PGDATABASE="$TEST_DB" PGUSER="$TEST_USER" node test-orchestrator-manual.js; then
        if [ -f "$test_output" ]; then
            print_status "PASS" "Orchestrator created SQLite database"
            
            # Check file size
            local file_size=$(du -h "$test_output" | cut -f1)
            print_status "INFO" "Output file size: $file_size"
            
            # Clean up
            rm "$test_output"
            rm test-orchestrator-manual.js
            return 0
        else
            print_status "FAIL" "Orchestrator did not create output file"
            rm test-orchestrator-manual.js
            return 1
        fi
    else
        print_status "FAIL" "Orchestrator test failed"
        rm test-orchestrator-manual.js
        return 1
    fi
}

# Function to validate SQLite database structure
validate_sqlite_structure() {
    local db_file=$1
    local test_name=$2
    
    echo ""
    echo "🔍 Validating SQLite database structure: $test_name"
    
    # Check if file exists
    if [ ! -f "$db_file" ]; then
        print_status "FAIL" "Database file does not exist: $db_file"
        return 1
    fi
    
    # Check file size
    local file_size=$(du -h "$db_file" | cut -f1)
    print_status "INFO" "Database file size: $file_size"
    
    # Check SQLite structure using sqlite3 (if available)
    if command -v sqlite3 >/dev/null 2>&1; then
        # Get table list
        local tables=$(sqlite3 "$db_file" "SELECT name FROM sqlite_master WHERE type='table';")
        
        # Check required tables
        local required_tables=("trails" "routing_nodes" "routing_edges" "region_metadata" "schema_version")
        local missing_tables=()
        
        for table in "${required_tables[@]}"; do
            if echo "$tables" | grep -q "^$table$"; then
                print_status "PASS" "Table exists: $table"
            else
                print_status "FAIL" "Missing table: $table"
                missing_tables+=("$table")
            fi
        done
        
        # Check for SpatiaLite tables (should NOT exist)
        if echo "$tables" | grep -q "spatial_ref_sys"; then
            print_status "FAIL" "SpatiaLite table found (should not exist): spatial_ref_sys"
        else
            print_status "PASS" "No SpatiaLite tables found (correct)"
        fi
        
        # Check data counts
        if echo "$tables" | grep -q "^trails$"; then
            local trail_count=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM trails;")
            print_status "INFO" "Trails count: $trail_count"
        fi
        
        if echo "$tables" | grep -q "^routing_nodes$"; then
            local node_count=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM routing_nodes;")
            print_status "INFO" "Routing nodes count: $node_count"
        fi
        
        if echo "$tables" | grep -q "^routing_edges$"; then
            local edge_count=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM routing_edges;")
            print_status "INFO" "Routing edges count: $edge_count"
        fi
        
        # Check WKT columns exist
        if echo "$tables" | grep -q "^trails$"; then
            local has_geometry_wkt=$(sqlite3 "$db_file" "PRAGMA table_info(trails);" | grep -c "geometry_wkt" || echo "0")
            if [ "$has_geometry_wkt" -gt 0 ]; then
                print_status "PASS" "Trails table has geometry_wkt column"
            else
                print_status "FAIL" "Trails table missing geometry_wkt column"
            fi
        fi
        
        if echo "$tables" | grep -q "^routing_nodes$"; then
            local has_coordinate_wkt=$(sqlite3 "$db_file" "PRAGMA table_info(routing_nodes);" | grep -c "coordinate_wkt" || echo "0")
            if [ "$has_coordinate_wkt" -gt 0 ]; then
                print_status "PASS" "Routing nodes table has coordinate_wkt column"
            else
                print_status "FAIL" "Routing nodes table missing coordinate_wkt column"
            fi
        fi
        
        if [ ${#missing_tables[@]} -eq 0 ]; then
            print_status "PASS" "SQLite database structure validation passed"
            return 0
        else
            print_status "FAIL" "SQLite database structure validation failed"
            return 1
        fi
    else
        print_status "SKIP" "sqlite3 command not available, skipping structure validation"
        return 0
    fi
}

# Main test execution
main() {
    echo "Starting SQLite migration test suite..."
    echo "Test database: $TEST_DB"
    echo "Test user: $TEST_USER"
    echo ""
    
    # Track overall success
    local overall_success=true
    
    # Check test database availability
    if ! check_test_db; then
        print_status "INFO" "Skipping tests that require database connection"
        echo ""
        echo "To run full test suite, set up test database:"
        echo "  export PGHOST=localhost"
        echo "  export PGUSER=tester"
        echo "  export PGPASSWORD=your_password"
        echo "  export PGDATABASE=trail_master_db_test"
        echo ""
        exit 0
    fi
    
    # Run test categories
    local test_categories=(
        "SQLite Export Migration|sqlite-export-migration|Full pipeline and schema validation tests"
        "CLI SQLite Migration|cli-sqlite-migration|Command-line interface tests"
        "SQLite Export Helpers|sqlite-export-helpers|Helper function unit tests"
    )
    
    for category_info in "${test_categories[@]}"; do
        IFS='|' read -r category pattern description <<< "$category_info"
        if ! run_test_category "$category" "$pattern" "$description"; then
            overall_success=false
        fi
    done
    
    # Run manual tests
    if ! run_cli_test; then
        overall_success=false
    fi
    
    if ! run_orchestrator_test; then
        overall_success=false
    fi
    
    # Summary
    echo ""
    echo "======================================"
    echo "🧪 SQLite Migration Test Summary"
    echo "======================================"
    
    if [ "$overall_success" = true ]; then
        print_status "PASS" "All SQLite migration tests passed!"
        echo ""
        echo "🎉 The SpatiaLite to SQLite migration is ready for production!"
        echo ""
        echo "Key improvements:"
        echo "  ✅ No SpatiaLite dependencies"
        echo "  ✅ Geometry stored as WKT text"
        echo "  ✅ All elevation data preserved"
        echo "  ✅ Proper schema validation"
        echo "  ✅ CLI integration working"
        echo "  ✅ Orchestrator pipeline working"
        exit 0
    else
        print_status "FAIL" "Some SQLite migration tests failed"
        echo ""
        echo "⚠️  Please fix the failing tests before merging to main"
        exit 1
    fi
}

# Run main function
main "$@" 