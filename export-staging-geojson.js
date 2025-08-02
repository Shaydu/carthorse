const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

async function exportSQLiteGeoJSON() {
  const dbPath = './boulder'; // The SQLite database file
  
  // Define the bbox filter with a small buffer for context
  const bbox = {
    minLng: -105.28117783804319 - 0.01, // Add buffer
    minLat: 40.06826860792208 - 0.01,
    maxLng: -105.2481870337762 + 0.01,
    maxLat: 40.08430159634801 + 0.01
  };
  
  try {
    console.log(`🔗 Opening SQLite database: ${dbPath}`);
    console.log(`🗺️ Filtering to bbox: ${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}`);
    
    const db = new sqlite3.Database(dbPath);
    
    // Get node count in bbox
    const nodeCount = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count 
        FROM routing_nodes 
        WHERE lng BETWEEN ? AND ? 
        AND lat BETWEEN ? AND ?
      `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat], (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    // Get edge count in bbox
    const edgeCount = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count 
        FROM routing_edges 
        WHERE geojson LIKE '%"coordinates":%'
        AND (
          geojson LIKE '%${bbox.minLng}%' OR 
          geojson LIKE '%${bbox.maxLng}%' OR 
          geojson LIKE '%${bbox.minLat}%' OR 
          geojson LIKE '%${bbox.maxLat}%'
        )
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    console.log(`📍 Found ${nodeCount} nodes in bbox`);
    console.log(`🛤️ Found ${edgeCount} edges in bbox`);
    
    // Export nodes as GeoJSON (filtered to bbox)
    const nodes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          id,
          node_uuid,
          lat,
          lng,
          elevation,
          node_type,
          connected_trails,
          created_at
        FROM routing_nodes
        WHERE lng BETWEEN ? AND ? 
        AND lat BETWEEN ? AND ?
        ORDER BY id
      `, [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Export edges as GeoJSON (filtered to bbox)
    const edges = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          id,
          source,
          target,
          trail_id,
          trail_name,
          distance_km,
          elevation_gain,
          elevation_loss,
          geojson,
          created_at
        FROM routing_edges
        WHERE geojson LIKE '%"coordinates":%'
        AND (
          geojson LIKE '%${bbox.minLng}%' OR 
          geojson LIKE '%${bbox.maxLng}%' OR 
          geojson LIKE '%${bbox.minLat}%' OR 
          geojson LIKE '%${bbox.maxLat}%'
        )
        ORDER BY id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Create GeoJSON features for nodes
    const nodeFeatures = nodes.map(node => ({
      type: 'Feature',
      properties: {
        id: node.id,
        node_uuid: node.node_uuid,
        node_type: node.node_type,
        connected_trails: node.connected_trails,
        elevation: node.elevation,
        created_at: node.created_at,
        // Color coding for visualization
        color: node.node_type === 'endpoint' ? '#ff0000' : '#0000ff', // Red for endpoints, blue for intersections
        size: node.node_type === 'endpoint' ? 3 : 5 // Larger dots for intersections
      },
      geometry: {
        type: 'Point',
        coordinates: [node.lng, node.lat, node.elevation]
      }
    }));
    
    // Create GeoJSON features for edges
    const edgeFeatures = edges.map(edge => {
      let geojson;
      try {
        geojson = JSON.parse(edge.geojson);
      } catch (e) {
        console.warn(`⚠️ Invalid GeoJSON for edge ${edge.id}: ${edge.geojson}`);
        return null;
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
          created_at: edge.created_at,
          // Styling for visualization
          color: '#00ff00', // Green for edges
          weight: 2
        },
        geometry: geojson.geometry
      };
    }).filter(feature => feature !== null);
    
    // Create combined GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: [...nodeFeatures, ...edgeFeatures]
    };
    
    // Write to file
    const filename = `boulder-network-bbox-${Date.now()}.geojson`;
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported to ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`  - Nodes: ${nodeFeatures.length} (${nodeFeatures.filter(f => f.properties.node_type === 'endpoint').length} endpoints, ${nodeFeatures.filter(f => f.properties.node_type === 'intersection').length} intersections)`);
    console.log(`  - Edges: ${edgeFeatures.length}`);
    console.log(`  - Total features: ${geojson.features.length}`);
    console.log(`\n🌐 Open ${filename} in geojson.io to visualize the network`);
    console.log(`\n🎨 Color coding:`);
    console.log(`  - 🔴 Red dots: Endpoint nodes`);
    console.log(`  - 🔵 Blue dots: Intersection nodes`);
    console.log(`  - 🟢 Green lines: Trail edges`);
    console.log(`\n📍 Bbox area: ${bbox.minLng}, ${bbox.minLat} to ${bbox.maxLng}, ${bbox.maxLat}`);
    
    db.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the export
exportSQLiteGeoJSON().catch(console.error); 