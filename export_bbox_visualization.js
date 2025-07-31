const Database = require('better-sqlite3');
const fs = require('fs');

// Bbox coordinates from our previous export
const bbox = {
  minLng: -105.28086462456893,
  minLat: 40.064313194287536,
  maxLng: -105.23954738092088,
  maxLat: 40.095057961140554
};

// Expand bbox slightly to capture more data
const expandedBbox = {
  minLng: bbox.minLng - 0.01,
  minLat: bbox.minLat - 0.01,
  maxLng: bbox.maxLng + 0.01,
  maxLat: bbox.maxLat + 0.01
};

console.log('🔍 Exporting GeoJSON for bbox:', expandedBbox);

// Open the SQLite database
const db = new Database('./test-export-no-split-trails.db');

// Function to check if a point is within bbox
function isInBbox(lng, lat) {
  return lng >= expandedBbox.minLng && lng <= expandedBbox.maxLng &&
         lat >= expandedBbox.minLat && lat <= expandedBbox.maxLat;
}

// Function to check if a line intersects bbox
function lineIntersectsBbox(coordinates) {
  if (!coordinates || coordinates.length < 2) return false;
  
  // Check if any point is within bbox
  for (const coord of coordinates) {
    if (isInBbox(coord[0], coord[1])) {
      return true;
    }
  }
  
  // Check if line crosses bbox boundaries
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    
    // Simple line-rectangle intersection check
    if ((x1 < expandedBbox.minLng && x2 > expandedBbox.maxLng) ||
        (x1 > expandedBbox.maxLng && x2 < expandedBbox.minLng) ||
        (y1 < expandedBbox.minLat && y2 > expandedBbox.maxLat) ||
        (y1 > expandedBbox.maxLat && y2 < expandedBbox.minLat)) {
      return true;
    }
  }
  
  return false;
}

// Export nodes
console.log('📊 Exporting nodes...');
const nodes = db.prepare(`
  SELECT id, lat, lng, elevation, node_type, connected_trails
  FROM routing_nodes 
  WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
`).all(expandedBbox.minLat, expandedBbox.maxLat, expandedBbox.minLng, expandedBbox.maxLng);

console.log(`Found ${nodes.length} nodes in bbox`);

// Export edges
console.log('📊 Exporting edges...');
const edges = db.prepare(`
  SELECT e.*, n1.lat as source_lat, n1.lng as source_lng, n1.elevation as source_elevation,
         n2.lat as target_lat, n2.lng as target_lng, n2.elevation as target_elevation
  FROM routing_edges e
  JOIN routing_nodes n1 ON e.source = n1.id
  JOIN routing_nodes n2 ON e.target = n2.id
  WHERE (n1.lat BETWEEN ? AND ? AND n1.lng BETWEEN ? AND ?) OR
        (n2.lat BETWEEN ? AND ? AND n2.lng BETWEEN ? AND ?)
`).all(
  expandedBbox.minLat, expandedBbox.maxLat, expandedBbox.minLng, expandedBbox.maxLng,
  expandedBbox.minLat, expandedBbox.maxLat, expandedBbox.minLng, expandedBbox.maxLng
);

console.log(`Found ${edges.length} edges in bbox`);

// Create GeoJSON features
const features = [];

// Add nodes as Point features
nodes.forEach(node => {
  features.push({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [node.lng, node.lat, node.elevation]
    },
    properties: {
      id: node.id,
      node_type: node.node_type,
      connected_trails: node.connected_trails,
      elevation: node.elevation,
      feature_type: 'node'
    }
  });
});

// Add edges as LineString features
edges.forEach(edge => {
  try {
    const geojson = JSON.parse(edge.geojson);
    if (geojson.geometry && geojson.geometry.coordinates) {
      // Check if the line intersects our bbox
      if (lineIntersectsBbox(geojson.geometry.coordinates)) {
        features.push({
          type: 'Feature',
          geometry: geojson.geometry,
          properties: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            trail_id: edge.trail_id,
            trail_name: edge.trail_name,
            distance_km: edge.distance_km,
            elevation_gain: edge.elevation_gain,
            elevation_loss: edge.elevation_loss,
            feature_type: 'edge'
          }
        });
      }
    }
  } catch (e) {
    console.log(`Error parsing GeoJSON for edge ${edge.id}:`, e.message);
  }
});

// Create the final GeoJSON
const geojson = {
  type: 'FeatureCollection',
  features: features
};

// Write to file
const outputPath = './bbox_visualization.geojson';
fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

console.log(`✅ Exported ${features.length} features to ${outputPath}`);
console.log(`📊 Summary:`);
console.log(`   - Nodes: ${nodes.length}`);
console.log(`   - Edges: ${edges.length}`);
console.log(`   - Total features: ${features.length}`);

// Also create a summary file
const summary = {
  bbox: expandedBbox,
  stats: {
    total_nodes: nodes.length,
    total_edges: edges.length,
    total_features: features.length,
    node_types: nodes.reduce((acc, node) => {
      acc[node.node_type] = (acc[node.node_type] || 0) + 1;
      return acc;
    }, {})
  },
  sample_nodes: nodes.slice(0, 5),
  sample_edges: edges.slice(0, 5)
};

fs.writeFileSync('./bbox_visualization_summary.json', JSON.stringify(summary, null, 2));
console.log('📋 Created summary file: bbox_visualization_summary.json');

db.close(); 