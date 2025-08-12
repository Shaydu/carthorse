#!/usr/bin/env ts-node

/**
 * Query Overpass API for trails that might connect two endpoints
 */

// The two endpoints we need to connect
const ENDPOINT_1 = {
  lat: 39.94537,
  lng: -105.236601
};

const ENDPOINT_2 = {
  lat: 39.946148,
  lng: -105.236343
};

// Calculate a bounding box around both points with some buffer
const buffer = 0.001; // ~100 meters
const bbox = {
  minLat: Math.min(ENDPOINT_1.lat, ENDPOINT_2.lat) - buffer,
  maxLat: Math.max(ENDPOINT_1.lat, ENDPOINT_2.lat) + buffer,
  minLng: Math.min(ENDPOINT_1.lng, ENDPOINT_2.lng) - buffer,
  maxLng: Math.max(ENDPOINT_1.lng, ENDPOINT_2.lng) + buffer
};

async function queryOverpass() {
  console.log('🗺️ Querying Overpass API for trails...');
  console.log(`📍 Endpoint 1: ${ENDPOINT_1.lat}, ${ENDPOINT_1.lng}`);
  console.log(`📍 Endpoint 2: ${ENDPOINT_2.lat}, ${ENDPOINT_2.lng}`);
  console.log(`📦 BBox: ${bbox.minLat}, ${bbox.minLng}, ${bbox.maxLat}, ${bbox.maxLng}`);
  
  // Overpass query to find trails in the area
  const overpassQuery = `
    [out:json][timeout:25];
    (
      // Find ways tagged as trails, paths, or footways
      way["highway"="path"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      way["highway"="footway"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      way["highway"="bridleway"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      way["highway"="cycleway"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      way["leisure"="park"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      way["landuse"="recreation_ground"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      
      // Also look for any ways with trail-related names
      way["name"~"trail|path|walk|hike"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      way["name"~"Community Ditch"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    console.log('🔍 Sending query to Overpass API...');
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: overpassQuery
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as any;
    console.log(`✅ Received response with ${data.elements?.length || 0} elements`);

    // Process the results
    const ways = data.elements?.filter((el: any) => el.type === 'way') || [];
    const nodes = data.elements?.filter((el: any) => el.type === 'node') || [];
    
    console.log(`\n📊 Found ${ways.length} ways and ${nodes.length} nodes`);

    // Create a map of node IDs to coordinates
    const nodeMap = new Map();
    nodes.forEach((node: any) => {
      nodeMap.set(node.id, { lat: node.lat, lng: node.lon });
    });

    // Analyze each way
    ways.forEach((way: any, index: number) => {
      console.log(`\n🛤️ Way ${index + 1}:`);
      console.log(`   ID: ${way.id}`);
      console.log(`   Tags:`, way.tags);
      
      if (way.nodes && way.nodes.length > 0) {
        const coordinates = way.nodes.map((nodeId: number) => nodeMap.get(nodeId)).filter(Boolean);
        console.log(`   Nodes: ${way.nodes.length} (${coordinates.length} with coordinates)`);
        
        if (coordinates.length >= 2) {
          const start = coordinates[0];
          const end = coordinates[coordinates.length - 1];
          console.log(`   Start: ${start.lat}, ${start.lng}`);
          console.log(`   End: ${end.lat}, ${end.lng}`);
          
          // Check if this way connects our endpoints
          const distToEndpoint1 = Math.sqrt(
            Math.pow(start.lat - ENDPOINT_1.lat, 2) + Math.pow(start.lng - ENDPOINT_1.lng, 2)
          );
          const distToEndpoint2 = Math.sqrt(
            Math.pow(end.lat - ENDPOINT_2.lat, 2) + Math.pow(end.lng - ENDPOINT_2.lng, 2)
          );
          
          if (distToEndpoint1 < 0.001 && distToEndpoint2 < 0.001) {
            console.log(`   🎯 POTENTIAL MATCH! This way connects our endpoints!`);
          }
        }
      }
    });

    // Generate GeoJSON for visualization
    const geojson = {
      type: 'FeatureCollection',
      features: [
        // Add our endpoints
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [ENDPOINT_1.lng, ENDPOINT_1.lat]
          },
          properties: {
            name: 'Endpoint 1 (Vertex 29)',
            color: '#FF0000'
          }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [ENDPOINT_2.lng, ENDPOINT_2.lat]
          },
          properties: {
            name: 'Endpoint 2 (Vertex 30)',
            color: '#00FF00'
          }
        },
        // Add the ways as LineStrings
        ...ways.map((way: any) => {
          if (way.nodes && way.nodes.length > 0) {
            const coordinates = way.nodes
              .map((nodeId: number) => nodeMap.get(nodeId))
              .filter(Boolean)
              .map((node: any) => [node.lng, node.lat]);
            
            if (coordinates.length >= 2) {
              return {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: coordinates
                },
                properties: {
                  id: way.id,
                  name: way.tags?.name || 'Unnamed trail',
                  highway: way.tags?.highway,
                  ...way.tags
                }
              };
            }
          }
          return null;
        }).filter(Boolean)
      ]
    };

    // Save to file
    const fs = require('fs');
    const outputPath = '/Users/shaydu/dev/carthorse/test-output/overpass-trails.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`\n💾 Saved results to: ${outputPath}`);

  } catch (error: any) {
    console.error('❌ Error querying Overpass API:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

queryOverpass();
