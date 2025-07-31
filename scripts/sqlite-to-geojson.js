#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Get the SQLite database path from command line arguments
const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: node sqlite-to-geojson.js <path-to-sqlite-db>');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Converting SQLite database: ${dbPath}`);

try {
  const db = new Database(dbPath);
  
  // Convert routing nodes to GeoJSON
  console.log('Converting routing nodes to GeoJSON...');
  const nodes = db.prepare('SELECT * FROM routing_nodes').all();
  
  const nodesGeoJSON = {
    type: 'FeatureCollection',
    features: nodes.map(node => ({
      type: 'Feature',
      properties: {
        id: node.id,
        node_uuid: node.node_uuid,
        node_type: node.node_type,
        connected_trails: node.connected_trails,
        created_at: node.created_at
      },
      geometry: {
        type: 'Point',
        coordinates: [node.lng, node.lat, node.elevation]
      }
    }))
  };
  
  // Convert routing edges to GeoJSON
  console.log('Converting routing edges to GeoJSON...');
  const edges = db.prepare('SELECT * FROM routing_edges').all();
  
  const edgesGeoJSON = {
    type: 'FeatureCollection',
    features: edges.map(edge => {
      let geometry;
      try {
        // Parse the GeoJSON from the geojson column
        const geojsonData = JSON.parse(edge.geojson);
        geometry = geojsonData.geometry;
      } catch (e) {
        console.warn(`Warning: Could not parse GeoJSON for edge ${edge.id}: ${e.message}`);
        geometry = {
          type: 'LineString',
          coordinates: [[0, 0, 0]] // Fallback
        };
      }
      
      return {
        type: 'Feature',
        properties: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          trail_id: edge.trail_id,
          trail_name: edge.trail_name,
          distance_km: edge.distance_km,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss,
          created_at: edge.created_at
        },
        geometry: geometry
      };
    })
  };
  
  // Write the GeoJSON files
  const outputDir = path.dirname(dbPath);
  const baseName = path.basename(dbPath, '.sqlite');
  
  const nodesOutputPath = path.join(outputDir, `${baseName}-nodes.geojson`);
  const edgesOutputPath = path.join(outputDir, `${baseName}-edges.geojson`);
  
  fs.writeFileSync(nodesOutputPath, JSON.stringify(nodesGeoJSON, null, 2));
  fs.writeFileSync(edgesOutputPath, JSON.stringify(edgesGeoJSON, null, 2));
  
  console.log(`✅ Nodes GeoJSON written to: ${nodesOutputPath} (${nodes.length} nodes)`);
  console.log(`✅ Edges GeoJSON written to: ${edgesOutputPath} (${edges.length} edges)`);
  
  // Also create a combined GeoJSON with both nodes and edges
  const combinedGeoJSON = {
    type: 'FeatureCollection',
    features: [
      ...nodesGeoJSON.features.map(f => ({ ...f, properties: { ...f.properties, feature_type: 'node' } })),
      ...edgesGeoJSON.features.map(f => ({ ...f, properties: { ...f.properties, feature_type: 'edge' } }))
    ]
  };
  
  const combinedOutputPath = path.join(outputDir, `${baseName}-combined.geojson`);
  fs.writeFileSync(combinedOutputPath, JSON.stringify(combinedGeoJSON, null, 2));
  console.log(`✅ Combined GeoJSON written to: ${combinedOutputPath} (${nodes.length + edges.length} features)`);
  
  db.close();
  
} catch (error) {
  console.error('Error converting SQLite to GeoJSON:', error);
  process.exit(1);
} 