#!/bin/bash
# Run fast tests with minimal disk usage
# This script runs only the fastest tests to avoid disk space issues

set -e

echo "🚀 Running Fast Tests (Minimal Disk Usage)"
echo "=========================================="

# Set environment for minimal disk usage
export NODE_ENV=test
export PGDATABASE=trail_master_db_test

# Run only the fastest tests
echo "1️⃣ Running basic tests..."
npm test -- --testNamePattern="basic|elevation" --maxWorkers=1 --verbose --no-cache

echo ""
echo "2️⃣ Running validation tests..."
npm test -- --testNamePattern="validation" --maxWorkers=1 --verbose --no-cache

echo ""
echo "3️⃣ Running export tests (limited scope)..."
npm test -- --testNamePattern="export" --maxWorkers=1 --verbose --no-cache --testTimeout=30000

echo ""
echo "✅ Fast tests completed!"
echo "💡 For full test suite, free up disk space first" 