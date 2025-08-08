#!/bin/bash

# BBox Connectivity Analysis
# Processes ALL trails in a specific bbox with precise 20m tolerance

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BBOX="-105.35545816139866,39.86840223651447,-105.20922413855001,40.01750391845792"
REGION="boulder"
OUTPUT_DIR="bbox-connectivity-analysis"
TOLERANCE="20"  # 20m tolerance for precise intersection detection

echo -e "${BLUE}🔍 BBox Connectivity Analysis${NC}"
echo "=================================="
echo "Region: $REGION"
echo "BBox: $BBOX"
echo "Tolerance: ${TOLERANCE}m"
echo "Output Directory: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Step 1: Run orchestrator with bbox constraint and ALL trails
echo -e "${BLUE}🚀 Step 1: Processing ALL trails in bbox...${NC}"
echo "Running orchestrator with bbox constraint..."

# Process ALL trails in the bbox (no limit)
npx ts-node src/cli/export.ts \
    --region "$REGION" \
    --bbox "$BBOX" \
    --routes-only \
    --no-cleanup \
    --out "$OUTPUT_DIR/bbox-routes.geojson"

echo -e "${GREEN}✅ BBox processing complete${NC}"

# Step 2: Run connectivity analysis with 20m tolerance
echo -e "${BLUE}🔍 Step 2: Running connectivity analysis...${NC}"

npx ts-node src/cli/analyze-connectivity.ts \
    --region "$REGION" \
    --dry-run \
    --max-connection-distance "$TOLERANCE" \
    --intersection-tolerance "5" \
    --endpoint-tolerance "10" \
    --min-impact-score 10 \
    --analyze-missing-trails \
    --export-visualization "$OUTPUT_DIR/bbox-connectors.geojson" \
    --output "$OUTPUT_DIR/bbox-connectivity-analysis.json"

echo -e "${GREEN}✅ Connectivity analysis complete${NC}"

# Step 3: Run detailed missing trail analysis
echo -e "${BLUE}🔍 Step 3: Analyzing missing trail segments...${NC}"

npx ts-node src/cli/analyze-connectivity.ts \
    --region "$REGION" \
    --analyze-missing-trails \
    --generate-trail-restoration-sql \
    --trail-restoration-sql-output "$OUTPUT_DIR/bbox-trail-restoration.sql" \
    --output "$OUTPUT_DIR/bbox-missing-trails.json"

echo -e "${GREEN}✅ Missing trail analysis complete${NC}"

# Step 4: Display results summary
echo -e "${BLUE}📊 Step 4: Analysis Summary${NC}"
echo "================================"

if [ -f "$OUTPUT_DIR/bbox-connectivity-analysis.json" ]; then
    echo -e "${GREEN}✅ Connectivity analysis saved to: $OUTPUT_DIR/bbox-connectivity-analysis.json${NC}"
fi

if [ -f "$OUTPUT_DIR/bbox-connectors.geojson" ]; then
    echo -e "${GREEN}✅ Connector visualization saved to: $OUTPUT_DIR/bbox-connectors.geojson${NC}"
    echo -e "${YELLOW}💡 Open this file in a mapping tool to see potential connectors${NC}"
fi

if [ -f "$OUTPUT_DIR/bbox-missing-trails.json" ]; then
    echo -e "${GREEN}✅ Missing trails analysis saved to: $OUTPUT_DIR/bbox-missing-trails.json${NC}"
fi

if [ -f "$OUTPUT_DIR/bbox-trail-restoration.sql" ]; then
    echo -e "${GREEN}✅ Trail restoration SQL saved to: $OUTPUT_DIR/bbox-trail-restoration.sql${NC}"
fi

echo ""
echo -e "${GREEN}🎉 BBox connectivity analysis complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review the connector visualization in the GeoJSON file"
echo "2. Check the missing trails analysis for lost trail segments"
echo "3. Apply the trail restoration SQL if needed"
echo "4. Re-run route generation to see improvements" 