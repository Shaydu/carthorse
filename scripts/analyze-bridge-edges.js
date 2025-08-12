const fs = require('fs');

// Read the GeoJSON file
const geojsonPath = process.argv[2];
if (!geojsonPath) {
  console.error('Usage: node analyze-bridge-edges.js <geojson-file>');
  process.exit(1);
}

const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

// Find edges and nodes
const edges = geojson.features.filter(f => f.geometry.type === 'LineString' && f.properties.type === 'edge');
const nodes = geojson.features.filter(f => f.geometry.type === 'Point' && f.properties.type === 'endpoint');

console.log(`Found ${edges.length} edges and ${nodes.length} nodes`);

// Find the specific bridge edges
const edge25 = edges.find(e => e.properties.id === 25);
const edge31 = edges.find(e => e.properties.id === 31);

if (!edge25) {
  console.error('Edge 25 not found');
  process.exit(1);
}

if (!edge31) {
  console.error('Edge 31 not found');
  process.exit(1);
}

console.log('\n=== Edge 25 Analysis ===');
console.log(`Source: ${edge25.properties.source}, Target: ${edge25.properties.target}`);
console.log(`Trail: ${edge25.properties.trail_name}`);
console.log(`Length: ${edge25.properties.length_km}km`);

console.log('\n=== Edge 31 Analysis ===');
console.log(`Source: ${edge31.properties.source}, Target: ${edge31.properties.target}`);
console.log(`Trail: ${edge31.properties.trail_name}`);
console.log(`Length: ${edge31.properties.length_km}km`);

// Find connected edges
const findConnectedEdges = (nodeId) => {
  return edges.filter(e => e.properties.source === nodeId || e.properties.target === nodeId);
};

console.log('\n=== Edge 25 Connections ===');
const edge25SourceConnections = findConnectedEdges(edge25.properties.source);
const edge25TargetConnections = findConnectedEdges(edge25.properties.target);

console.log(`Source node ${edge25.properties.source} connections:`);
edge25SourceConnections.forEach(e => {
  console.log(`  Edge ${e.properties.id}: ${e.properties.source} → ${e.properties.target} (${e.properties.trail_name})`);
});

console.log(`Target node ${edge25.properties.target} connections:`);
edge25TargetConnections.forEach(e => {
  console.log(`  Edge ${e.properties.id}: ${e.properties.source} → ${e.properties.target} (${e.properties.trail_name})`);
});

console.log('\n=== Edge 31 Connections ===');
const edge31SourceConnections = findConnectedEdges(edge31.properties.source);
const edge31TargetConnections = findConnectedEdges(edge31.properties.target);

console.log(`Source node ${edge31.properties.source} connections:`);
edge31SourceConnections.forEach(e => {
  console.log(`  Edge ${e.properties.id}: ${e.properties.source} → ${e.properties.target} (${e.properties.trail_name})`);
});

console.log(`Target node ${edge31.properties.target} connections:`);
edge31TargetConnections.forEach(e => {
  console.log(`  Edge ${e.properties.id}: ${e.properties.source} → ${e.properties.target} (${e.properties.trail_name})`);
});

// Check for degree 2 vertices
const getNodeDegree = (nodeId) => {
  return edges.filter(e => e.properties.source === nodeId || e.properties.target === nodeId).length;
};

console.log('\n=== Node Degrees ===');
console.log(`Node ${edge25.properties.source} degree: ${getNodeDegree(edge25.properties.source)}`);
console.log(`Node ${edge25.properties.target} degree: ${getNodeDegree(edge25.properties.target)}`);
console.log(`Node ${edge31.properties.source} degree: ${getNodeDegree(edge31.properties.source)}`);
console.log(`Node ${edge31.properties.target} degree: ${getNodeDegree(edge31.properties.target)}`);

// Find all Mesa Trail edges to see potential chains
const mesaTrailEdges = edges.filter(e => e.properties.trail_name === 'Mesa Trail');
console.log(`\n=== All Mesa Trail Edges (${mesaTrailEdges.length}) ===`);
mesaTrailEdges.forEach(e => {
  console.log(`  Edge ${e.properties.id}: ${e.properties.source} → ${e.properties.target} (${e.properties.length_km}km)`);
});

// Check if edges 25 and 31 form a chain with other Mesa Trail edges
const findPotentialChains = () => {
  const chains = [];
  
  // Start with edge 25
  const chain25 = [edge25];
  let currentNode = edge25.properties.target;
  
  // Try to extend the chain
  while (true) {
    const nextEdges = mesaTrailEdges.filter(e => 
      e.properties.id !== edge25.properties.id &&
      e.properties.id !== edge31.properties.id &&
      (e.properties.source === currentNode || e.properties.target === currentNode)
    );
    
    if (nextEdges.length === 0) break;
    
    const nextEdge = nextEdges[0];
    chain25.push(nextEdge);
    currentNode = nextEdge.properties.source === currentNode ? nextEdge.properties.target : nextEdge.properties.source;
  }
  
  chains.push(chain25);
  
  // Start with edge 31
  const chain31 = [edge31];
  currentNode = edge31.properties.target;
  
  // Try to extend the chain
  while (true) {
    const nextEdges = mesaTrailEdges.filter(e => 
      e.properties.id !== edge25.properties.id &&
      e.properties.id !== edge31.properties.id &&
      (e.properties.source === currentNode || e.properties.target === currentNode)
    );
    
    if (nextEdges.length === 0) break;
    
    const nextEdge = nextEdges[0];
    chain31.push(nextEdge);
    currentNode = nextEdge.properties.source === currentNode ? nextEdge.properties.target : nextEdge.properties.source;
  }
  
  chains.push(chain31);
  
  return chains;
};

const potentialChains = findPotentialChains();
console.log('\n=== Potential Chains ===');
potentialChains.forEach((chain, i) => {
  console.log(`Chain ${i + 1}:`);
  chain.forEach(e => {
    console.log(`  Edge ${e.properties.id}: ${e.properties.source} → ${e.properties.target} (${e.properties.length_km}km)`);
  });
  const totalLength = chain.reduce((sum, e) => sum + e.properties.length_km, 0);
  console.log(`  Total length: ${totalLength.toFixed(3)}km`);
});
