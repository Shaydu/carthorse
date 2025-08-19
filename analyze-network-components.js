const fs = require('fs');

// Read the network components visualization
const geojsonPath = 'test-output/network-components-visualization.geojson';
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

console.log('=== Network Components Analysis ===\n');

// Analyze component distribution by color
const colorStats = {};
const componentStats = {};
const edgeComponentStats = {};

data.features.forEach(feature => {
  const props = feature.properties;
  const color = props.color;
  const sourceComponent = props.source_component;
  const targetComponent = props.target_component;
  const edgeComponent = props.edge_component;
  const trailName = props.trail_name;
  
  // Count by color
  if (!colorStats[color]) {
    colorStats[color] = {
      count: 0,
      trailNames: new Set(),
      components: new Set()
    };
  }
  colorStats[color].count++;
  colorStats[color].trailNames.add(trailName);
  colorStats[color].components.add(edgeComponent);
  
  // Count by component
  if (!componentStats[edgeComponent]) {
    componentStats[edgeComponent] = {
      count: 0,
      colors: new Set(),
      trailNames: new Set()
    };
  }
  componentStats[edgeComponent].count++;
  componentStats[edgeComponent].colors.add(color);
  componentStats[edgeComponent].trailNames.add(trailName);
  
  // Check for potential T/Y intersection issues
  if (sourceComponent !== targetComponent) {
    console.log(`⚠️  Potential T/Y intersection detected:`);
    console.log(`   Trail: ${trailName}`);
    console.log(`   Source component: ${sourceComponent}, Target component: ${targetComponent}`);
    console.log(`   Edge component: ${edgeComponent}`);
    console.log(`   Color: ${color}`);
    console.log('');
  }
});

console.log('=== Component Distribution by Color ===');
Object.entries(colorStats)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([color, stats]) => {
    console.log(`Color: ${color}`);
    console.log(`  Edge count: ${stats.count}`);
    console.log(`  Unique components: ${stats.components.size}`);
    console.log(`  Unique trail names: ${stats.trailNames.size}`);
    console.log('');
  });

console.log('=== Component Distribution by Component ID ===');
Object.entries(componentStats)
  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([componentId, stats]) => {
    console.log(`Component ${componentId}:`);
    console.log(`  Edge count: ${stats.count}`);
    console.log(`  Colors: ${Array.from(stats.colors).join(', ')}`);
    console.log(`  Trail names: ${Array.from(stats.trailNames).slice(0, 5).join(', ')}${stats.trailNames.size > 5 ? '...' : ''}`);
    console.log('');
  });

// Find disconnected components (components with only one color)
const disconnectedComponents = Object.entries(componentStats)
  .filter(([id, stats]) => stats.colors.size === 1)
  .map(([id, stats]) => ({
    componentId: id,
    color: Array.from(stats.colors)[0],
    edgeCount: stats.count,
    trailNames: Array.from(stats.trailNames)
  }));

console.log('=== Disconnected Components (Single Color) ===');
disconnectedComponents.forEach(comp => {
  console.log(`Component ${comp.componentId} (${comp.color}):`);
  console.log(`  Edge count: ${comp.edgeCount}`);
  console.log(`  Trail names: ${comp.trailNames.slice(0, 10).join(', ')}${comp.trailNames.length > 10 ? '...' : ''}`);
  console.log('');
});

console.log(`Total disconnected components: ${disconnectedComponents.length}`);
console.log(`Total components: ${Object.keys(componentStats).length}`);
console.log(`Total edges: ${data.features.length}`);

// Find potential T/Y intersections by looking for edges that connect different components
const crossComponentEdges = data.features.filter(feature => {
  const props = feature.properties;
  return props.source_component !== props.target_component;
});

console.log(`\n=== Cross-Component Edges (Potential T/Y Intersections) ===`);
console.log(`Found ${crossComponentEdges.length} edges that connect different components:`);

crossComponentEdges.forEach(edge => {
  const props = edge.properties;
  console.log(`- ${props.trail_name}: Component ${props.source_component} → ${props.target_component} (Edge component: ${props.edge_component})`);
});
