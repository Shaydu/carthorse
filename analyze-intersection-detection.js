const fs = require('fs');

// Read the network components visualization
const geojsonPath = 'test-output/network-components-visualization.geojson';
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

console.log('=== T/Y Intersection Detection Analysis ===\n');

// Analyze the intersection detection logic issues
console.log('=== Current Intersection Detection Logic Issues ===');

console.log('1. PROBLEM: The current intersection detection uses:');
console.log('   - ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))');
console.log('   - This only detects EXACT geometric intersections');
console.log('   - It misses T/Y intersections where trails are close but don\'t exactly intersect');
console.log('');

console.log('2. PROBLEM: The splitting logic uses:');
console.log('   - ST_Split(t.geometry, ti.intersection_point)');
console.log('   - This only splits at exact intersection points');
console.log('   - It doesn\'t handle near-miss intersections that should be connected');
console.log('');

console.log('3. PROBLEM: Component assignment shows:');
console.log('   - 3 disconnected components with different colors');
console.log('   - 1 "undefined" component with 112 edges (data corruption)');
console.log('   - No cross-component edges detected');
console.log('');

// Analyze the actual trail data to find potential T/Y intersections
console.log('=== Analyzing Trail Data for T/Y Intersections ===');

// Group trails by component
const trailsByComponent = {};
data.features.forEach(feature => {
  const props = feature.properties;
  const component = props.edge_component;
  const trailName = props.trail_name;
  
  if (!trailsByComponent[component]) {
    trailsByComponent[component] = [];
  }
  
  trailsByComponent[component].push({
    trailName,
    source: props.source,
    target: props.target,
    sourceComponent: props.source_component,
    targetComponent: props.target_component,
    geometry: feature.geometry
  });
});

console.log('Component distribution:');
Object.entries(trailsByComponent).forEach(([component, trails]) => {
  console.log(`  Component ${component}: ${trails.length} edges`);
  if (component === 'undefined') {
    console.log(`    ⚠️  UNDEFINED COMPONENT - Data corruption detected`);
  }
});

// Find potential T/Y intersections by analyzing trail endpoints
console.log('\n=== Potential T/Y Intersection Analysis ===');

const allNodes = new Map();
const nodeConnections = new Map();

// Build node connectivity map
data.features.forEach(feature => {
  const props = feature.properties;
  const source = props.source;
  const target = props.target;
  
  if (!allNodes.has(source)) {
    allNodes.set(source, { connections: [], component: props.source_component });
  }
  if (!allNodes.has(target)) {
    allNodes.set(target, { connections: [], component: props.target_component });
  }
  
  allNodes.get(source).connections.push({ node: target, trail: props.trail_name });
  allNodes.get(target).connections.push({ node: source, trail: props.trail_name });
});

// Find nodes that could be T/Y intersections
const potentialTYIntersections = [];
allNodes.forEach((nodeInfo, nodeId) => {
  if (nodeInfo.connections.length >= 3) {
    // Node with 3+ connections could be a T/Y intersection
    const connectedComponents = new Set();
    nodeInfo.connections.forEach(conn => {
      const targetNode = allNodes.get(conn.node);
      if (targetNode) {
        connectedComponents.add(targetNode.component);
      }
    });
    
    if (connectedComponents.size > 1) {
      potentialTYIntersections.push({
        nodeId,
        connections: nodeInfo.connections.length,
        components: Array.from(connectedComponents),
        trails: nodeInfo.connections.map(c => c.trail)
      });
    }
  }
});

console.log(`Found ${potentialTYIntersections.length} potential T/Y intersection nodes:`);
potentialTYIntersections.forEach(intersection => {
  console.log(`  Node ${intersection.nodeId}:`);
  console.log(`    Connections: ${intersection.connections}`);
  console.log(`    Components: ${intersection.components.join(', ')}`);
  console.log(`    Trails: ${intersection.trails.slice(0, 3).join(', ')}${intersection.trails.length > 3 ? '...' : ''}`);
  console.log('');
});

// Analyze the "undefined" component issue
console.log('=== "Undefined" Component Analysis ===');
const undefinedComponent = trailsByComponent['undefined'];
if (undefinedComponent) {
  console.log('The "undefined" component contains edges with:');
  console.log('  - source: undefined');
  console.log('  - target: undefined');
  console.log('  - source_component: undefined');
  console.log('  - target_component: undefined');
  console.log('  - edge_component: undefined');
  console.log('');
  console.log('This indicates a serious data corruption issue in the component assignment process.');
  console.log('');
}

// Recommendations for fixing T/Y intersection detection
console.log('=== Recommendations for Fixing T/Y Intersection Detection ===');
console.log('');
console.log('1. ENHANCE INTERSECTION DETECTION:');
console.log('   - Add near-miss detection using ST_DWithin()');
console.log('   - Use tolerance-based intersection detection (e.g., 2-5 meters)');
console.log('   - Detect both exact intersections and close proximity intersections');
console.log('');
console.log('2. IMPROVE SPLITTING LOGIC:');
console.log('   - Split trails at near-miss points, not just exact intersections');
console.log('   - Use ST_LineSubstring() with calculated split ratios');
console.log('   - Handle both point and line intersections');
console.log('');
console.log('3. FIX COMPONENT ASSIGNMENT:');
console.log('   - Investigate why 112 edges have "undefined" component values');
console.log('   - Ensure proper component assignment after splitting');
console.log('   - Validate that all edges have valid component assignments');
console.log('');
console.log('4. ADD T/Y INTERSECTION SPECIFIC LOGIC:');
console.log('   - Detect trails that form T or Y shapes');
console.log('   - Identify intersection points where 3+ trails meet');
console.log('   - Ensure proper splitting at these intersection points');
console.log('');
console.log('5. VALIDATE CONNECTIVITY:');
console.log('   - After splitting, verify that components are properly connected');
console.log('   - Check that no isolated components remain');
console.log('   - Ensure routing graph can be built from split trails');
