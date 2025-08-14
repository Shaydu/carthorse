#!/bin/bash

# Test script for export with modern PgRoutingSplittingService
# This tests the end-to-end flow using the new modern splitting approach

set -e

echo "🧪 Testing export with modern PgRoutingSplittingService..."
echo "📋 Command: $0"
echo "⏰ Start time: $(date)"

# Create test output directory
mkdir -p test-output/modern-splitting-test

# Test 1: Modern PostGIS ST_Node() splitting
echo ""
echo "🧪 Test 1: Modern PostGIS ST_Node() splitting"
echo "🔗 Running export with --modern-splitting --splitting-method postgis"

npx ts-node src/cli/export.ts \
  --region boulder \
  --out test-output/modern-splitting-test/boulder-postgis-split.geojson \
  --format geojson \
  --bbox -105.29123174925316,39.96928418458248,-105.28050515816028,39.981172777276015 \
  --disable-trailheads-only \
  --no-trailheads \
  --use-split-trails \
  --skip-validation \
  --no-cleanup \
  --verbose \
  --source cotrex \
  --modern-splitting \
  --splitting-method postgis

echo "✅ Test 1 completed: PostGIS ST_Node() splitting"

# Test 2: Modern pgRouting functions splitting
echo ""
echo "🧪 Test 2: Modern pgRouting functions splitting"
echo "🔗 Running export with --modern-splitting --splitting-method pgrouting"

npx ts-node src/cli/export.ts \
  --region boulder \
  --out test-output/modern-splitting-test/boulder-pgrouting-split.geojson \
  --format geojson \
  --bbox -105.29123174925316,39.96928418458248,-105.28050515816028,39.981172777276015 \
  --disable-trailheads-only \
  --no-trailheads \
  --use-split-trails \
  --skip-validation \
  --no-cleanup \
  --verbose \
  --source cotrex \
  --modern-splitting \
  --splitting-method pgrouting

echo "✅ Test 2 completed: pgRouting functions splitting"

# Test 3: Legacy splitting (for comparison)
echo ""
echo "🧪 Test 3: Legacy splitting (for comparison)"
echo "🔗 Running export with --legacy-splitting"

npx ts-node src/cli/export.ts \
  --region boulder \
  --out test-output/modern-splitting-test/boulder-legacy-split.geojson \
  --format geojson \
  --bbox -105.29123174925316,39.96928418458248,-105.28050515816028,39.981172777276015 \
  --disable-trailheads-only \
  --no-trailheads \
  --use-split-trails \
  --skip-validation \
  --no-cleanup \
  --verbose \
  --source cotrex \
  --legacy-splitting

echo "✅ Test 3 completed: Legacy splitting"

# Analyze results
echo ""
echo "📊 Analyzing results..."

# Count features in each GeoJSON file
echo "🔍 Feature counts:"
for file in test-output/modern-splitting-test/*.geojson; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    feature_count=$(jq '.features | length' "$file" 2>/dev/null || echo "Error reading file")
    echo "   $filename: $feature_count features"
  fi
done

# Compare file sizes
echo ""
echo "📏 File sizes:"
for file in test-output/modern-splitting-test/*.geojson; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    file_size=$(du -h "$file" | cut -f1)
    echo "   $filename: $file_size"
  fi
done

echo ""
echo "✅ All tests completed successfully!"
echo "📁 Results saved to: test-output/modern-splitting-test/"
echo "⏰ End time: $(date)"

echo ""
echo "🔍 To verify intersection splitting:"
echo "   1. Open the GeoJSON files in a GIS viewer (QGIS, Mapbox, etc.)"
echo "   2. Compare the three approaches:"
echo "      - boulder-postgis-split.geojson (PostGIS ST_Node())"
echo "      - boulder-pgrouting-split.geojson (pgRouting functions)"
echo "      - boulder-legacy-split.geojson (Legacy approach)"
echo "   3. Check that trails are properly split at X, Y, and T intersections"
echo "   4. Verify that intersection points align with trail endpoints"
