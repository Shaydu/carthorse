#!/bin/bash

# Test Enhanced Intersection Splitting with CLI Export
# This script tests the enhanced intersection splitting with the larger bbox

echo "🧪 Testing Enhanced Intersection Splitting with CLI Export"
echo "=========================================================="

# First, install the enhanced function
echo "📦 Installing enhanced intersection splitting function..."
psql -h localhost -U carthorse -d trail_master_db -f sql/organized/functions/enhanced-intersection-splitting.sql

if [ $? -eq 0 ]; then
    echo "✅ Enhanced function installed successfully"
else
    echo "❌ Failed to install enhanced function"
    exit 1
fi

# Test with a small export to see the enhanced splitting in action
echo ""
echo "🚀 Running enhanced export with larger bbox..."
echo "   This will use the enhanced intersection splitting function"

# Run the export with the larger bbox
npx ts-node src/cli/export.ts \
  --region boulder \
  --out test-output/boulder-enhanced-split-test.geojson \
  --format geojson \
  --bbox -105.30958159914027,40.07269607609242,-105.26885500804738,40.09658466878596 \
  --disable-trailheads-only \
  --no-trailheads \
  --skip-validation \
  --no-cleanup \
  --verbose \
  --source cotrex

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Enhanced export completed successfully!"
    echo "📁 Output file: test-output/boulder-enhanced-split-test.geojson"
    echo ""
    echo "🔍 You can now compare this with the original export to see the difference:"
    echo "   Original: test-output/boulder-expanded-bbox-test.geojson"
    echo "   Enhanced: test-output/boulder-enhanced-split-test.geojson"
else
    echo "❌ Enhanced export failed"
    exit 1
fi

