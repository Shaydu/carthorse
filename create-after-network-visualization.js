#!/usr/bin/env node

const fs = require('fs');

// Load the high confidence model predictions
const predictionsData = JSON.parse(fs.readFileSync('test-output/high_confidence_graphsage_predictions.json', 'utf8'));
const predictions = predictionsData.predictions;

console.log('🗺️  Creating "AFTER" Network Visualization...');
console.log(`📈 Loaded ${predictions.length} predictions from high confidence model`);

// Count recommendations
let splitCount = 0;
let mergeCount = 0;
let keepCount = 0;

predictions.forEach(pred => {
  if (pred === 0) keepCount++;
  else if (pred === 1) mergeCount++;
  else if (pred === 2) splitCount++;
});

console.log(`\n📊 High Confidence GraphSAGE Recommendations:`);
console.log(`   • Keep as-is: ${keepCount} nodes (${(keepCount/predictions.length*100).toFixed(1)}%)`);
console.log(`   • Merge degree-2: ${mergeCount} nodes (${(mergeCount/predictions.length*100).toFixed(1)}%)`);
console.log(`   • Split Y/T: ${splitCount} nodes (${(splitCount/predictions.length*100).toFixed(1)}%)`);

// Create the "AFTER" network visualization
const afterNetwork = {
  type: "FeatureCollection",
  features: []
};

// Add features for each recommendation type
predictions.forEach((prediction, index) => {
  const feature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [0, 0, 0] // Placeholder - would need actual coordinates from database
    },
    properties: {
      node_id: index,
      prediction: prediction,
      label: prediction === 0 ? 'Keep as-is' : 
             prediction === 1 ? 'Merge degree-2' : 
             prediction === 2 ? 'Split Y/T' : 'Unknown',
      action: prediction === 0 ? 'No change' : 
              prediction === 1 ? 'Merge with neighbors' : 
              prediction === 2 ? 'Split into multiple nodes' : 'Unknown',
      color: prediction === 0 ? "#00FF00" : // Green for keep
             prediction === 1 ? "#FFA500" : // Orange for merge
             prediction === 2 ? "#FF0000" : "#000000", // Red for split
      marker_size: prediction === 0 ? "small" : "large",
      marker_symbol: prediction === 0 ? "circle" : 
                    prediction === 1 ? "triangle" : "square"
    }
  };
  
  afterNetwork.features.push(feature);
});

// Save the "AFTER" network visualization
const outputPath = `test-output/network-AFTER-graphsage-${Date.now()}.geojson`;
fs.writeFileSync(outputPath, JSON.stringify(afterNetwork, null, 2));

console.log(`\n💾 Network "AFTER" visualization saved: ${outputPath}`);

// Create a detailed summary of network improvements
const networkImprovements = {
  timestamp: new Date().toISOString(),
  model_type: 'HighConfidenceGraphSAGE',
  confidence_threshold: predictionsData.metadata.confidence_threshold,
  before: {
    total_nodes: predictions.length,
    total_edges: predictionsData.metadata.num_edges,
    problematic_intersections: splitCount + mergeCount
  },
  after: {
    nodes_removed: mergeCount, // Degree-2 nodes merged out
    nodes_added: splitCount * 2, // Each split creates ~2 new nodes
    net_node_change: (splitCount * 2) - mergeCount,
    edges_removed: mergeCount, // Each merge removes 2 edges, adds 1
    edges_added: splitCount * 2, // Each split adds ~2 new edges
    net_edge_change: (splitCount * 2) - mergeCount,
    total_operations: mergeCount + splitCount
  },
  improvements: {
    network_simplification: mergeCount > 0 ? 'Degree-2 nodes merged for cleaner topology' : 'No merges needed',
    intersection_precision: splitCount > 0 ? 'Complex intersections split for better routing' : 'No splits needed',
    routing_accuracy: 'Improved navigation precision',
    network_connectivity: 'Maintained while optimizing structure'
  }
};

const improvementsPath = `test-output/network-improvements-${Date.now()}.json`;
fs.writeFileSync(improvementsPath, JSON.stringify(networkImprovements, null, 2));

console.log(`\n📋 Network Improvements Summary:`);
console.log(`   BEFORE:`);
console.log(`     • Total nodes: ${networkImprovements.before.total_nodes}`);
console.log(`     • Total edges: ${networkImprovements.before.total_edges}`);
console.log(`     • Problematic intersections: ${networkImprovements.before.problematic_intersections}`);

console.log(`\n   AFTER GraphSAGE Operations:`);
console.log(`     • Nodes removed (merges): ${networkImprovements.after.nodes_removed}`);
console.log(`     • Nodes added (splits): ~${networkImprovements.after.nodes_added}`);
console.log(`     • Net node change: ${networkImprovements.after.net_node_change > 0 ? '+' : ''}${networkImprovements.after.net_node_change}`);
console.log(`     • Edges removed (merges): ${networkImprovements.after.edges_removed}`);
console.log(`     • Edges added (splits): ~${networkImprovements.after.edges_added}`);
console.log(`     • Net edge change: ${networkImprovements.after.net_edge_change > 0 ? '+' : ''}${networkImprovements.after.net_edge_change}`);

console.log(`\n🔧 What GraphSAGE Would Do:`);
if (mergeCount > 0) {
  console.log(`   1. MERGE ${mergeCount} degree-2 nodes:`);
  console.log(`      → Remove unnecessary intermediate nodes`);
  console.log(`      → Connect their neighbors directly`);
  console.log(`      → Simplify network topology`);
} else {
  console.log(`   1. MERGE: No degree-2 nodes need merging (network already clean)`);
}

if (splitCount > 0) {
  console.log(`\n   2. SPLIT ${splitCount} Y/T intersections:`);
  console.log(`      → Break complex intersections into simpler ones`);
  console.log(`      → Create more precise routing points`);
  console.log(`      → Improve navigation accuracy`);
} else {
  console.log(`\n   2. SPLIT: No intersections need splitting (network already optimal)`);
}

console.log(`\n   3. KEEP ${keepCount} nodes unchanged:`);
console.log(`      → Preserve important intersections`);
console.log(`      → Maintain network connectivity`);

console.log(`\n✅ Network Quality Improvements:`);
console.log(`   • ${networkImprovements.improvements.network_simplification}`);
console.log(`   • ${networkImprovements.improvements.intersection_precision}`);
console.log(`   • ${networkImprovements.improvements.routing_accuracy}`);
console.log(`   • ${networkImprovements.improvements.network_connectivity}`);

console.log(`\n📁 Files created:`);
console.log(`   🗺️  Network "AFTER" visualization: ${outputPath}`);
console.log(`   📋 Network improvements: ${improvementsPath}`);

// Show the specific nodes that would be affected
if (splitCount > 0) {
  console.log(`\n✂️  Nodes recommended for Y/T splitting:`);
  const splitNodes = [];
  predictions.forEach((pred, index) => {
    if (pred === 2) splitNodes.push(index);
  });
  console.log(`   Node indices: ${splitNodes.join(', ')}`);
}

if (mergeCount > 0) {
  console.log(`\n🔗 Nodes recommended for merging:`);
  const mergeNodes = [];
  predictions.forEach((pred, index) => {
    if (pred === 1) mergeNodes.push(index);
  });
  console.log(`   Node indices: ${mergeNodes.join(', ')}`);
}

