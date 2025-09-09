const fs = require('fs');
const path = require('path');

// Load the GraphSAGE data to get actual coordinates
const graphsageDataPath = 'test-output/graphsage-data-carthorse_1757374516388-2025-09-08T23-52-58-908Z.json';
const predictionsPath = 'test-output/high_confidence_graphsage_predictions.json';

console.log('Loading GraphSAGE data and predictions...');

const graphsageData = JSON.parse(fs.readFileSync(graphsageDataPath, 'utf8'));
const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));

console.log(`Loaded ${graphsageData.x.length} nodes with ${graphsageData.edge_index.length} edges`);
console.log(`Loaded ${predictions.predictions.length} predictions`);

// Create visualization with actual coordinates
const features = [];

// Add nodes with their actual coordinates
graphsageData.x.forEach((nodeFeatures, nodeId) => {
  const prediction = predictions.predictions[nodeId];
  const [lng, lat, elevation, degree, avgEdgeLength] = nodeFeatures;
  
  let color, action, markerSize, markerSymbol;
  
  if (prediction === 0) {
    color = '#00FF00'; // Green for keep
    action = 'Keep as-is';
    markerSize = 'small';
    markerSymbol = 'circle';
  } else if (prediction === 1) {
    color = '#FF0000'; // Red for merge
    action = 'Merge degree-2';
    markerSize = 'medium';
    markerSymbol = 'square';
  } else if (prediction === 2) {
    color = '#0000FF'; // Blue for split
    action = 'Split Y/T intersection';
    markerSize = 'large';
    markerSymbol = 'triangle';
  }
  
  features.push({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lng, lat, elevation]
    },
    properties: {
      node_id: nodeId,
      prediction: prediction,
      label: prediction === 0 ? 'Keep as-is' : prediction === 1 ? 'Merge degree-2' : 'Split Y/T intersection',
      action: action,
      color: color,
      marker_size: markerSize,
      marker_symbol: markerSymbol,
      degree: degree,
      avg_edge_length: avgEdgeLength,
      coordinates: `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    }
  });
});

// Add edges as LineString features
const edgeMap = new Map();
// edge_index is a flat array: [source1, target1, source2, target2, ...]
for (let i = 0; i < graphsageData.edge_index.length; i += 2) {
  const source = graphsageData.edge_index[i];
  const target = graphsageData.edge_index[i + 1];
  
  const sourceNode = graphsageData.x[source];
  const targetNode = graphsageData.x[target];
  
  if (sourceNode && targetNode) {
    const edgeKey = `${Math.min(source, target)}-${Math.max(source, target)}`;
    if (!edgeMap.has(edgeKey)) {
      edgeMap.set(edgeKey, {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [sourceNode[0], sourceNode[1], sourceNode[2]], // [lng, lat, elevation]
            [targetNode[0], targetNode[1], targetNode[2]]
          ]
        },
        properties: {
          source_node: source,
          target_node: target,
          edge_type: 'network_connection',
          color: '#888888',
          stroke_width: 1
        }
      });
    }
  }
}

// Add all edges to features
edgeMap.forEach(edge => features.push(edge));

// Create the GeoJSON
const geojson = {
  type: 'FeatureCollection',
  features: features
};

// Save the visualization
const timestamp = Date.now();
const outputPath = `test-output/network-AFTER-proper-${timestamp}.geojson`;
fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

// Create summary
const summary = {
  timestamp: new Date().toISOString(),
  model_type: 'HighConfidenceGraphSAGE',
  confidence_threshold: 0.98,
  visualization: {
    total_features: features.length,
    nodes: graphsageData.x.length,
    edges: edgeMap.size,
    split_recommendations: predictions.predictions.filter(p => p === 2).length,
    merge_recommendations: predictions.predictions.filter(p => p === 1).length,
    keep_recommendations: predictions.predictions.filter(p => p === 0).length
  },
  split_percentage: ((predictions.predictions.filter(p => p === 2).length / predictions.predictions.length) * 100).toFixed(1)
};

const summaryPath = `test-output/network-AFTER-summary-${timestamp}.json`;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`\n✅ Created proper AFTER visualization:`);
console.log(`📁 GeoJSON: ${outputPath}`);
console.log(`📊 Summary: ${summaryPath}`);
console.log(`\n📈 Network Statistics:`);
console.log(`   • Total nodes: ${summary.visualization.nodes}`);
console.log(`   • Total edges: ${summary.visualization.edges}`);
console.log(`   • Split recommendations: ${summary.visualization.split_recommendations} (${summary.split_percentage}%)`);
console.log(`   • Merge recommendations: ${summary.visualization.merge_recommendations}`);
console.log(`   • Keep as-is: ${summary.visualization.keep_recommendations}`);
console.log(`\n🎨 Visualization Features:`);
console.log(`   • Green circles: Keep as-is nodes`);
console.log(`   • Blue triangles: Split Y/T intersection nodes`);
console.log(`   • Red squares: Merge degree-2 nodes`);
console.log(`   • Gray lines: Network edges`);
console.log(`\n💡 This shows the actual network structure with real coordinates!`);
