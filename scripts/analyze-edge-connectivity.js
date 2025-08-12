const fs = require('fs');

// Read the GeoJSON file
const geojsonPath = '/Users/shaydu/dev/carthorse/test-output/boulder-degree2-debug-v3.geojson';
const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

// Extract edges
const edges = geojson.features.filter(f => f.properties.type === 'edge');

console.log(`Found ${edges.length} edges in the export`);

// Find Mesa Trail edges specifically
const mesaTrailEdges = edges.filter(e => e.properties.trail_name === 'Mesa Trail');
console.log(`\nFound ${mesaTrailEdges.length} Mesa Trail edges:`);

mesaTrailEdges.forEach(edge => {
  console.log(`  Edge ${edge.properties.id}: ${edge.properties.source} → ${edge.properties.target} (${edge.properties.length_km.toFixed(3)}km)`);
});

// Build connectivity map
const connectivityMap = new Map();
edges.forEach(edge => {
  const { id, source, target } = edge.properties;
  if (!connectivityMap.has(source)) {
    connectivityMap.set(source, []);
  }
  if (!connectivityMap.has(target)) {
    connectivityMap.set(target, []);
  }
  connectivityMap.get(source).push({ edgeId: id, type: 'outgoing', target });
  connectivityMap.get(target).push({ edgeId: id, type: 'incoming', source });
});

// Find degree 2 vertices (nodes with exactly 2 connections)
const degree2Vertices = [];
connectivityMap.forEach((connections, nodeId) => {
  if (connections.length === 2) {
    degree2Vertices.push({
      nodeId: parseInt(nodeId),
      connections: connections.map(c => ({ edgeId: c.edgeId, type: c.type }))
    });
  }
});

console.log(`\nFound ${degree2Vertices.length} degree 2 vertices:`);
degree2Vertices.forEach(vertex => {
  console.log(`  Node ${vertex.nodeId}: ${vertex.connections.map(c => `${c.type} edge ${c.edgeId}`).join(', ')}`);
});

// Find potential degree 2 chains
console.log('\nPotential degree 2 chains:');
const processedEdges = new Set();

degree2Vertices.forEach(vertex => {
  const edgeIds = vertex.connections.map(c => c.edgeId);
  
  edgeIds.forEach(edgeId => {
    if (!processedEdges.has(edgeId)) {
      // Try to build a chain starting from this edge
      const chain = buildChain(edgeId, edges, connectivityMap, processedEdges);
      if (chain.length > 1) {
        console.log(`  Chain: ${chain.map(e => e.properties.id).join(' → ')}`);
        console.log(`    Nodes: ${chain.map(e => `${e.properties.source}→${e.properties.target}`).join(' → ')}`);
        console.log(`    Total length: ${chain.reduce((sum, e) => sum + e.properties.length_km, 0).toFixed(3)}km`);
        console.log('');
      }
    }
  });
});

function buildChain(startEdgeId, allEdges, connectivityMap, processedEdges) {
  const chain = [];
  let currentEdgeId = startEdgeId;
  
  while (currentEdgeId && !processedEdges.has(currentEdgeId)) {
    const currentEdge = allEdges.find(e => e.properties.id === currentEdgeId);
    if (!currentEdge) break;
    
    chain.push(currentEdge);
    processedEdges.add(currentEdgeId);
    
    // Find next edge in chain
    const targetNode = currentEdge.properties.target;
    const targetConnections = connectivityMap.get(targetNode) || [];
    
    // Look for outgoing connection from target node
    const nextConnection = targetConnections.find(c => 
      c.type === 'outgoing' && c.edgeId !== currentEdgeId && !processedEdges.has(c.edgeId)
    );
    
    if (nextConnection) {
      currentEdgeId = nextConnection.edgeId;
    } else {
      currentEdgeId = null;
    }
  }
  
  return chain;
}

// Check specific edges mentioned by user
console.log('\nAnalyzing specific edges (2, 51, 3):');
const specificEdges = edges.filter(e => [2, 51, 3].includes(e.properties.id));
specificEdges.forEach(edge => {
  console.log(`  Edge ${edge.properties.id}: ${edge.properties.source} → ${edge.properties.target}`);
  console.log(`    Trail: ${edge.properties.trail_name}`);
  console.log(`    Length: ${edge.properties.length_km.toFixed(3)}km`);
  
  // Check what connects to this edge
  const sourceConnections = connectivityMap.get(edge.properties.source) || [];
  const targetConnections = connectivityMap.get(edge.properties.target) || [];
  
  console.log(`    Source node ${edge.properties.source} connections: ${sourceConnections.map(c => `${c.type} edge ${c.edgeId}`).join(', ')}`);
  console.log(`    Target node ${edge.properties.target} connections: ${targetConnections.map(c => `${c.type} edge ${c.edgeId}`).join(', ')}`);
  console.log('');
});
