#!/usr/bin/env node

// Debug script to analyze why a point is not splitting and snapping to a LineString

const point = {
  type: "Point",
  coordinates: [-105.263325, 39.94533, 0]
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

console.log('🔍 Analyzing point-to-LineString relationship...\n');

console.log('📍 Point coordinates:', point.coordinates);
console.log('📏 LineString has', lineString.coordinates.length, 'vertices\n');

// Find closest point on LineString
const result = closestPointOnLineString(point.coordinates, lineString);

console.log('🎯 Closest point on LineString:', result.closestPoint);
console.log('📏 Distance to closest point:', result.minDistance.toFixed(3), 'meters');
console.log('📍 Closest segment index:', result.segmentIndex);

// Check if the point is very close to any vertex
console.log('\n🔍 Checking distance to each vertex:');
lineString.coordinates.forEach((vertex, index) => {
  const distance = calculateDistance(
    point.coordinates[1], point.coordinates[0],
    vertex[1], vertex[0]
  );
  console.log(`   Vertex ${index}: (${vertex[0]}, ${vertex[1]}) - ${distance.toFixed(3)}m`);
});

// Check if the point is very close to the line
console.log('\n🔍 Checking distance to each line segment:');
for (let i = 0; i < lineString.coordinates.length - 1; i++) {
  const segmentStart = lineString.coordinates[i];
  const segmentEnd = lineString.coordinates[i + 1];
  
  const closest = closestPointOnLineSegment(point.coordinates, segmentStart, segmentEnd);
  const distance = calculateDistance(
    point.coordinates[1], point.coordinates[0],
    closest[1], closest[0]
  );
  
  console.log(`   Segment ${i}-${i+1}: ${distance.toFixed(3)}m`);
}

// Check if the point is within typical snapping tolerance
const typicalTolerance = 5; // 5 meters
console.log(`\n🎯 Analysis Results:`);
console.log(`   • Minimum distance: ${result.minDistance.toFixed(3)}m`);
console.log(`   • Typical snapping tolerance: ${typicalTolerance}m`);
console.log(`   • Should snap: ${result.minDistance <= typicalTolerance ? 'YES' : 'NO'}`);

if (result.minDistance > typicalTolerance) {
  console.log(`\n❌ Point is ${result.minDistance.toFixed(3)}m away from LineString`);
  console.log(`   This exceeds typical snapping tolerance of ${typicalTolerance}m`);
  console.log(`   Possible reasons:`);
  console.log(`   1. Snapping tolerance is too small`);
  console.log(`   2. Point is not actually on the trail`);
  console.log(`   3. LineString geometry is incorrect`);
  console.log(`   4. Coordinate precision issues`);
} else {
  console.log(`\n✅ Point should snap to LineString`);
  console.log(`   Distance (${result.minDistance.toFixed(3)}m) is within tolerance`);
}

// Check if the point is between the first and last vertices (rough bounds check)
const firstVertex = lineString.coordinates[0];
const lastVertex = lineString.coordinates[lineString.coordinates.length - 1];

const minLng = Math.min(firstVertex[0], lastVertex[0]);
const maxLng = Math.max(firstVertex[0], lastVertex[0]);
const minLat = Math.min(firstVertex[1], lastVertex[1]);
const maxLat = Math.max(firstVertex[1], lastVertex[1]);

const pointLng = point.coordinates[0];
const pointLat = point.coordinates[1];

console.log(`\n📦 Bounds check:`);
console.log(`   LineString bounds: Lng[${minLng}, ${maxLng}], Lat[${minLat}, ${maxLat}]`);
console.log(`   Point: (${pointLng}, ${pointLat})`);
console.log(`   Within bounds: ${pointLng >= minLng && pointLng <= maxLng && pointLat >= minLat && pointLat <= maxLat ? 'YES' : 'NO'}`);


