const Database = require('better-sqlite3');
const fs = require('fs');

// Configuration
const dbPath = '/Users/shaydu/dev/carthorse/test-output/boulder.db';
const outputPath = '/Users/shaydu/dev/carthorse/test-output/specific-route.geojson';

// Route UUID to extract (from the current export)
const targetRouteUuid = 'unified-loop-hawick-circuits-1756226882588-38';

console.log('🔍 Opening SQLite database...');
const db = new Database(dbPath);

try {
  console.log('📍 Looking for route:', targetRouteUuid);
  
  // Get the route from route_recommendations
  const route = db.prepare(`
    SELECT route_uuid, route_name, route_path, route_edges, recommended_length_km, recommended_elevation_gain
    FROM route_recommendations 
    WHERE route_uuid = ?
  `).get(targetRouteUuid);
  
  if (!route) {
    console.log('❌ Route not found in database');
    return;
  }
  
  console.log('✅ Found route:', route.route_name);
  console.log('📏 Length:', route.recommended_length_km, 'km');
  console.log('⛰️ Elevation:', route.recommended_elevation_gain, 'm');
  
  // Parse the route path and edges
  const routePath = JSON.parse(route.route_path || '[]');
  const routeEdges = JSON.parse(route.route_edges || '[]');
  
  console.log('📍 Route path has', routePath.length, 'steps');
  console.log('📍 Route edges has', routeEdges.length, 'edges');
  
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
           
           // Skip virtual edges (edge = -1) which connect back to start node
           if (edgeId === "-1" || edgeId === -1) {
             console.log(`📍 Step ${step.seq}: Virtual edge ${edgeId} -> connecting back to start node`);
             continue;
           }
           
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
  
  // Check if route forms a loop
  const firstCoord = coordinates[0];
  const lastCoord = coordinates[coordinates.length - 1];
  const isLoop = firstCoord && lastCoord && 
                 Math.abs(firstCoord[0] - lastCoord[0]) < 0.0001 && 
                 Math.abs(firstCoord[1] - lastCoord[1]) < 0.0001;
  
  console.log('📍 Route analysis:');
  console.log(`   📍 Total coordinates: ${coordinates.length}`);
  console.log(`   📍 Start: [${firstCoord[0]}, ${firstCoord[1]}]`);
  console.log(`   📍 End: [${lastCoord[0]}, ${lastCoord[1]}]`);
  console.log(`   📍 Is loop: ${isLoop ? '✅ Yes' : '❌ No'}`);
  
  // Create GeoJSON feature
  const geojsonFeature = {
    type: 'Feature',
    properties: {
      route_uuid: route.route_uuid,
      route_name: route.route_name,
      length_km: route.recommended_length_km,
      elevation_gain: route.recommended_elevation_gain,
      coordinate_count: coordinates.length,
      is_loop: isLoop
    },
    geometry: {
      type: 'LineString',
      coordinates: coordinates
    }
  };
  
  const geojsonCollection = {
    type: 'FeatureCollection',
    features: [geojsonFeature]
  };
  
  // Write to file
  fs.writeFileSync(outputPath, JSON.stringify(geojsonCollection, null, 2));
  console.log('✅ GeoJSON exported to:', outputPath);
  console.log('📍 File size:', (fs.statSync(outputPath).size / 1024).toFixed(2), 'KB');
  
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  db.close();
  console.log('🔍 Database connection closed');
}
