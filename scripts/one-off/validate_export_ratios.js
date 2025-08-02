const Database = require('better-sqlite3');
const fs = require('fs');

console.log('🔍 Validating Export Ratios and Counts...');

// Open the SQLite database
const db = new Database('./test-export-no-split-trails.db');

// Get comprehensive statistics
const stats = {
  // Basic counts
  total_edges: db.prepare('SELECT COUNT(*) as count FROM routing_edges').get().count,
  total_nodes: db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get().count,
  
  // Node type breakdown
  intersection_nodes: db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "intersection"').get().count,
  endpoint_nodes: db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = "endpoint"').get().count,
  
  // Edge analysis
  unique_trail_segments: db.prepare('SELECT COUNT(DISTINCT trail_id) as count FROM routing_edges').get().count,
  unique_trail_names: db.prepare('SELECT COUNT(DISTINCT trail_name) as count FROM routing_edges').get().count,
  
  // 3D data validation
  edges_with_3d: db.prepare(`
    SELECT COUNT(*) as count
    FROM routing_edges 
    WHERE geojson LIKE '%[%' 
      AND geojson LIKE '%,%' 
      AND geojson LIKE '%,%'
      AND geojson LIKE '%,%'
  `).get().count,
  
  nodes_with_elevation: db.prepare('SELECT COUNT(*) as count FROM routing_nodes WHERE elevation IS NOT NULL').get().count,
  
  // Connectivity analysis
  orphan_edges: db.prepare(`
    SELECT COUNT(*) as count
    FROM routing_edges e
    LEFT JOIN routing_nodes n1 ON e.source = n1.id
    LEFT JOIN routing_nodes n2 ON e.target = n2.id
    WHERE n1.id IS NULL OR n2.id IS NULL
  `).get().count,
  
  // Sample data for validation
  sample_edges: db.prepare(`
    SELECT trail_name, distance_km, elevation_gain, elevation_loss
    FROM routing_edges 
    LIMIT 5
  `).all(),
  
  sample_nodes: db.prepare(`
    SELECT node_type, elevation, connected_trails
    FROM routing_nodes 
    LIMIT 5
  `).all(),
  
  // Trail name distribution
  trail_name_counts: db.prepare(`
    SELECT trail_name, COUNT(*) as segment_count
    FROM routing_edges 
    GROUP BY trail_name
    ORDER BY segment_count DESC
    LIMIT 10
  `).all(),
  
  // Node connectivity
  node_connectivity: db.prepare(`
    SELECT 
      node_type,
      COUNT(*) as node_count,
      AVG(LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) as avg_connections
    FROM routing_nodes 
    GROUP BY node_type
  `).all()
};

// Calculate ratios
const ratios = {
  edges_per_node: stats.total_edges / stats.total_nodes,
  intersection_ratio: stats.intersection_nodes / stats.total_nodes,
  endpoint_ratio: stats.endpoint_nodes / stats.total_nodes,
  segments_per_trail: stats.unique_trail_segments / stats.unique_trail_names,
  three_d_edge_ratio: stats.edges_with_3d / stats.total_edges,
  elevation_node_ratio: stats.nodes_with_elevation / stats.total_nodes
};

// Validation rules
const validation = {
  // Expected ratios based on typical trail networks
  expected_ratios: {
    edges_per_node: { min: 1.5, max: 3.0, description: "Edges per node (should be 1.5-3.0)" },
    intersection_ratio: { min: 0.1, max: 0.4, description: "Intersection nodes ratio (10-40%)" },
    endpoint_ratio: { min: 0.6, max: 0.9, description: "Endpoint nodes ratio (60-90%)" },
    segments_per_trail: { min: 1.0, max: 5.0, description: "Segments per trail (1-5 typical)" },
    three_d_edge_ratio: { min: 0.9, max: 1.0, description: "3D edge data ratio (should be >90%)" },
    elevation_node_ratio: { min: 0.9, max: 1.0, description: "Node elevation data ratio (should be >90%)" }
  },
  
  // Check each ratio
  results: {}
};

// Validate each ratio
Object.keys(ratios).forEach(ratio => {
  const value = ratios[ratio];
  const expected = validation.expected_ratios[ratio];
  const isValid = value >= expected.min && value <= expected.max;
  
  validation.results[ratio] = {
    value: value.toFixed(3),
    expected: `${expected.min}-${expected.max}`,
    isValid: isValid,
    status: isValid ? '✅ PASS' : '❌ FAIL',
    description: expected.description
  };
});

// Print comprehensive report
console.log('\n📊 EXPORT VALIDATION REPORT');
console.log('=' .repeat(50));

console.log('\n🔢 BASIC COUNTS:');
console.log(`   Total Edges: ${stats.total_edges.toLocaleString()}`);
console.log(`   Total Nodes: ${stats.total_nodes.toLocaleString()}`);
console.log(`   Unique Trail Segments: ${stats.unique_trail_segments.toLocaleString()}`);
console.log(`   Unique Trail Names: ${stats.unique_trail_names.toLocaleString()}`);

console.log('\n🎯 NODE BREAKDOWN:');
console.log(`   Intersection Nodes: ${stats.intersection_nodes.toLocaleString()} (${(stats.intersection_nodes/stats.total_nodes*100).toFixed(1)}%)`);
console.log(`   Endpoint Nodes: ${stats.endpoint_nodes.toLocaleString()} (${(stats.endpoint_nodes/stats.total_nodes*100).toFixed(1)}%)`);

console.log('\n📈 RATIO VALIDATION:');
Object.keys(validation.results).forEach(ratio => {
  const result = validation.results[ratio];
  console.log(`   ${result.description}:`);
  console.log(`     Value: ${result.value} (Expected: ${result.expected})`);
  console.log(`     Status: ${result.status}`);
});

console.log('\n🔍 DATA QUALITY:');
console.log(`   3D Edge Data: ${stats.edges_with_3d}/${stats.total_edges} (${(stats.edges_with_3d/stats.total_edges*100).toFixed(1)}%)`);
console.log(`   Node Elevation Data: ${stats.nodes_with_elevation}/${stats.total_nodes} (${(stats.nodes_with_elevation/stats.total_nodes*100).toFixed(1)}%)`);
console.log(`   Orphan Edges: ${stats.orphan_edges} (should be 0)`);

console.log('\n🎯 CONNECTIVITY ANALYSIS:');
stats.node_connectivity.forEach(node => {
  console.log(`   ${node.node_type}: ${node.node_count} nodes, avg ${node.avg_connections.toFixed(1)} connections`);
});

console.log('\n📋 TOP TRAILS BY SEGMENTS:');
stats.trail_name_counts.forEach(trail => {
  console.log(`   ${trail.trail_name}: ${trail.segment_count} segments`);
});

console.log('\n📝 SAMPLE DATA:');
console.log('Sample Edges:');
stats.sample_edges.forEach(edge => {
  console.log(`   ${edge.trail_name}: ${edge.distance_km.toFixed(3)}km, +${edge.elevation_gain}m/-${edge.elevation_loss}m`);
});

console.log('Sample Nodes:');
stats.sample_nodes.forEach(node => {
  console.log(`   ${node.node_type}: ${node.elevation}m, trails: ${node.connected_trails}`);
});

// Overall assessment
const passedValidations = Object.values(validation.results).filter(r => r.isValid).length;
const totalValidations = Object.keys(validation.results).length;
const overallScore = (passedValidations / totalValidations * 100).toFixed(1);

console.log('\n🎯 OVERALL ASSESSMENT:');
console.log(`   Validation Score: ${passedValidations}/${totalValidations} (${overallScore}%)`);

if (overallScore >= 90) {
  console.log('   Status: ✅ EXCELLENT - All ratios are realistic');
} else if (overallScore >= 70) {
  console.log('   Status: ⚠️  GOOD - Most ratios are realistic');
} else {
  console.log('   Status: ❌ NEEDS REVIEW - Some ratios are concerning');
}

// Save detailed report
const report = {
  timestamp: new Date().toISOString(),
  stats: stats,
  ratios: ratios,
  validation: validation,
  overallScore: overallScore
};

fs.writeFileSync('./export_validation_report.json', JSON.stringify(report, null, 2));
console.log('\n📄 Detailed report saved to: export_validation_report.json');

db.close(); 