import * as fs from 'fs';
import * as path from 'path';

interface TrailFeature {
  type: string;
  properties: {
    id: string;
    name: string;
    trail_id?: string;
    trail_name?: string;
    [key: string]: any;
  };
  geometry: {
    type: string;
    coordinates: number[][];
  };
}

interface GeoJSON {
  type: string;
  features: TrailFeature[];
}

function calculateDistance(coord1: number[], coord2: number[]): number {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;
  
  // Convert to radians
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const deltaLat = (lat2 - lat1) * Math.PI / 180;
  const deltaLng = (lng2 - lng1) * Math.PI / 180;
  
  // Haversine formula
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  // Earth's radius in meters
  const R = 6371000;
  return R * c;
}

function findClosestPointOnLine(lineCoords: number[][], point: number[]): { point: number[], distance: number, ratio: number } {
  let minDistance = Infinity;
  let closestPoint: number[] = [0, 0];
  let closestRatio = 0;
  
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const start = lineCoords[i];
    const end = lineCoords[i + 1];
    
    // Calculate ratio along this segment
    const segmentLength = calculateDistance(start, end);
    if (segmentLength === 0) continue;
    
    // Vector from start to end
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    
    // Vector from start to point
    const px = point[0] - start[0];
    const py = point[1] - start[1];
    
    // Projection ratio
    const ratio = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
    
    // Closest point on this segment
    const closest = [
      start[0] + ratio * dx,
      start[1] + ratio * dy
    ];
    
    const distance = calculateDistance(point, closest);
    
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = closest;
      closestRatio = (i + ratio) / (lineCoords.length - 1);
    }
  }
  
  return { point: closestPoint, distance: minDistance, ratio: closestRatio };
}

async function analyzeNCAREndpoints() {
  const geojsonPath = 'test-output/boulder-fixed-tolerance.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.log('❌ GeoJSON file not found:', geojsonPath);
    return;
  }
  
  const geojson: GeoJSON = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Find NCAR trails
  const ncarTrail = geojson.features.find(f => 
    f.properties.name?.toLowerCase().includes('ncar trail') && 
    !f.properties.name?.toLowerCase().includes('water tank')
  );
  
  const ncarWaterTankRoad = geojson.features.find(f => 
    f.properties.name?.toLowerCase().includes('ncar water tank road')
  );
  
  if (!ncarTrail) {
    console.log('❌ NCAR Trail not found');
    return;
  }
  
  if (!ncarWaterTankRoad) {
    console.log('❌ NCAR Water Tank Road not found');
    return;
  }
  
  console.log('🔍 Analyzing NCAR Trail and NCAR Water Tank Road endpoints...\n');
  
  console.log(`📊 NCAR Trail:`);
  console.log(`   Name: ${ncarTrail.properties.name}`);
  console.log(`   ID: ${ncarTrail.properties.id}`);
  console.log(`   Coordinates: ${ncarTrail.geometry.coordinates.length} points`);
  
  console.log(`\n📊 NCAR Water Tank Road:`);
  console.log(`   Name: ${ncarWaterTankRoad.properties.name}`);
  console.log(`   ID: ${ncarWaterTankRoad.properties.id}`);
  console.log(`   Coordinates: ${ncarWaterTankRoad.geometry.coordinates.length} points`);
  
  // Get endpoints of NCAR Water Tank Road
  const waterTankCoords = ncarWaterTankRoad.geometry.coordinates;
  const waterTankStart = waterTankCoords[0];
  const waterTankEnd = waterTankCoords[waterTankCoords.length - 1];
  
  console.log(`\n📍 NCAR Water Tank Road endpoints:`);
  console.log(`   Start: [${waterTankStart[0].toFixed(6)}, ${waterTankStart[1].toFixed(6)}]`);
  console.log(`   End: [${waterTankEnd[0].toFixed(6)}, ${waterTankEnd[1].toFixed(6)}]`);
  
  // Get endpoints of NCAR Trail
  const ncarTrailCoords = ncarTrail.geometry.coordinates;
  const ncarTrailStart = ncarTrailCoords[0];
  const ncarTrailEnd = ncarTrailCoords[ncarTrailCoords.length - 1];
  
  console.log(`\n📍 NCAR Trail endpoints:`);
  console.log(`   Start: [${ncarTrailStart[0].toFixed(6)}, ${ncarTrailStart[1].toFixed(6)}]`);
  console.log(`   End: [${ncarTrailEnd[0].toFixed(6)}, ${ncarTrailEnd[1].toFixed(6)}]`);
  
  // Calculate distances from NCAR Trail endpoints to NCAR Water Tank Road
  const ncarStartToWaterTankStart = calculateDistance(ncarTrailStart, waterTankStart);
  const ncarStartToWaterTankEnd = calculateDistance(ncarTrailStart, waterTankEnd);
  const ncarEndToWaterTankStart = calculateDistance(ncarTrailEnd, waterTankStart);
  const ncarEndToWaterTankEnd = calculateDistance(ncarTrailEnd, waterTankEnd);
  
  console.log(`\n📏 Distances from NCAR Trail endpoints to NCAR Water Tank Road endpoints:`);
  console.log(`   NCAR Trail Start → Water Tank Start: ${ncarStartToWaterTankStart.toFixed(1)}m`);
  console.log(`   NCAR Trail Start → Water Tank End: ${ncarStartToWaterTankEnd.toFixed(1)}m`);
  console.log(`   NCAR Trail End → Water Tank Start: ${ncarEndToWaterTankStart.toFixed(1)}m`);
  console.log(`   NCAR Trail End → Water Tank End: ${ncarEndToWaterTankEnd.toFixed(1)}m`);
  
  // Find closest endpoint pair
  const distances = [
    { from: 'NCAR Trail Start', to: 'Water Tank Start', distance: ncarStartToWaterTankStart },
    { from: 'NCAR Trail Start', to: 'Water Tank End', distance: ncarStartToWaterTankEnd },
    { from: 'NCAR Trail End', to: 'Water Tank Start', distance: ncarEndToWaterTankStart },
    { from: 'NCAR Trail End', to: 'Water Tank End', distance: ncarEndToWaterTankEnd }
  ];
  
  const closest = distances.reduce((min, curr) => curr.distance < min.distance ? curr : min);
  
  console.log(`\n🎯 Closest endpoint pair:`);
  console.log(`   ${closest.from} → ${closest.to}: ${closest.distance.toFixed(1)}m`);
  
  // Check if this distance is within our tolerance (3m from Layer 1 config)
  const tolerance = 3.0; // meters
  console.log(`\n⚙️  T-intersection tolerance: ${tolerance}m`);
  console.log(`   Within tolerance: ${closest.distance <= tolerance ? '✅ YES' : '❌ NO'}`);
  
  // Also check the reverse - Water Tank endpoints to NCAR Trail
  const waterTankStartToNcarStart = calculateDistance(waterTankStart, ncarTrailStart);
  const waterTankStartToNcarEnd = calculateDistance(waterTankStart, ncarTrailEnd);
  const waterTankEndToNcarStart = calculateDistance(waterTankEnd, ncarTrailStart);
  const waterTankEndToNcarEnd = calculateDistance(waterTankEnd, ncarTrailEnd);
  
  console.log(`\n📏 Distances from NCAR Water Tank Road endpoints to NCAR Trail endpoints:`);
  console.log(`   Water Tank Start → NCAR Trail Start: ${waterTankStartToNcarStart.toFixed(1)}m`);
  console.log(`   Water Tank Start → NCAR Trail End: ${waterTankStartToNcarEnd.toFixed(1)}m`);
  console.log(`   Water Tank End → NCAR Trail Start: ${waterTankEndToNcarStart.toFixed(1)}m`);
  console.log(`   Water Tank End → NCAR Trail End: ${waterTankEndToNcarEnd.toFixed(1)}m`);
  
  // Check if any Water Tank endpoint is close to NCAR Trail midpoint
  const ncarTrailMidpoint = ncarTrailCoords[Math.floor(ncarTrailCoords.length / 2)];
  const waterTankStartToNcarMidpoint = calculateDistance(waterTankStart, ncarTrailMidpoint);
  const waterTankEndToNcarMidpoint = calculateDistance(waterTankEnd, ncarTrailMidpoint);
  
  console.log(`\n📍 NCAR Trail midpoint: [${ncarTrailMidpoint[0].toFixed(6)}, ${ncarTrailMidpoint[1].toFixed(6)}]`);
  console.log(`📏 Distances from NCAR Water Tank Road endpoints to NCAR Trail midpoint:`);
  console.log(`   Water Tank Start → NCAR Trail Midpoint: ${waterTankStartToNcarMidpoint.toFixed(1)}m`);
  console.log(`   Water Tank End → NCAR Trail Midpoint: ${waterTankEndToNcarMidpoint.toFixed(1)}m`);
  
  // Check if any endpoint is close to the other trail's line (not just endpoints)
  const waterTankClosestToNcarTrail = findClosestPointOnLine(ncarTrailCoords, waterTankStart);
  const waterTankEndClosestToNcarTrail = findClosestPointOnLine(ncarTrailCoords, waterTankEnd);
  
  console.log(`\n🔗 Closest point on NCAR Trail to Water Tank endpoints:`);
  console.log(`   Water Tank Start → NCAR Trail: ${waterTankClosestToNcarTrail.distance.toFixed(1)}m (at ${(waterTankClosestToNcarTrail.ratio * 100).toFixed(1)}% along trail)`);
  console.log(`   Water Tank End → NCAR Trail: ${waterTankEndClosestToNcarTrail.distance.toFixed(1)}m (at ${(waterTankEndClosestToNcarTrail.ratio * 100).toFixed(1)}% along trail)`);
  
  const ncarTrailClosestToWaterTank = findClosestPointOnLine(waterTankCoords, ncarTrailStart);
  const ncarTrailEndClosestToWaterTank = findClosestPointOnLine(waterTankCoords, ncarTrailEnd);
  
  console.log(`\n🔗 Closest point on Water Tank Road to NCAR Trail endpoints:`);
  console.log(`   NCAR Trail Start → Water Tank: ${ncarTrailClosestToWaterTank.distance.toFixed(1)}m (at ${(ncarTrailClosestToWaterTank.ratio * 100).toFixed(1)}% along road)`);
  console.log(`   NCAR Trail End → Water Tank: ${ncarTrailEndClosestToWaterTank.distance.toFixed(1)}m (at ${(ncarTrailEndClosestToWaterTank.ratio * 100).toFixed(1)}% along road)`);
  
  // Summary
  console.log(`\n📋 Summary:`);
  console.log(`   NCAR Trail segments: ${geojson.features.filter(f => f.properties.name?.toLowerCase().includes('ncar trail') && !f.properties.name?.toLowerCase().includes('water tank')).length}`);
  console.log(`   NCAR Water Tank Road segments: ${geojson.features.filter(f => f.properties.name?.toLowerCase().includes('ncar water tank road')).length}`);
  
  const minDistance = Math.min(
    waterTankClosestToNcarTrail.distance,
    waterTankEndClosestToNcarTrail.distance,
    ncarTrailClosestToWaterTank.distance,
    ncarTrailEndClosestToWaterTank.distance
  );
  
  console.log(`   Minimum distance between trails: ${minDistance.toFixed(1)}m`);
  console.log(`   Should be split: ${minDistance <= tolerance ? '✅ YES' : '❌ NO'}`);
}

analyzeNCAREndpoints().catch(console.error);
