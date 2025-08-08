#!/bin/bash

# Create Comprehensive Connector Visualization
# Shows existing routes and proposed connectors in different colors

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎨 Creating Comprehensive Connector Visualization${NC}"
echo "====================================================="

# Configuration
BBOX="-105.35545816139866,39.86840223651447,-105.20922413855001,40.01750391845792"
REGION="boulder"
OUTPUT_DIR="bbox-connectivity-analysis"
TOLERANCE="50"  # 50m tolerance for broader detection

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}📊 Step 1: Generate existing routes${NC}"
echo "Running orchestrator to create staging environment..."

# Generate routes and staging environment
npx ts-node src/cli/export.ts \
    --region "$REGION" \
    --bbox "$BBOX" \
    --routes-only \
    --no-cleanup \
    --out "$OUTPUT_DIR/existing-routes.geojson"

echo -e "${GREEN}✅ Existing routes generated${NC}"

echo -e "${BLUE}🔍 Step 2: Run connectivity analysis with 50m tolerance${NC}"

# Run connectivity analysis
npx ts-node src/cli/analyze-connectivity.ts \
    --region "$REGION" \
    --dry-run \
    --max-connection-distance "$TOLERANCE" \
    --intersection-tolerance 10 \
    --endpoint-tolerance 20 \
    --min-impact-score 10 \
    --analyze-missing-trails \
    --export-visualization "$OUTPUT_DIR/proposed-connectors.geojson" \
    --output "$OUTPUT_DIR/connectivity-analysis.json"

echo -e "${GREEN}✅ Connectivity analysis complete${NC}"

echo -e "${BLUE}🎨 Step 3: Create combined visualization${NC}"

# Create a combined visualization script
cat > "$OUTPUT_DIR/combine-visualization.js" << 'EOF'
const fs = require('fs');
const path = require('path');

// Read existing routes
const existingRoutesPath = path.join(__dirname, 'existing-routes.geojson');
const proposedConnectorsPath = path.join(__dirname, 'proposed-connectors.geojson');
const combinedOutputPath = path.join(__dirname, 'combined-visualization.geojson');

let existingRoutes = { type: 'FeatureCollection', features: [] };
let proposedConnectors = { type: 'FeatureCollection', features: [] };

// Read existing routes
if (fs.existsSync(existingRoutesPath)) {
  existingRoutes = JSON.parse(fs.readFileSync(existingRoutesPath, 'utf8'));
  console.log(`📊 Loaded ${existingRoutes.features.length} existing route features`);
}

// Read proposed connectors
if (fs.existsSync(proposedConnectorsPath)) {
  proposedConnectors = JSON.parse(fs.readFileSync(proposedConnectorsPath, 'utf8'));
  console.log(`🔗 Loaded ${proposedConnectors.features.length} proposed connector features`);
}

// Style existing routes (orange, dotted)
existingRoutes.features.forEach(feature => {
  feature.properties = feature.properties || {};
  feature.properties.style = 'existing-route';
  feature.properties.color = '#FF8C00'; // Orange
  feature.properties.weight = 3;
  feature.properties.opacity = 0.8;
  feature.properties.dashArray = '5,5'; // Dotted
});

// Style proposed connectors (red, solid, bold)
proposedConnectors.features.forEach(feature => {
  feature.properties = feature.properties || {};
  feature.properties.style = 'proposed-connector';
  feature.properties.color = '#FF0000'; // Red
  feature.properties.weight = 5;
  feature.properties.opacity = 1.0;
  feature.properties.dashArray = null; // Solid
});

// Combine features
const combinedFeatures = [
  ...existingRoutes.features,
  ...proposedConnectors.features
];

const combinedGeoJSON = {
  type: 'FeatureCollection',
  features: combinedFeatures,
  properties: {
    title: 'BBox Connectivity Analysis',
    description: 'Existing routes (orange, dotted) and proposed connectors (red, solid)',
    legend: {
      'existing-route': { color: '#FF8C00', description: 'Existing Routes (Orange, Dotted)' },
      'proposed-connector': { color: '#FF0000', description: 'Proposed Connectors (Red, Solid)' }
    }
  }
};

// Write combined visualization
fs.writeFileSync(combinedOutputPath, JSON.stringify(combinedGeoJSON, null, 2));
console.log(`✅ Combined visualization saved to: ${combinedOutputPath}`);
console.log(`📊 Total features: ${combinedFeatures.length}`);
console.log(`🎨 Legend:`);
console.log(`   🟠 Existing Routes: Orange, dotted lines`);
console.log(`   🔴 Proposed Connectors: Red, solid lines`);
EOF

# Run the visualization script
node "$OUTPUT_DIR/combine-visualization.js"

echo -e "${GREEN}✅ Visualization complete!${NC}"
echo ""
echo -e "${YELLOW}📁 Generated Files:${NC}"
echo "  • $OUTPUT_DIR/existing-routes.geojson - Existing routes (orange, dotted)"
echo "  • $OUTPUT_DIR/proposed-connectors.geojson - Proposed connectors (red, solid)"
echo "  • $OUTPUT_DIR/combined-visualization.geojson - Combined visualization"
echo "  • $OUTPUT_DIR/connectivity-analysis.json - Analysis results"
echo ""
echo -e "${YELLOW}💡 Next Steps:${NC}"
echo "1. Open combined-visualization.geojson in a mapping tool"
echo "2. Look for red solid lines - these are proposed connectors"
echo "3. Compare with orange dotted lines - these are existing routes"
echo "4. Assess how the proposed connectors would improve connectivity" 