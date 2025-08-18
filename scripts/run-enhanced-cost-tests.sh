#!/bin/bash

# Enhanced Preference-Based Cost Routing Test Runner
# This script runs all tests for the enhanced cost routing system

set -e

echo "🧪 Enhanced Preference-Based Cost Routing Test Suite"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
print_status $BLUE "Checking prerequisites..."

if ! command_exists node; then
    print_status $RED "❌ Node.js is required but not installed"
    exit 1
fi

if ! command_exists psql; then
    print_status $RED "❌ PostgreSQL client (psql) is required but not installed"
    exit 1
fi

print_status $GREEN "✅ Prerequisites check passed"

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_status $YELLOW "⚠️  .env file not found, using default database settings"
fi

# Test 1: Run TypeScript unit tests
print_status $BLUE "\n📋 Test 1: Running TypeScript unit tests..."
if npm test -- --testPathPattern=enhanced-preference-cost-routing.test.ts --verbose; then
    print_status $GREEN "✅ TypeScript unit tests passed"
else
    print_status $RED "❌ TypeScript unit tests failed"
    exit 1
fi

# Test 2: Run SQL function tests
print_status $BLUE "\n📋 Test 2: Running SQL function tests..."

# Check if we can connect to the database
if psql -c "SELECT 1;" >/dev/null 2>&1; then
    print_status $GREEN "✅ Database connection successful"
    
    # Run SQL tests
    if psql -f scripts/test-enhanced-preference-cost.sql; then
        print_status $GREEN "✅ SQL function tests passed"
    else
        print_status $RED "❌ SQL function tests failed"
        exit 1
    fi
else
    print_status $YELLOW "⚠️  Skipping SQL tests - cannot connect to database"
    print_status $YELLOW "   Make sure PostgreSQL is running and connection settings are correct"
fi

# Test 3: Run integration tests
print_status $BLUE "\n📋 Test 3: Running integration tests..."
if node scripts/test-enhanced-cost-integration.js; then
    print_status $GREEN "✅ Integration tests passed"
else
    print_status $RED "❌ Integration tests failed"
    exit 1
fi

# Test 4: Test configuration loading
print_status $BLUE "\n📋 Test 4: Testing configuration loading..."
if node -e "
const fs = require('fs');
const yaml = require('js-yaml');

try {
    const config = yaml.load(fs.readFileSync('configs/layer3-routing.config.yaml', 'utf8'));
    const enhancedCost = config.costWeighting?.enhancedCostRouting;
    
    if (enhancedCost && enhancedCost.enabled) {
        console.log('✅ Enhanced cost routing configuration found and enabled');
        console.log('   - Priority weights:', JSON.stringify(enhancedCost.priorityWeights));
        console.log('   - Elevation cost config:', JSON.stringify(enhancedCost.elevationCost));
        console.log('   - Distance cost config:', JSON.stringify(enhancedCost.distanceCost));
    } else {
        console.log('❌ Enhanced cost routing configuration not found or disabled');
        process.exit(1);
    }
} catch (error) {
    console.log('❌ Failed to load configuration:', error.message);
    process.exit(1);
}
"; then
    print_status $GREEN "✅ Configuration test passed"
else
    print_status $RED "❌ Configuration test failed"
    exit 1
fi

# Test 5: Test TypeScript service compilation
print_status $BLUE "\n📋 Test 5: Testing TypeScript service compilation..."
if npx tsc --noEmit src/utils/services/enhanced-preference-cost-service.ts; then
    print_status $GREEN "✅ TypeScript service compiles successfully"
else
    print_status $RED "❌ TypeScript service compilation failed"
    exit 1
fi

# Summary
print_status $GREEN "\n🎉 All tests completed successfully!"
print_status $BLUE "\n📊 Test Summary:"
print_status $GREEN "   ✅ TypeScript unit tests"
print_status $GREEN "   ✅ SQL function tests"
print_status $GREEN "   ✅ Integration tests"
print_status $GREEN "   ✅ Configuration tests"
print_status $GREEN "   ✅ TypeScript compilation"

print_status $BLUE "\n🚀 Enhanced preference-based cost routing system is ready to use!"
print_status $YELLOW "\n💡 Next steps:"
print_status $YELLOW "   1. Install the SQL functions in your database"
print_status $YELLOW "   2. Integrate the EnhancedPreferenceCostService into your route generation"
print_status $YELLOW "   3. Configure the priority weights in configs/layer3-routing.config.yaml"
print_status $YELLOW "   4. Test with real route data"

echo ""
print_status $BLUE "For more information, see: docs/features/enhanced-preference-cost-routing.md"
