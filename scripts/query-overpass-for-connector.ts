#!/usr/bin/env ts-node

/**
 * Query Overpass API for trails that could connect a specific endpoint
 * to the existing trail network
 */

import axios from 'axios';

interface OverpassResponse {
  elements: Array<{
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
    nodes?: number[];
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

async function queryOverpassForConnector(
  endpointLat: number,
  endpointLng: number,
  searchRadiusMeters: number = 500
): Promise<void> {
  console.log(`🔍 Querying Overpass API for trails near endpoint:`);
  console.log(`   Lat: ${endpointLat}, Lng: ${endpointLng}`);
  console.log(`   Search radius: ${searchRadiusMeters}m`);
  
  // Convert meters to degrees (approximate)
  const radiusDegrees = searchRadiusMeters / 111000.0;
  
  // Overpass query to find hiking trails near the endpoint
  const overpassQuery = `
    [out:json][timeout:25];
    (
      // Find hiking trails within radius
      way["highway"="path"]["foot"!="no"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
      way["highway"="footway"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
      way["highway"="pedestrian"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
      way["route"="hiking"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
      way["leisure"="park"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
      
      // Also find any paths that might be trails
      way["highway"="track"]["foot"!="no"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
      way["highway"="service"]["foot"!="no"](around:${searchRadiusMeters},${endpointLat},${endpointLng});
    );
    out body;
    >;
    out skel qt;
  `;
  
  try {
    console.log('🌐 Sending query to Overpass API...');
    const response = await axios.post('https://overpass-api.de/api/interpreter', overpassQuery, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    });
    
    const data: OverpassResponse = response.data;
    console.log(`✅ Received ${data.elements.length} elements from Overpass API`);
    
    // Filter and analyze the results
    const trails = data.elements.filter(element => 
      element.type === 'way' && 
      element.tags && 
      (element.tags.highway === 'path' || 
       element.tags.highway === 'footway' || 
       element.tags.highway === 'pedestrian' ||
       element.tags.route === 'hiking' ||
       element.tags.leisure === 'park')
    );
    
    console.log(`\n📊 Found ${trails.length} potential trail connectors:`);
    
    trails.forEach((trail, index) => {
      console.log(`\n${index + 1}. Trail ID: ${trail.id}`);
      console.log(`   Type: ${trail.tags?.highway || trail.tags?.route || trail.tags?.leisure}`);
      console.log(`   Name: ${trail.tags?.name || 'Unnamed'}`);
      console.log(`   Surface: ${trail.tags?.surface || 'Unknown'}`);
      console.log(`   Access: ${trail.tags?.foot || 'Unknown'}`);
      
      if (trail.geometry && trail.geometry.length > 0) {
        const startPoint = trail.geometry[0];
        const endPoint = trail.geometry[trail.geometry.length - 1];
        const distanceToEndpoint = calculateDistance(endpointLat, endpointLng, startPoint.lat, startPoint.lon);
        const distanceToEndpointEnd = calculateDistance(endpointLat, endpointLng, endPoint.lat, endPoint.lon);
        
        console.log(`   Start point: ${startPoint.lat}, ${startPoint.lon} (${distanceToEndpoint.toFixed(0)}m from endpoint)`);
        console.log(`   End point: ${endPoint.lat}, ${endPoint.lon} (${distanceToEndpointEnd.toFixed(0)}m from endpoint)`);
        console.log(`   Length: ${trail.geometry.length} points`);
      }
    });
    
    // Generate SQL insert statements for the trails
    console.log(`\n📝 SQL INSERT statements for trail_master_db.public.trails:`);
    console.log(`-- Generated from Overpass API query for endpoint at ${endpointLat}, ${endpointLng}`);
    console.log(`-- Search radius: ${searchRadiusMeters}m`);
    console.log(``);
    
    trails.forEach((trail, index) => {
      if (trail.geometry && trail.geometry.length > 0) {
        const geomString = generateGeometryString(trail.geometry);
        const name = trail.tags?.name || `Overpass_Trail_${trail.id}`;
        const trailType = trail.tags?.highway || trail.tags?.route || trail.tags?.leisure || 'hiking';
        const surface = trail.tags?.surface || 'dirt';
        
        console.log(`-- Trail ${index + 1}: ${name}`);
        console.log(`INSERT INTO public.trails (app_uuid, name, trail_type, surface, difficulty, geometry, region) VALUES (`);
        console.log(`  gen_random_uuid(),`);
        console.log(`  '${name.replace(/'/g, "''")}',`);
        console.log(`  '${trailType}',`);
        console.log(`  '${surface}',`);
        console.log(`  'moderate',`);
        console.log(`  ST_GeomFromText('${geomString}', 4326),`);
        console.log(`  'boulder'`);
        console.log(`);`);
        console.log(``);
      }
    });
    
  } catch (error) {
    console.error('❌ Error querying Overpass API:', error);
    if (axios.isAxiosError(error)) {
      console.error('Response status:', error.response?.status);
      console.error('Response data:', error.response?.data);
    }
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function generateGeometryString(geometry: Array<{ lat: number; lon: number }>): string {
  const coords = geometry.map(point => `${point.lon} ${point.lat}`).join(', ');
  return `LINESTRING(${coords})`;
}

// Main execution
if (require.main === module) {
  const endpointLat = 39.9821284;
  const endpointLng = -105.3014917;
  const searchRadius = 500; // meters
  
  queryOverpassForConnector(endpointLat, endpointLng, searchRadius)
    .then(() => {
      console.log('\n✅ Overpass query completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}
