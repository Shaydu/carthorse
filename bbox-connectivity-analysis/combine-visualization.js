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