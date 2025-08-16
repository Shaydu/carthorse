#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function diagnoseBearCanyonConnectivity() {
  console.log('🔍 Diagnosing Bear Canyon Loop connectivity issues...\n');

  // Read the Layer 2 network GeoJSON
  const geojsonPath = path.join(__dirname, '../test-output/boulder-degree-colored-export-layer2-network.geojson');
  
  if (!fs.existsSync(geojsonPath)) {
    console.log('❌ Layer 2 network GeoJSON not found');
    return;
  }

  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Find Bear Canyon related trails
  const bearCanyonTrails = [];
  const mesaTrails = [];
  const fernCanyonTrails = [];
  
  geojson.features.forEach(feature => {
    if (feature.properties.type === 'edge') {
      const trailName = feature.properties.trail_name;
      const edge = {
        id: feature.properties.id,
        source: feature.properties.source,
        target: feature.properties.target,
        trail_name: trailName,
        length_km: feature.properties.length_km,
        trail_id: feature.properties.trail_id
      };
      
      if (trailName.toLowerCase().includes('bear canyon')) {
        bearCanyonTrails.push(edge);
      } else if (trailName.toLowerCase().includes('mesa') && !trailName.toLowerCase().includes('enchanted')) {
        mesaTrails.push(edge);
      } else if (trailName.toLowerCase().includes('fern canyon')) {
        fernCanyonTrails.push(edge);
      }
    }
  });

  console.log('1️⃣ Found Bear Canyon related trails:');
  bearCanyonTrails.forEach(trail => {
    console.log(`   Edge ${trail.id}: ${trail.trail_name}`);
    console.log(`      Source: ${trail.source} → Target: ${trail.target}`);
    console.log(`      Length: ${trail.length_km.toFixed(2)}km`);
  });

  console.log('\n2️⃣ Found Mesa trails:');
  mesaTrails.forEach(trail => {
    console.log(`   Edge ${trail.id}: ${trail.trail_name}`);
    console.log(`      Source: ${trail.source} → Target: ${trail.target}`);
    console.log(`      Length: ${trail.length_km.toFixed(2)}km`);
  });

  console.log('\n3️⃣ Found Fern Canyon trails:');
  fernCanyonTrails.forEach(trail => {
    console.log(`   Edge ${trail.id}: ${trail.trail_name}`);
    console.log(`      Source: ${trail.source} → Target: ${trail.target}`);
    console.log(`      Length: ${trail.length_km.toFixed(2)}km`);
  });

  // Collect all node IDs involved
  const allNodeIds = new Set();
  [...bearCanyonTrails, ...mesaTrails, ...fernCanyonTrails].forEach(trail => {
    allNodeIds.add(trail.source);
    allNodeIds.add(trail.target);
  });

  console.log('\n4️⃣ Node connectivity analysis:');
  console.log(`   Total unique nodes involved: ${allNodeIds.size}`);
  console.log(`   Node IDs: [${Array.from(allNodeIds).sort((a,b) => a-b).join(', ')}]`);

  // Check if these nodes are actually connected
  const nodeConnections = new Map();
  
  // Build connection map
  [...bearCanyonTrails, ...mesaTrails, ...fernCanyonTrails].forEach(trail => {
    if (!nodeConnections.has(trail.source)) {
      nodeConnections.set(trail.source, new Set());
    }
    if (!nodeConnections.has(trail.target)) {
      nodeConnections.set(trail.target, new Set());
    }
    nodeConnections.get(trail.source).add(trail.target);
    nodeConnections.get(trail.target).add(trail.source);
  });

  // Find connected components using BFS
  const visited = new Set();
  const components = [];

  function bfs(startNode) {
    const component = new Set();
    const queue = [startNode];
    visited.add(startNode);
    component.add(startNode);

    while (queue.length > 0) {
      const node = queue.shift();
      const neighbors = nodeConnections.get(node) || new Set();
      
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
  for (const nodeId of allNodeIds) {
    if (!visited.has(nodeId)) {
      const component = bfs(nodeId);
      components.push(component);
    }
  }

  console.log(`\n5️⃣ Connected components analysis:`);
  console.log(`   Found ${components.length} connected components:`);
  
  components.forEach((component, i) => {
    const nodeList = Array.from(component).sort((a,b) => a-b);
    console.log(`   Component ${i + 1}: ${component.size} nodes [${nodeList.join(', ')}]`);
    
    // Show which trails are in this component
    const trailsInComponent = [...bearCanyonTrails, ...mesaTrails, ...fernCanyonTrails].filter(trail => 
      component.has(trail.source) || component.has(trail.target)
    );
    
    console.log(`      Trails in this component:`);
    trailsInComponent.forEach(trail => {
      console.log(`        - ${trail.trail_name} (Edge ${trail.id})`);
    });
  });

  // Check for potential connectivity issues
  console.log('\n6️⃣ Potential connectivity issues:');
  
  if (components.length === 1) {
    console.log('   ✅ All trails are in the same component - they should be routable!');
  } else {
    console.log('   ❌ Trails are in separate components - this explains why routing fails');
    console.log('   🔍 Possible causes:');
    console.log('      - Missing intersection detection');
    console.log('      - Node tolerance too small');
    console.log('      - Edge tolerance too small');
    console.log('      - Trail splitting errors');
  }

  // Check for missing connections
  console.log('\n7️⃣ Checking for missing connections:');
  
  // Find nodes that should be connected but aren't
  const allTrails = [...bearCanyonTrails, ...mesaTrails, ...fernCanyonTrails];
  const missingConnections = [];
  
  for (let i = 0; i < allTrails.length; i++) {
    for (let j = i + 1; j < allTrails.length; j++) {
      const trail1 = allTrails[i];
      const trail2 = allTrails[j];
      
      // Check if trails share any nodes
      const trail1Nodes = new Set([trail1.source, trail1.target]);
      const trail2Nodes = new Set([trail2.source, trail2.target]);
      
      const sharedNodes = [...trail1Nodes].filter(node => trail2Nodes.has(node));
      
      if (sharedNodes.length === 0) {
        // These trails don't share nodes - potential missing connection
        missingConnections.push({
          trail1: trail1.trail_name,
          trail2: trail2.trail_name,
          trail1Nodes: [trail1.source, trail1.target],
          trail2Nodes: [trail2.source, trail2.target]
        });
      }
    }
  }

  if (missingConnections.length > 0) {
    console.log(`   Found ${missingConnections.length} potential missing connections:`);
    missingConnections.slice(0, 10).forEach(conn => {
      console.log(`      ${conn.trail1} ↔ ${conn.trail2}`);
      console.log(`         ${conn.trail1} nodes: [${conn.trail1Nodes.join(', ')}]`);
      console.log(`         ${conn.trail2} nodes: [${conn.trail2Nodes.join(', ')}]`);
    });
  } else {
    console.log('   ✅ All trails appear to be properly connected');
  }

  console.log('\n✅ Bear Canyon connectivity diagnosis complete!');
}

diagnoseBearCanyonConnectivity();
