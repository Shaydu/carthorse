#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function visualizeComponents() {
  console.log('🎨 Visualizing components with new color scheme...\n');

  // Read the Layer 2 network GeoJSON
  const geojsonPath = path.join(__dirname, '../test-output/boulder-degree-colored-export-layer2-network.geojson');
  
  if (!fs.existsSync(geojsonPath)) {
    console.log('❌ Layer 2 network GeoJSON not found');
    return;
  }

  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Track node degrees and components
  const nodeDegrees = new Map();
  const nodeComponents = new Map();
  const edgeConnections = new Map();
  
  // First pass: count node degrees from edges
  geojson.features.forEach(feature => {
    if (feature.properties.type === 'edge') {
      const source = feature.properties.source;
      const target = feature.properties.target;
      
      // Count degrees
      nodeDegrees.set(source, (nodeDegrees.get(source) || 0) + 1);
      nodeDegrees.set(target, (nodeDegrees.get(target) || 0) + 1);
      
      // Track connections
      if (!edgeConnections.has(source)) {
        edgeConnections.set(source, new Set());
      }
      if (!edgeConnections.has(target)) {
        edgeConnections.set(target, new Set());
      }
      edgeConnections.get(source).add(target);
      edgeConnections.get(target).add(source);
    }
  });

  // Find connected components using BFS
  const visited = new Set();
  const components = [];
  let componentId = 0;

  function bfs(startNode) {
    const component = new Set();
    const queue = [startNode];
    visited.add(startNode);
    component.add(startNode);

    while (queue.length > 0) {
      const node = queue.shift();
      const neighbors = edgeConnections.get(node) || new Set();
      
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          component.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    
    return component;
  }

  // Find all components
  for (const nodeId of nodeDegrees.keys()) {
    if (!visited.has(nodeId)) {
      const component = bfs(nodeId);
      components.push(component);
      
      // Assign component ID to all nodes in this component
      for (const node of component) {
        nodeComponents.set(node, componentId);
      }
      componentId++;
    }
  }

  console.log(`📊 Found ${components.length} connected components:`);
  components.forEach((component, i) => {
    console.log(`   Component ${i}: ${component.size} nodes [${Array.from(component).sort((a,b) => a-b).join(', ')}]`);
  });

  // Update node colors based on degree and component
  geojson.features.forEach(feature => {
    if (feature.properties.type === 'edge_network_vertex') {
      const nodeId = parseInt(feature.properties.id);
      const degree = nodeDegrees.get(nodeId) || 0;
      const componentId = nodeComponents.get(nodeId) || 0;
      
      // New color scheme:
      // Red = degree 1 (endpoints)
      // Blue = degree 2 (pass-through)
      // Green = degree 3+ (intersections)
      let color, stroke;
      
      if (degree === 1) {
        color = '#FF0000'; // Red for endpoints
        stroke = '#FF0000';
      } else if (degree === 2) {
        color = '#0000FF'; // Blue for pass-through
        stroke = '#0000FF';
      } else {
        color = '#00FF00'; // Green for intersections
        stroke = '#00FF00';
      }
      
      // Update properties
      feature.properties.color = color;
      feature.properties.stroke = stroke;
      feature.properties.degree = degree.toString();
      feature.properties.component = componentId.toString();
      
      // Adjust radius based on degree
      if (degree === 1) {
        feature.properties.radius = 3;
        feature.properties.strokeWidth = 2;
      } else if (degree === 2) {
        feature.properties.radius = 4;
        feature.properties.strokeWidth = 2;
      } else {
        feature.properties.radius = 6;
        feature.properties.strokeWidth = 3;
      }
    }
  });

  // Add component information to edge properties
  geojson.features.forEach(feature => {
    if (feature.properties.type === 'edge') {
      const source = feature.properties.source;
      const target = feature.properties.target;
      const sourceComponent = nodeComponents.get(source) || 0;
      const targetComponent = nodeComponents.get(target) || 0;
      
      feature.properties.source_component = sourceComponent.toString();
      feature.properties.target_component = targetComponent.toString();
      feature.properties.same_component = (sourceComponent === targetComponent).toString();
      
      // Color edges based on component connectivity
      if (sourceComponent === targetComponent) {
        feature.properties.color = '#4169E1'; // Blue for same component
        feature.properties.stroke = '#4169E1';
      } else {
        feature.properties.color = '#FF0000'; // Red for cross-component (shouldn't exist if truly connected)
        feature.properties.stroke = '#FF0000';
        feature.properties.strokeWidth = 3;
      }
    }
  });

  // Save the updated GeoJSON
  const outputPath = path.join(__dirname, '../test-output/boulder-components-visualization.geojson');
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  
  console.log(`✅ Saved component visualization to: ${outputPath}`);
  
  // Analyze Bear Canyon specific components
  console.log('\n🐻 Bear Canyon Component Analysis:');
  
  const bearCanyonTrails = geojson.features.filter(feature => 
    feature.properties.type === 'edge' && 
    (feature.properties.trail_name.toLowerCase().includes('bear canyon') ||
     feature.properties.trail_name.toLowerCase().includes('mesa') ||
     feature.properties.trail_name.toLowerCase().includes('fern canyon'))
  );
  
  const bearCanyonComponents = new Set();
  bearCanyonTrails.forEach(trail => {
    const sourceComponent = nodeComponents.get(trail.properties.source);
    const targetComponent = nodeComponents.get(trail.properties.target);
    bearCanyonComponents.add(sourceComponent);
    bearCanyonComponents.add(targetComponent);
  });
  
  console.log(`   Bear Canyon trails span ${bearCanyonComponents.size} components: [${Array.from(bearCanyonComponents).sort((a,b) => a-b).join(', ')}]`);
  
  bearCanyonTrails.forEach(trail => {
    const sourceComponent = nodeComponents.get(trail.properties.source);
    const targetComponent = nodeComponents.get(trail.properties.target);
    console.log(`   ${trail.properties.trail_name}: Component ${sourceComponent} ↔ Component ${targetComponent}`);
  });
  
  // Check for cross-component edges (these shouldn't exist if truly connected)
  const crossComponentEdges = geojson.features.filter(feature => 
    feature.properties.type === 'edge' && 
    feature.properties.source_component !== feature.properties.target_component
  );
  
  console.log(`\n🔍 Found ${crossComponentEdges.length} edges that span different components:`);
  crossComponentEdges.slice(0, 10).forEach(edge => {
    console.log(`   ${edge.properties.trail_name}: Component ${edge.properties.source_component} ↔ Component ${edge.properties.target_component}`);
  });
  
  if (crossComponentEdges.length === 0) {
    console.log('✅ No cross-component edges found - all edges are within their components');
  } else {
    console.log('❌ Cross-component edges found - this suggests the components are not truly disconnected');
  }
}

visualizeComponents();
