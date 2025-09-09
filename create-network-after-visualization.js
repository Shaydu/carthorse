#!/usr/bin/env node

const fs = require('fs');

// Load the balanced model predictions
const predictionsData = JSON.parse(fs.readFileSync('test-output/balanced_graphsage_predictions.json', 'utf8'));
const predictions = predictionsData.predictions;

console.log('🗺️  Creating "After" Network Visualization...');
console.log(`📈 Loaded ${predictions.length} predictions from balanced model`);

// Count recommendations
let splitCount = 0;
let mergeCount = 0;
let keepCount = 0;

predictions.forEach(pred => {
  if (pred === 0) keepCount++;
  else if (pred === 1) mergeCount++;
  else if (pred === 2) splitCount++;
});

console.log(`\n📊 GraphSAGE Recommendations:`);
console.log(`   • Keep as-is: ${keepCount} nodes (${(keepCount/predictions.length*100).toFixed(1)}%)`);
console.log(`   • Merge degree-2: ${mergeCount} nodes (${(mergeCount/predictions.length*100).toFixed(1)}%)`);
console.log(`   • Split Y/T: ${splitCount} nodes (${(splitCount/predictions.length*100).toFixed(1)}%)`);

// Create a simple visualization of what the network would look like after
const networkAfter = {
  type: "FeatureCollection",
  features: []
};

// Add features for each recommendation type
predictions.forEach((prediction, index) => {
  const feature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [0, 0, 0] // Placeholder - would need actual coordinates
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
      marker_size: prediction === 0 ? "small" : "large"
    }
  };
  
  networkAfter.features.push(feature);
});

// Save the visualization
const outputPath = `test-output/network-after-graphsage-${Date.now()}.geojson`;
fs.writeFileSync(outputPath, JSON.stringify(networkAfter, null, 2));

console.log(`\n💾 Network "After" visualization saved: ${outputPath}`);

// Create a summary of what would happen
const summary = {
  timestamp: new Date().toISOString(),
  model_type: 'BalancedGraphSAGE',
  total_nodes: predictions.length,
  actions: {
    no_change: keepCount,
    merge_operations: mergeCount,
    split_operations: splitCount
  },
  impact: {
    nodes_removed: mergeCount, // Degree-2 nodes that would be merged out
    nodes_added: splitCount * 2, // Each split creates ~2 new nodes
    net_change: (splitCount * 2) - mergeCount,
    total_operations: mergeCount + splitCount
  }
};

const summaryPath = `test-output/network-after-summary-${Date.now()}.json`;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`\n📋 Network Impact Summary:`);
console.log(`   • Nodes to be merged out: ${summary.impact.nodes_removed}`);
console.log(`   • New nodes from splits: ~${summary.impact.nodes_added}`);
console.log(`   • Net change in nodes: ${summary.impact.net_change > 0 ? '+' : ''}${summary.impact.net_change}`);
console.log(`   • Total operations: ${summary.impact.total_operations}`);

console.log(`\n🔧 What GraphSAGE would do to your network:`);
console.log(`   1. MERGE ${mergeCount} degree-2 nodes:`);
console.log(`      → Remove unnecessary intermediate nodes`);
console.log(`      → Connect their neighbors directly`);
console.log(`      → Simplify the network topology`);

console.log(`\n   2. SPLIT ${splitCount} Y/T intersections:`);
console.log(`      → Break complex intersections into simpler ones`);
console.log(`      → Create more precise routing points`);
console.log(`      → Improve navigation accuracy`);

console.log(`\n   3. KEEP ${keepCount} nodes unchanged:`);
console.log(`      → Preserve important intersections`);
console.log(`      → Maintain network connectivity`);

if (splitCount > 0) {
  console.log(`\n⚠️  Note: ${splitCount} nodes (${(splitCount/predictions.length*100).toFixed(1)}%) recommended for splitting`);
  console.log(`   This seems high - you might want to review these recommendations`);
  console.log(`   or increase the confidence threshold for split operations`);
}

console.log(`\n📁 Files created:`);
console.log(`   🗺️  Network visualization: ${outputPath}`);
console.log(`   📋 Impact summary: ${summaryPath}`);

