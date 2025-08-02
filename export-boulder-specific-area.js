const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

async function exportBoulderSpecificArea() {
  const dbPath = './boulder';
  
  // Define the specific bbox for the Boulder area
  const bbox = {
    minLng: -105.28104727474857,
    minLat: 40.066553135690185,
    maxLng: -105.23568056603648,
    maxLat: 40.1050667985335
  };
  
  try {
    console.log(`🔗 Opening SQLite database: ${dbPath}`);
    console.log(`🗺️ Filtering data to bbox: ${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}`);
    
    const db = new sqlite3.Database(dbPath);
    
    // Get counts for each data type
    const trailCount = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count 
        FROM trails 
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
    
    const nodeCount = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count 
        FROM routing_nodes 
        WHERE longitude BETWEEN ${bbox.minLng} AND ${bbox.maxLng}
        AND latitude BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
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
    
    console.log(`📊 Data counts in bbox:`);
    console.log(`  - Trails: ${trailCount}`);
    console.log(`  - Nodes: ${nodeCount}`);
    console.log(`  - Edges: ${edgeCount}`);
    
    // Export trails (limited to first 60)
    const trails = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          id,
          app_uuid,
          name,
          region,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          geojson,
          created_at
        FROM trails
        WHERE geojson LIKE '%"coordinates":%'
        AND (
          geojson LIKE '%${bbox.minLng}%' OR 
          geojson LIKE '%${bbox.maxLng}%' OR 
          geojson LIKE '%${bbox.minLat}%' OR 
          geojson LIKE '%${bbox.maxLat}%'
        )
        ORDER BY name
        LIMIT 60
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Export routing nodes
    const nodes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          id,
          node_id,
          trail_id,
          node_type,
          longitude,
          latitude,
          elevation,
          created_at
        FROM routing_nodes
        WHERE longitude BETWEEN ${bbox.minLng} AND ${bbox.maxLng}
        AND latitude BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
        ORDER BY node_type, id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Export routing edges
    const edges = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          id,
          edge_id,
          source_node_id,
          target_node_id,
          trail_id,
          length_meters,
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
        ORDER BY trail_id, id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Create GeoJSON features for trails (Orange)
    const trailFeatures = trails.map(trail => {
      let geojson;
      try {
        geojson = JSON.parse(trail.geojson);
      } catch (e) {
        console.warn(`⚠️ Invalid GeoJSON for trail ${trail.id}: ${trail.geojson}`);
        return null;
      }
      
      return {
        type: 'Feature',
        properties: {
          id: trail.id,
          app_uuid: trail.app_uuid,
          name: trail.name,
          region: trail.region,
          trail_type: trail.trail_type,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          created_at: trail.created_at,
          // Styling for visualization
          color: '#ff6600', // Orange for trails
          weight: 3,
          feature_type: 'trail'
        },
        geometry: geojson.geometry
      };
    }).filter(feature => feature !== null);
    
    // Create GeoJSON features for nodes (different colors by type)
    const nodeFeatures = nodes.map(node => {
      // Determine color based on node type
      let color = '#0000ff'; // Default blue
      if (node.node_type === 'intersection') {
        color = '#ff0000'; // Red for intersections
      } else if (node.node_type === 'endpoint') {
        color = '#00ff00'; // Green for endpoints
      } else if (node.node_type === 'trail_node') {
        color = '#0000ff'; // Blue for trail nodes
      }
      
      return {
        type: 'Feature',
        properties: {
          id: node.id,
          node_id: node.node_id,
          trail_id: node.trail_id,
          node_type: node.node_type,
          longitude: node.longitude,
          latitude: node.latitude,
          elevation: node.elevation,
          created_at: node.created_at,
          // Styling for visualization
          color: color,
          radius: 5,
          feature_type: 'node'
        },
        geometry: {
          type: 'Point',
          coordinates: [node.longitude, node.latitude]
        }
      };
    });
    
    // Create GeoJSON features for edges (Magenta)
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
          edge_id: edge.edge_id,
          source_node_id: edge.source_node_id,
          target_node_id: edge.target_node_id,
          trail_id: edge.trail_id,
          length_meters: edge.length_meters,
          elevation_gain: edge.elevation_gain,
          elevation_loss: edge.elevation_loss,
          created_at: edge.created_at,
          // Styling for visualization
          color: '#ff00ff', // Magenta for edges
          weight: 2,
          feature_type: 'edge'
        },
        geometry: geojson.geometry
      };
    }).filter(feature => feature !== null);
    
    // Create combined GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: [...trailFeatures, ...nodeFeatures, ...edgeFeatures]
    };
    
    // Write to file
    const filename = `boulder-specific-area-${Date.now()}.geojson`;
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported to ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`  - Trails: ${trailFeatures.length}`);
    console.log(`  - Nodes: ${nodeFeatures.length}`);
    console.log(`  - Edges: ${edgeFeatures.length}`);
    console.log(`  - Total features: ${geojson.features.length}`);
    console.log(`\n🌐 Open ${filename} in geojson.io to visualize the data`);
    console.log(`\n🎨 Color coding:`);
    console.log(`  - 🟠 Orange lines: Trail geometries`);
    console.log(`  - 🔴 Red points: Intersection nodes`);
    console.log(`  - 🟢 Green points: Endpoint nodes`);
    console.log(`  - 🔵 Blue points: Trail nodes`);
    console.log(`  - 🟣 Magenta lines: Routing edges`);
    console.log(`\n📍 Bbox area: ${bbox.minLng}, ${bbox.minLat} to ${bbox.maxLng}, ${bbox.maxLat}`);
    
    // Show trail names
    if (trailFeatures.length > 0) {
      console.log(`\n🛤️ Trails in this area:`);
      trailFeatures.forEach((feature, index) => {
        console.log(`  ${index + 1}. ${feature.properties.name} (${feature.properties.length_km.toFixed(2)}km)`);
      });
    } else {
      console.log(`\n⚠️ No trails found in this area`);
    }
    
    // Show node types
    const nodeTypeCounts = {};
    nodeFeatures.forEach(feature => {
      const nodeType = feature.properties.node_type;
      nodeTypeCounts[nodeType] = (nodeTypeCounts[nodeType] || 0) + 1;
    });
    
    if (Object.keys(nodeTypeCounts).length > 0) {
      console.log(`\n📍 Node types in this area:`);
      Object.entries(nodeTypeCounts).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count} nodes`);
      });
    }
    
    db.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the export
exportBoulderSpecificArea().catch(console.error); 