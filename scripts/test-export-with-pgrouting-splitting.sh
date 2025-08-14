#!/bin/bash

# Test script for PgRoutingSplittingService with actual export command
echo "🧪 Testing PgRoutingSplittingService with actual export command..."

# Create output directory if it doesn't exist
mkdir -p /Users/shaydu/dev/carthorse/test-output

# Run the actual export command with PgRoutingSplittingService
echo "🚀 Running export with PgRoutingSplittingService..."
npx ts-node src/cli/export.ts \
  --region boulder \
  --out /Users/shaydu/dev/carthorse/test-output/boulder-pgrouting-splitting-test.geojson \
  --format geojson \
  --bbox -105.29123174925316,39.96928418458248,-105.28050515816028,39.981172777276015 \
  --disable-trailheads-only \
  --no-trailheads \
  --use-split-trails \
  --skip-validation \
  --no-cleanup \
  --verbose \
  --source cotrex \
  --pgrouting-splitting \
  --splitting-method postgis

echo ""
echo "✅ Export completed!"
echo ""
echo "📁 Output file: /Users/shaydu/dev/carthorse/test-output/boulder-pgrouting-splitting-test.geojson"
echo ""
echo "🔍 To verify the results:"
echo "   1. Open the GeoJSON file in a GIS viewer (QGIS, Mapbox, etc.)"
echo "   2. Compare with the original boulder-degree-colored-export.geojson"
echo "   3. Check that trails are properly split at X, Y, and T intersections"
echo "   4. Verify that intersection points align with trail endpoints"
echo ""
echo "📊 Expected improvements:"
echo "   - More precise intersection detection using PostGIS ST_Node()"
echo "   - Better handling of complex intersection types (X, Y, T)"
echo "   - Cleaner trail segmentation at intersection points"
echo "   - Improved routing network topology"
