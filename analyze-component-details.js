const fs = require('fs');

// Read the network components visualization
const geojsonPath = 'test-output/network-components-visualization.geojson';
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

console.log('=== Detailed Component Analysis ===\n');

// Examine the first few features to understand the structure
console.log('=== Sample Feature Properties ===');
data.features.slice(0, 5).forEach((feature, index) => {
  console.log(`Feature ${index + 1}:`);
  console.log(`  Trail: ${feature.properties.trail_name}`);
  console.log(`  Source: ${feature.properties.source}, Target: ${feature.properties.target}`);
  console.log(`  Source Component: ${feature.properties.source_component}, Target Component: ${feature.properties.target_component}`);
  console.log(`  Edge Component: ${feature.properties.edge_component}`);
  console.log(`  Color: ${feature.properties.color}`);
  console.log('');
});

// Analyze component connectivity
const componentConnections = {};
const nodeComponents = {};

data.features.forEach(feature => {
  const props = feature.properties;
  const source = props.source;
  const target = props.target;
  const sourceComponent = props.source_component;
  const targetComponent = props.target_component;
  const edgeComponent = props.edge_component;
  
  // Track which component each node belongs to
  if (!nodeComponents[source]) {
    nodeComponents[source] = new Set();
  }
  if (!nodeComponents[target]) {
    nodeComponents[target] = new Set();
  }
  nodeComponents[source].add(sourceComponent);
  nodeComponents[target].add(targetComponent);
  
  // Track component connections
  if (!componentConnections[edgeComponent]) {
    componentConnections[edgeComponent] = {
      edges: [],
      nodes: new Set(),
      sourceTargetPairs: new Set()
    };
  }
  
  componentConnections[edgeComponent].edges.push({
    source,
    target,
    sourceComponent,
    targetComponent,
    trailName: props.trail_name
  });
  
  componentConnections[edgeComponent].nodes.add(source);
  componentConnections[edgeComponent].nodes.add(target);
  componentConnections[edgeComponent].sourceTargetPairs.add(`${source}-${target}`);
});

console.log('=== Component Connectivity Analysis ===');
Object.entries(componentConnections).forEach(([componentId, info]) => {
  console.log(`Component ${componentId}:`);
  console.log(`  Edge count: ${info.edges.length}`);
  console.log(`  Unique nodes: ${info.nodes.size}`);
  console.log(`  Source-target pairs: ${info.sourceTargetPairs.size}`);
  
  // Check for nodes that appear in multiple components
  const multiComponentNodes = Array.from(info.nodes).filter(node => 
    nodeComponents[node] && nodeComponents[node].size > 1
  );
  
  if (multiComponentNodes.length > 0) {
    console.log(`  ⚠️  Nodes in multiple components: ${multiComponentNodes.join(', ')}`);
  }
  
  console.log('');
});

// Find nodes that belong to multiple components (potential T/Y intersections)
console.log('=== Nodes in Multiple Components (Potential T/Y Intersections) ===');
const multiComponentNodes = Object.entries(nodeComponents)
  .filter(([node, components]) => components.size > 1)
  .map(([node, components]) => ({
    node: parseInt(node),
    components: Array.from(components)
  }));

console.log(`Found ${multiComponentNodes.length} nodes that belong to multiple components:`);
multiComponentNodes.forEach(({node, components}) => {
  console.log(`Node ${node}: Components ${components.join(', ')}`);
  
  // Find edges connected to this node
  const connectedEdges = data.features.filter(feature => 
    feature.properties.source === node || feature.properties.target === node
  );
  
  console.log(`  Connected edges:`);
  connectedEdges.forEach(edge => {
    const props = edge.properties;
    console.log(`    ${props.trail_name}: ${props.source} → ${props.target} (Component: ${props.edge_component})`);
  });
  console.log('');
});

// Analyze the "undefined" component
const undefinedComponent = componentConnections['undefined'];
if (undefinedComponent) {
  console.log('=== Analysis of "undefined" Component ===');
  console.log(`Edge count: ${undefinedComponent.edges.length}`);
  console.log(`Unique nodes: ${undefinedComponent.nodes.size}`);
  
  // Sample some edges from the undefined component
  console.log('Sample edges from undefined component:');
  undefinedComponent.edges.slice(0, 10).forEach(edge => {
    console.log(`  ${edge.trailName}: ${edge.source} → ${edge.target} (Components: ${edge.sourceComponent} → ${edge.targetComponent})`);
  });
  console.log('');
}

// Check for edges where source and target components don't match
console.log('=== Edges with Mismatched Source/Target Components ===');
const mismatchedEdges = data.features.filter(feature => {
  const props = feature.properties;
  return props.source_component !== props.target_component;
});

console.log(`Found ${mismatchedEdges.length} edges with mismatched components:`);
mismatchedEdges.forEach(edge => {
  const props = edge.properties;
  console.log(`  ${props.trail_name}: ${props.source} → ${props.target}`);
  console.log(`    Source component: ${props.source_component}, Target component: ${props.target_component}`);
  console.log(`    Edge component: ${props.edge_component}`);
  console.log('');
});
