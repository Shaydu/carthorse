#!/bin/bash

# Network Connectivity Analysis Workflow
# This script runs the orchestrator to create a staging environment and then
# analyzes network connectivity to identify potential connector nodes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGION=${1:-boulder}
BBOX=${2:-""}  # Optional bbox constraint: "min_lng,min_lat,max_lng,max_lat"
LIMIT=${3:-100}  # Number of trails to process
OUTPUT_DIR=${4:-"connectivity-analysis"}

echo -e "${BLUE}🔍 Network Connectivity Analysis Workflow${NC}"
echo "=============================================="
echo "Region: $REGION"
echo "Trail Limit: $LIMIT"
echo "Output Directory: $OUTPUT_DIR"
if [ ! -z "$BBOX" ]; then
    echo "BBox Constraint: $BBOX"
fi
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Step 1: Run orchestrator to create staging environment
echo -e "${BLUE}🚀 Step 1: Creating staging environment...${NC}"
echo "Running orchestrator with region: $REGION, limit: $LIMIT"

if [ ! -z "$BBOX" ]; then
    echo "Using bbox constraint: $BBOX"
    npx ts-node src/cli/export.ts --region "$REGION" --limit "$LIMIT" --bbox "$BBOX" --routes-only --no-cleanup --out "$OUTPUT_DIR/staging-routes.geojson"
else
    npx ts-node src/cli/export.ts --region "$REGION" --limit "$LIMIT" --routes-only --no-cleanup --out "$OUTPUT_DIR/staging-routes.geojson"
fi

echo -e "${GREEN}✅ Staging environment created${NC}"

# Step 2: Run connectivity analysis
echo -e "${BLUE}🔍 Step 2: Running connectivity analysis...${NC}"

# Run dry-run analysis to identify potential connectors
npx ts-node src/cli/analyze-connectivity.ts \
    --region "$REGION" \
    --dry-run \
    --max-connectors 50 \
    --min-impact-score 30 \
    --export-visualization "$OUTPUT_DIR/potential-connectors.geojson" \
    --output "$OUTPUT_DIR/connectivity-analysis.json"

echo -e "${GREEN}✅ Connectivity analysis complete${NC}"

# Step 3: Display results summary
echo -e "${BLUE}📊 Step 3: Analysis Summary${NC}"
echo "=================================="

if [ -f "$OUTPUT_DIR/connectivity-analysis.json" ]; then
    echo -e "${GREEN}✅ Analysis results saved to: $OUTPUT_DIR/connectivity-analysis.json${NC}"
fi

if [ -f "$OUTPUT_DIR/potential-connectors.geojson" ]; then
    echo -e "${GREEN}✅ Visualization data saved to: $OUTPUT_DIR/potential-connectors.geojson${NC}"
    echo -e "${YELLOW}💡 Open the GeoJSON file in a mapping tool to see potential connectors${NC}"
fi

if [ -f "$OUTPUT_DIR/staging-routes.geojson" ]; then
    echo -e "${GREEN}✅ Staging routes saved to: $OUTPUT_DIR/staging-routes.geojson${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Network connectivity analysis workflow complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review the potential connectors in the GeoJSON file"
echo "2. Decide which connectors to implement"
echo "3. Run the analyzer with --add-connectors-to-staging to test them"
echo "4. Re-run route generation to see the improvements" 