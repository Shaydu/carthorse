const fs = require('fs');

// Read the network components visualization
const geojsonPath = 'test-output/network-components-visualization.geojson';
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

console.log('=== T/Y Intersection Edge Case Analysis ===\n');

// Filter out the corrupted "undefined" component and focus on valid data
const validFeatures = data.features.filter(feature => {
  const props = feature.properties;
  return props.source !== undefined && 
         props.target !== undefined && 
         props.edge_component !== 'undefined';
});

console.log(`Total features: ${data.features.length}`);
console.log(`Valid features: ${validFeatures.length}`);
console.log(`Corrupted features: ${data.features.length - validFeatures.length}`);
console.log('');

// Analyze the valid components
const validComponents = {};
validFeatures.forEach(feature => {
  const props = feature.properties;
  const component = props.edge_component;
  
  if (!validComponents[component]) {
    validComponents[component] = {
      edges: [],
      nodes: new Set(),
      trailNames: new Set(),
      colors: new Set()
    };
  }
  
  validComponents[component].edges.push({
    source: props.source,
    target: props.target,
    trailName: props.trail_name,
    color: props.color,
    sourceComponent: props.source_component,
    targetComponent: props.target_component
  });
  
  validComponents[component].nodes.add(props.source);
  validComponents[component].nodes.add(props.target);
  validComponents[component].trailNames.add(props.trail_name);
  validComponents[component].colors.add(props.color);
});

console.log('=== Valid Component Analysis ===');
Object.entries(validComponents).forEach(([componentId, info]) => {
  console.log(`Component ${componentId}:`);
  console.log(`  Edges: ${info.edges.length}`);
  console.log(`  Unique nodes: ${info.nodes.size}`);
  console.log(`  Trail names: ${info.trailNames.size}`);
  console.log(`  Color: ${Array.from(info.colors).join(', ')}`);
  console.log('');
});

// Find potential T/Y intersection edge cases
console.log('=== Potential T/Y Intersection Edge Cases ===');

// Build node connectivity for valid components
const nodeConnections = new Map();
validFeatures.forEach(feature => {
  const props = feature.properties;
  const source = props.source;
  const target = props.target;
  
  if (!nodeConnections.has(source)) {
    nodeConnections.set(source, { 
      connections: [], 
      component: props.source_component,
      trails: new Set()
    });
  }
  if (!nodeConnections.has(target)) {
    nodeConnections.set(target, { 
      connections: [], 
      component: props.target_component,
      trails: new Set()
    });
  }
  
  nodeConnections.get(source).connections.push({ 
    node: target, 
    trail: props.trail_name,
    component: props.target_component
  });
  nodeConnections.get(target).connections.push({ 
    node: source, 
    trail: props.trail_name,
    component: props.source_component
  });
  
  nodeConnections.get(source).trails.add(props.trail_name);
  nodeConnections.get(target).trails.add(props.trail_name);
});

// Find nodes that could be T/Y intersections but aren't being detected
const potentialTYNodes = [];
nodeConnections.forEach((nodeInfo, nodeId) => {
  if (nodeInfo.connections.length >= 3) {
    // Node with 3+ connections - potential T/Y intersection
    const connectedComponents = new Set();
    nodeInfo.connections.forEach(conn => {
      connectedComponents.add(conn.component);
    });
    
    // If this node connects to multiple components, it should be a T/Y intersection
    if (connectedComponents.size > 1) {
      potentialTYNodes.push({
        nodeId,
        connections: nodeInfo.connections.length,
        components: Array.from(connectedComponents),
        trails: Array.from(nodeInfo.trails),
        nodeComponent: nodeInfo.component
      });
    }
  }
});

console.log(`Found ${potentialTYNodes.length} nodes that should be T/Y intersections:`);
potentialTYNodes.forEach(node => {
  console.log(`  Node ${node.nodeId} (Component ${node.nodeComponent}):`);
  console.log(`    Connections: ${node.connections}`);
  console.log(`    Connected to components: ${node.components.join(', ')}`);
  console.log(`    Trails: ${node.trails.slice(0, 5).join(', ')}${node.trails.length > 5 ? '...' : ''}`);
  console.log('');
});

// Analyze why these T/Y intersections aren't being detected
console.log('=== Why T/Y Intersections Are Being Missed ===');

if (potentialTYNodes.length > 0) {
  console.log('The following edge cases are likely being missed:');
  console.log('');
  
  potentialTYNodes.forEach(node => {
    console.log(`Node ${node.nodeId}:`);
    console.log(`  - Has ${node.connections} connections to ${node.components.length} different components`);
    console.log(`  - Should be detected as a T/Y intersection but isn't`);
    console.log(`  - Possible reasons:`);
    console.log(`    * Trails are close but don't exactly intersect geometrically`);
    console.log(`    * Intersection tolerance is too strict`);
    console.log(`    * Trails are split but not properly connected at this node`);
    console.log(`    * Component assignment is incorrect for this node`);
    console.log('');
  });
} else {
  console.log('No obvious T/Y intersection edge cases found in valid data.');
  console.log('The issue may be in the corrupted "undefined" component.');
}

// Check for near-miss intersections
console.log('=== Near-Miss Intersection Analysis ===');

// Look for trails that might be close but not intersecting
const nearMissCandidates = [];
for (let i = 0; i < validFeatures.length; i++) {
  for (let j = i + 1; j < validFeatures.length; j++) {
    const trail1 = validFeatures[i];
    const trail2 = validFeatures[j];
    
    // Only check trails from different components
    if (trail1.properties.edge_component !== trail2.properties.edge_component) {
      // Check if trails have similar names or are in similar areas
      const name1 = trail1.properties.trail_name.toLowerCase();
      const name2 = trail2.properties.trail_name.toLowerCase();
      
      // Look for trails that might be related
      if (name1.includes('connector') || name2.includes('connector') ||
          name1.includes('spur') || name2.includes('spur') ||
          name1.includes('trail') && name2.includes('trail')) {
        
        nearMissCandidates.push({
          trail1: trail1.properties.trail_name,
          trail2: trail2.properties.trail_name,
          component1: trail1.properties.edge_component,
          component2: trail2.properties.edge_component
        });
      }
    }
  }
}

console.log(`Found ${nearMissCandidates.length} potential near-miss intersection candidates:`);
nearMissCandidates.slice(0, 10).forEach(candidate => {
  console.log(`  ${candidate.trail1} (Component ${candidate.component1}) ↔ ${candidate.trail2} (Component ${candidate.component2})`);
});

// Recommendations for fixing the edge cases
console.log('\n=== Recommendations for Fixing Edge Cases ===');
console.log('');
console.log('1. INVESTIGATE THE "UNDEFINED" COMPONENT:');
console.log('   - 112 edges have corrupted data (undefined source/target)');
console.log('   - This suggests a bug in the component assignment process');
console.log('   - Fix the component assignment logic first');
console.log('');
console.log('2. ENHANCE NEAR-MISS DETECTION:');
console.log('   - Add ST_DWithin() detection for trails within 2-5 meters');
console.log('   - Use tolerance-based intersection detection');
console.log('   - Detect both exact and near-miss intersections');
console.log('');
console.log('3. IMPROVE T/Y INTERSECTION DETECTION:');
console.log('   - Look for nodes with 3+ connections to different components');
console.log('   - Ensure proper splitting at these intersection points');
console.log('   - Validate that split trails maintain connectivity');
console.log('');
console.log('4. ADD VALIDATION CHECKS:');
console.log('   - Verify that all edges have valid component assignments');
console.log('   - Check that no isolated components remain after splitting');
console.log('   - Ensure routing graph can be built from all components');
