const Database = require('better-sqlite3');
const fs = require('fs');

async function exportSpecificRoute() {
  const dbPath = '/Users/shaydu/dev/carthorse/test-output/boulder.db';
  const routeUuid = 'unified-loop-hawick-circuits-1756226881879-66';
  const outputPath = '/Users/shaydu/dev/carthorse/test-output/specific-loop-route-internal-ids.geojson';
  
  console.log(`🔍 Looking for route: ${routeUuid}`);
  
  try {
    const db = new Database(dbPath);
    
    // Get the specific route
    const route = db.prepare(`
      SELECT 
        route_uuid, route_name, route_shape, trail_count,
        recommended_length_km, recommended_elevation_gain, route_score,
        route_path, route_edges
      FROM route_recommendations 
      WHERE route_uuid = ?
    `).get(routeUuid);
    
    if (!route) {
      console.log('❌ Route not found in SQLite database');
      return;
    }
    
    console.log(`✅ Found route: ${route.route_name}`);
    console.log(`   Length: ${route.recommended_length_km} km`);
    console.log(`   Elevation: ${route.recommended_elevation_gain} m`);
    console.log(`   Trail count: ${route.trail_count}`);
    
    // Parse route path and edges
    let routePath = null;
    let routeEdges = null;
    
    try {
      if (route.route_path) {
        routePath = JSON.parse(route.route_path);
      }
      if (route.route_edges) {
        routeEdges = JSON.parse(route.route_edges);
      }
    } catch (error) {
      console.log(`⚠️ Error parsing route data: ${error.message}`);
    }
    
    // Get the route geometry by following the actual route path using internal IDs
    let coordinates = [];
    
    if (routePath && Array.isArray(routePath)) {
      console.log(`📍 Building geometry from ${routePath.length} path steps...`);
      
      // Create a mapping from edge IDs to trail data
      const edgeToTrailMap = new Map();
      if (routeEdges && Array.isArray(routeEdges)) {
        for (const edge of routeEdges) {
          edgeToTrailMap.set(edge.id, edge);
        }
      }
      
      // Follow the route path step by step
      for (const step of routePath) {
        const edgeId = step.edge;
        const edgeData = edgeToTrailMap.get(edgeId);
        
        if (edgeData) {
          console.log(`📍 Step ${step.seq}: Edge ${edgeId} -> ${edgeData.trail_name || 'Unknown'}`);
          
          // Get the edge geometry from routing_edges table using internal ID
          const edge = db.prepare(`
            SELECT id, trail_id, trail_name, geojson 
            FROM routing_edges 
            WHERE id = ?
          `).get(edgeId);
          
          if (edge && edge.geojson) {
            try {
              const geojson = JSON.parse(edge.geojson);
              if (geojson.coordinates && Array.isArray(geojson.coordinates)) {
                // Add coordinates for this edge segment
                coordinates = coordinates.concat(geojson.coordinates);
                console.log(`   ✅ Added ${geojson.coordinates.length} coordinates from edge ${edge.id} (trail: ${edge.trail_name})`);
              }
            } catch (error) {
              console.log(`⚠️ Error parsing edge geometry for edge ${edge.id}: ${error.message}`);
            }
          } else {
            console.log(`⚠️ Edge not found in routing_edges: ${edgeId}`);
          }
        } else {
          console.log(`⚠️ Edge data not found for edge ID: ${edgeId}`);
        }
      }
    }
    
    if (coordinates.length === 0) {
      console.log('❌ No coordinates found for route geometry');
      console.log('🔧 This might be because routing_edges table is empty or edge IDs don\'t match');
      return;
    }
    
    console.log(`📍 Generated ${coordinates.length} coordinate points`);
    console.log(`📍 Route starts at: [${coordinates[0][0]}, ${coordinates[0][1]}]`);
    console.log(`📍 Route ends at: [${coordinates[coordinates.length-1][0]}, ${coordinates[coordinates.length-1][1]}]`);
    
    // Check if it's actually a loop
    const startCoord = coordinates[0];
    const endCoord = coordinates[coordinates.length - 1];
    const distance = Math.sqrt(
      Math.pow(startCoord[0] - endCoord[0], 2) + 
      Math.pow(startCoord[1] - endCoord[1], 2)
    );
    
    console.log(`📍 Start/End distance: ${distance.toFixed(6)} degrees`);
    if (distance < 0.001) {
      console.log(`✅ This appears to be a proper loop!`);
    } else {
      console.log(`⚠️ This is NOT a loop - start and end points are different`);
    }
    
    // Create GeoJSON feature
    const geojson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          id: route.route_uuid,
          route_uuid: route.route_uuid,
          name: route.route_name,
          route_shape: route.route_shape,
          trail_count: route.trail_count,
          recommended_length_km: route.recommended_length_km,
          recommended_elevation_gain: route.recommended_elevation_gain,
          route_score: route.route_score,
          is_loop: distance < 0.001,
          start_end_distance: distance,
          // Styling properties
          stroke: '#FF69B4', // Hot pink
          'stroke-width': 4,
          'stroke-opacity': 0.8,
          fill: '#FFB6C1', // Light pink
          'fill-opacity': 0.3
        },
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        }
      }]
    };
    
    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported route to: ${outputPath}`);
    
    db.close();
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

exportSpecificRoute();
