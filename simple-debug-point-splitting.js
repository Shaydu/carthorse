#!/usr/bin/env node

// Simple debug script to analyze the point splitting issue without complex PostGIS queries

const point = {
  lng: -105.263325,
  lat: 39.94533,
  elevation: 0
};

const lineString = {
  type: "LineString",
  coordinates: [
    [-105.26319, 39.94443, 0],
    [-105.263354, 39.945464, 1761.583496],
    [-105.263449, 39.945806, 1765.240479],
    [-105.263591, 39.946166, 1769.123413],
    [-105.263768, 39.946391, 1772.354126],
    [-105.26392, 39.946534, 1774.323853],
    [-105.264073, 39.946759, 1775.359131],
    [-105.264402, 39.946984, 1779.054565],
    [-105.264637, 39.9471, 1781.261719],
    [-105.265141, 39.947279, 1785.730713],
    [-105.265422, 39.947333, 1787.912964],
    [-105.265797, 39.947359, 1790.001465],
    [-105.265984, 39.947323, 1792.239258],
    [-105.266025, 39.94731, 0]
  ]
};

// Function to calculate distance between two points in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Function to find the closest point on a line segment
function closestPointOnLineSegment(point, lineStart, lineEnd) {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) return lineStart;
  
  const param = dot / lenSq;
  
  if (param < 0) return lineStart;
  if (param > 1) return lineEnd;
  
  return [x1 + param * C, y1 + param * D];
}

// Function to find the closest point on the entire LineString
function closestPointOnLineString(point, lineString) {
  const [px, py] = point;
  let minDistance = Infinity;
  let closestPoint = null;
  let closestSegmentIndex = -1;
  
  for (let i = 0; i < lineString.coordinates.length - 1; i++) {
    const segmentStart = lineString.coordinates[i];
    const segmentEnd = lineString.coordinates[i + 1];
    
    const closest = closestPointOnLineSegment([px, py], segmentStart, segmentEnd);
    const distance = calculateDistance(py, px, closest[1], closest[0]);
    
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = closest;
      closestSegmentIndex = i;
    }
  }
  
  return { closestPoint, minDistance, segmentIndex: closestSegmentIndex };
}

console.log('🔍 Root Cause Analysis: Why Point is Not Splitting and Snapping\n');

console.log('📍 Problem Point:', point);
console.log('📏 LineString has', lineString.coordinates.length, 'vertices\n');

// Find closest point on LineString
const result = closestPointOnLineString([point.lng, point.lat], lineString);

console.log('🎯 Closest point on LineString:', result.closestPoint);
console.log('📏 Distance to closest point:', result.minDistance.toFixed(3), 'meters');
console.log('📍 Closest segment index:', result.segmentIndex);

// Check distances to all vertices
console.log('\n🔍 Distance to each vertex:');
lineString.coordinates.forEach((vertex, index) => {
  const distance = calculateDistance(
    point.lat, point.lng,
    vertex[1], vertex[0]
  );
  console.log(`   Vertex ${index}: (${vertex[0]}, ${vertex[1]}) - ${distance.toFixed(3)}m`);
});

// Check distances to line segments
console.log('\n🔍 Distance to each line segment:');
for (let i = 0; i < lineString.coordinates.length - 1; i++) {
  const segmentStart = lineString.coordinates[i];
  const segmentEnd = lineString.coordinates[i + 1];
  
  const closest = closestPointOnLineSegment([point.lng, point.lat], segmentStart, segmentEnd);
  const distance = calculateDistance(
    point.lat, point.lng,
    closest[1], closest[0]
  );
  
  console.log(`   Segment ${i}-${i+1}: ${distance.toFixed(3)}m`);
}

// Analysis of potential issues
console.log('\n🎯 Root Cause Analysis:');
console.log(`   • Distance to LineString: ${result.minDistance.toFixed(3)}m`);

// Check if point is very close to any vertex (within 5m)
const closestVertexDistance = Math.min(...lineString.coordinates.map(vertex => 
  calculateDistance(point.lat, point.lng, vertex[1], vertex[0])
));

console.log(`   • Distance to closest vertex: ${closestVertexDistance.toFixed(3)}m`);

// Check if point is very close to start or end points
const startDistance = calculateDistance(point.lat, point.lng, lineString.coordinates[0][1], lineString.coordinates[0][0]);
const endDistance = calculateDistance(point.lat, point.lng, lineString.coordinates[lineString.coordinates.length-1][1], lineString.coordinates[lineString.coordinates.length-1][0]);

console.log(`   • Distance to start point: ${startDistance.toFixed(3)}m`);
console.log(`   • Distance to end point: ${endDistance.toFixed(3)}m`);

console.log('\n🔍 Potential Issues:');

// Issue 1: Point too close to endpoints
if (Math.min(startDistance, endDistance) < 5.0) {
  console.log('   ❌ ISSUE 1: Point is very close to start or end point (< 5m)');
  console.log('      → PointSnapAndSplitService excludes trails where target point is within 5m of endpoints');
  console.log('      → This prevents splitting to avoid creating very short segments');
}

// Issue 2: Snapping tolerance
const typicalTolerance = 10; // Default tolerance in PointSnapAndSplitService
if (result.minDistance > typicalTolerance) {
  console.log('   ❌ ISSUE 2: Point exceeds snapping tolerance');
  console.log(`      → Distance (${result.minDistance.toFixed(3)}m) > tolerance (${typicalTolerance}m)`);
} else {
  console.log('   ✅ Distance is within snapping tolerance');
}

// Issue 3: Minimum split distance
const minSplitDistance = 1.0; // From PointSnapAndSplitService line 230
const minDistanceToEndpoint = Math.min(startDistance, endDistance);
if (minDistanceToEndpoint <= minSplitDistance) {
  console.log('   ❌ ISSUE 3: Point too close to endpoints for splitting');
  console.log(`      → Distance to nearest endpoint (${minDistanceToEndpoint.toFixed(3)}m) <= minimum split distance (${minSplitDistance}m)`);
  console.log('      → PointSnapAndSplitService will not split if point is within 1m of endpoints');
}

// Issue 4: Point might be on a different trail
console.log('   ❓ ISSUE 4: Point might be on a different trail');
console.log('      → The LineString provided might not be the actual trail in the database');
console.log('      → There might be multiple trails in the area');

console.log('\n💡 Recommended Solutions:');
console.log('   1. Check if the point is actually on the correct trail in the database');
console.log('   2. Verify the trail geometry matches the provided LineString');
console.log('   3. Check if there are multiple trails in the area that might be interfering');
console.log('   4. Consider reducing the endpoint exclusion distance from 5m to 2m');
console.log('   5. Consider reducing the minimum split distance from 1m to 0.5m');
console.log('   6. Check if the trail has already been processed/split');

console.log('\n🔧 Debugging Steps:');
console.log('   1. Query the database to find trails near this point');
console.log('   2. Check if any trails have been split at this location');
console.log('   3. Verify the trail geometry in the database matches the provided LineString');
console.log('   4. Check if there are existing routing nodes at this location');
console.log('   5. Test with different snapping tolerances (1m, 2m, 5m, 10m)');


