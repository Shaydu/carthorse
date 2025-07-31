const Database = require('better-sqlite3');

console.log('🔍 Analyzing Export Ratios...');

// Open the SQLite database
const db = new Database('./test-export-no-split-trails.db');

// Get basic counts
const totalEdges = db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count;
const totalNodes = db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count;
const intersectionNodes = db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "intersection"').get().count;
const endpointNodes = db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "endpoint"').get().count;
const uniqueTrailNames = db.prepare('SELECT COUNT(DISTINCT trail_name) as count FROM routing_edges').get().count;

// Calculate ratios
const edgesPerNode = totalEdges / totalNodes;
const intersectionRatio = intersectionNodes / totalNodes;
const endpointRatio = endpointNodes / totalNodes;
const segmentsPerTrail = totalEdges / uniqueTrailNames;

console.log('\n📊 BASIC COUNTS:');
console.log(`   Total Trail Segments: ${totalEdges.toLocaleString()}`);
console.log(`   Total Nodes: ${totalNodes.toLocaleString()}`);
console.log(`   Unique Trail Names: ${uniqueTrailNames.toLocaleString()}`);

console.log('\n🎯 NODE BREAKDOWN:');
console.log(`   Intersection Nodes: ${intersectionNodes.toLocaleString()} (${(intersectionRatio*100).toFixed(1)}%)`);
console.log(`   Endpoint Nodes: ${endpointNodes.toLocaleString()} (${(endpointRatio*100).toFixed(1)}%)`);

console.log('\n📈 RATIO ANALYSIS:');
console.log(`   Edges per Node: ${edgesPerNode.toFixed(2)}`);
console.log(`   Segments per Trail: ${segmentsPerTrail.toFixed(2)}`);

// Validation rules
const validations = [
  {
    name: 'Edges per Node',
    value: edgesPerNode,
    expected: '1.5-3.0',
    isValid: edgesPerNode >= 1.5 && edgesPerNode <= 3.0,
    description: 'Typical trail networks have 1.5-3.0 edges per node'
  },
  {
    name: 'Intersection Node Ratio',
    value: intersectionRatio,
    expected: '0.1-0.4',
    isValid: intersectionRatio >= 0.1 && intersectionRatio <= 0.4,
    description: '10-40% of nodes should be intersections'
  },
  {
    name: 'Endpoint Node Ratio',
    value: endpointRatio,
    expected: '0.6-0.9',
    isValid: endpointRatio >= 0.6 && endpointRatio <= 0.9,
    description: '60-90% of nodes should be endpoints'
  },
  {
    name: 'Segments per Trail',
    value: segmentsPerTrail,
    expected: '1.0-5.0',
    isValid: segmentsPerTrail >= 1.0 && segmentsPerTrail <= 5.0,
    description: 'Most trails should have 1-5 segments after splitting'
  }
];

console.log('\n✅ VALIDATION RESULTS:');
validations.forEach(validation => {
  const status = validation.isValid ? '✅ PASS' : '❌ FAIL';
  console.log(`   ${validation.name}: ${validation.value.toFixed(3)} (Expected: ${validation.expected}) - ${status}`);
  console.log(`     ${validation.description}`);
});

// Overall assessment
const passedValidations = validations.filter(v => v.isValid).length;
const totalValidations = validations.length;
const overallScore = (passedValidations / totalValidations * 100).toFixed(1);

console.log(`\n🎯 OVERALL ASSESSMENT: ${passedValidations}/${totalValidations} (${overallScore}%)`);

if (overallScore >= 90) {
  console.log('   Status: ✅ EXCELLENT - All ratios are realistic');
} else if (overallScore >= 70) {
  console.log('   Status: ⚠️  GOOD - Most ratios are realistic');
} else {
  console.log('   Status: ❌ NEEDS REVIEW - Some ratios are concerning');
}

// Additional insights
console.log('\n💡 INSIGHTS:');
console.log(`   - We have ${totalEdges.toLocaleString()} trail segments from ${uniqueTrailNames.toLocaleString()} original trails`);
console.log(`   - Average trail was split into ${segmentsPerTrail.toFixed(1)} segments`);
console.log(`   - ${(intersectionRatio*100).toFixed(1)}% of nodes are intersections, indicating a well-connected network`);
console.log(`   - ${(endpointRatio*100).toFixed(1)}% of nodes are endpoints, showing good trail coverage`);

// Check for any concerning patterns
if (segmentsPerTrail > 5) {
  console.log('   ⚠️  WARNING: High segments per trail ratio - trails may be over-split');
}
if (intersectionRatio > 0.4) {
  console.log('   ⚠️  WARNING: High intersection ratio - may indicate dense trail network or over-detection');
}
if (edgesPerNode < 1.5) {
  console.log('   ⚠️  WARNING: Low edges per node - network may be disconnected');
}

db.close(); 