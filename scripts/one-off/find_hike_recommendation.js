const Database = require('better-sqlite3');

console.log('🏔️ Finding 20km hike with 70m/km gain...');

// Open the SQLite database
const db = new Database('./test-export-no-split-trails.db');

// Target specifications
const targetDistance = 20.0; // km
const targetGainPerKm = 70.0; // m/km
const targetTotalGain = targetDistance * targetGainPerKm; // 1400m total gain

console.log(`\n🎯 TARGET SPECIFICATIONS:`);
console.log(`   Distance: ${targetDistance}km`);
console.log(`   Gain per km: ${targetGainPerKm}m/km`);
console.log(`   Total gain: ${targetTotalGain}m`);

// Find individual trail segments that could be part of a good route
console.log('\n📊 ANALYZING AVAILABLE TRAILS...');

const trailStats = db.prepare(`
  SELECT 
    trail_name,
    COUNT(*) as segment_count,
    ROUND(SUM(distance_km), 2) as total_distance,
    ROUND(SUM(elevation_gain), 0) as total_gain,
    ROUND(SUM(elevation_loss), 0) as total_loss,
    ROUND(SUM(elevation_gain) / SUM(distance_km), 1) as gain_per_km,
    ROUND(SUM(distance_km) / COUNT(*), 2) as avg_segment_length
  FROM routing_edges 
  GROUP BY trail_name
  HAVING SUM(distance_km) >= 2.0  -- Only trails with at least 2km total
  ORDER BY gain_per_km DESC
  LIMIT 20
`).all();

console.log('\n🏃 TOP TRAILS BY ELEVATION GAIN PER KM:');
trailStats.forEach((trail, index) => {
  console.log(`${index + 1}. ${trail.trail_name}`);
  console.log(`   Distance: ${trail.total_distance}km, Gain: ${trail.total_gain}m (${trail.gain_per_km}m/km)`);
  console.log(`   Segments: ${trail.segment_count}, Avg segment: ${trail.avg_segment_length}km`);
});

// Find potential route combinations
console.log('\n🔍 SEARCHING FOR ROUTE COMBINATIONS...');

// Get all trail segments with good elevation gain
const highGainSegments = db.prepare(`
  SELECT 
    trail_name,
    distance_km,
    elevation_gain,
    elevation_loss,
    ROUND(elevation_gain / distance_km, 1) as gain_per_km,
    source,
    target
  FROM routing_edges 
  WHERE elevation_gain / distance_km >= 50  -- At least 50m/km gain
    AND distance_km >= 0.5  -- At least 0.5km segments
  ORDER BY gain_per_km DESC
  LIMIT 50
`).all();

console.log(`\n📈 Found ${highGainSegments.length} high-gain trail segments`);

// Find connected trail segments to build routes
const findConnectedRoutes = () => {
  const routes = [];
  const visited = new Set();
  
  // Start with high-gain segments
  highGainSegments.forEach(segment => {
    if (visited.has(segment.source)) return;
    
    const route = {
      segments: [segment],
      totalDistance: segment.distance_km,
      totalGain: segment.elevation_gain,
      totalLoss: segment.elevation_loss,
      trailNames: new Set([segment.trail_name])
    };
    
    // Try to extend the route
    let current = segment.target;
    visited.add(segment.source);
    
    // Look for connected segments
    for (let i = 0; i < 10; i++) { // Limit to prevent infinite loops
      const nextSegments = db.prepare(`
        SELECT 
          trail_name,
          distance_km,
          elevation_gain,
          elevation_loss,
          ROUND(elevation_gain / distance_km, 1) as gain_per_km,
          source,
          target
        FROM routing_edges 
        WHERE source = ? 
          AND elevation_gain / distance_km >= 30  -- At least 30m/km for connected segments
          AND distance_km >= 0.3
        ORDER BY gain_per_km DESC
        LIMIT 3
      `).all(current);
      
      if (nextSegments.length === 0) break;
      
      const nextSegment = nextSegments[0];
      route.segments.push(nextSegment);
      route.totalDistance += nextSegment.distance_km;
      route.totalGain += nextSegment.elevation_gain;
      route.totalLoss += nextSegment.elevation_loss;
      route.trailNames.add(nextSegment.trail_name);
      
      current = nextSegment.target;
      
      // Stop if we've reached target distance
      if (route.totalDistance >= targetDistance * 0.8) break;
    }
    
    // Calculate route metrics
    route.gainPerKm = route.totalGain / route.totalDistance;
    route.trailNames = Array.from(route.trailNames);
    
    // Only include routes that are close to our target
    if (route.totalDistance >= targetDistance * 0.7 && 
        route.totalDistance <= targetDistance * 1.3 &&
        route.gainPerKm >= targetGainPerKm * 0.7) {
      routes.push(route);
    }
  });
  
  return routes;
};

const potentialRoutes = findConnectedRoutes();

console.log(`\n🎯 FOUND ${potentialRoutes.length} POTENTIAL ROUTES:`);

potentialRoutes.forEach((route, index) => {
  console.log(`\n${index + 1}. ROUTE ${index + 1}:`);
  console.log(`   Distance: ${route.totalDistance.toFixed(1)}km`);
  console.log(`   Total Gain: ${route.totalGain}m`);
  console.log(`   Gain per km: ${route.gainPerKm.toFixed(1)}m/km`);
  console.log(`   Trails: ${route.trailNames.join(', ')}`);
  console.log(`   Segments: ${route.segments.length}`);
  
  // Show segment breakdown
  route.segments.forEach((segment, segIndex) => {
    console.log(`     ${segIndex + 1}. ${segment.trail_name}: ${segment.distance_km.toFixed(2)}km, +${segment.elevation_gain}m`);
  });
});

// Find the best route that matches our criteria
const bestRoutes = potentialRoutes
  .filter(route => 
    Math.abs(route.totalDistance - targetDistance) <= 3 && // Within 3km of target
    Math.abs(route.gainPerKm - targetGainPerKm) <= 20    // Within 20m/km of target
  )
  .sort((a, b) => {
    // Score based on how close to target specifications
    const distanceScore = Math.abs(a.totalDistance - targetDistance) - Math.abs(b.totalDistance - targetDistance);
    const gainScore = Math.abs(a.gainPerKm - targetGainPerKm) - Math.abs(b.gainPerKm - targetGainPerKm);
    return distanceScore + gainScore;
  });

console.log(`\n🏆 BEST MATCHES (${bestRoutes.length} routes):`);

bestRoutes.forEach((route, index) => {
  console.log(`\n🥇 RECOMMENDED ROUTE ${index + 1}:`);
  console.log(`   📏 Distance: ${route.totalDistance.toFixed(1)}km (Target: ${targetDistance}km)`);
  console.log(`   ⬆️  Total Gain: ${route.totalGain}m`);
  console.log(`   📈 Gain per km: ${route.gainPerKm.toFixed(1)}m/km (Target: ${targetGainPerKm}m/km)`);
  console.log(`   🏔️  Trails: ${route.trailNames.join(', ')}`);
  console.log(`   🔗 Segments: ${route.segments.length}`);
  
  console.log(`\n   📋 SEGMENT BREAKDOWN:`);
  route.segments.forEach((segment, segIndex) => {
    const gainPerKm = segment.elevation_gain / segment.distance_km;
    console.log(`     ${segIndex + 1}. ${segment.trail_name}`);
    console.log(`        Distance: ${segment.distance_km.toFixed(2)}km`);
    console.log(`        Elevation: +${segment.elevation_gain}m/-${segment.elevation_loss}m`);
    console.log(`        Gain per km: ${gainPerKm.toFixed(1)}m/km`);
  });
  
  // Calculate actual specs vs target
  const distanceDiff = Math.abs(route.totalDistance - targetDistance);
  const gainDiff = Math.abs(route.gainPerKm - targetGainPerKm);
  
  console.log(`\n   ✅ SPECIFICATION MATCH:`);
  console.log(`      Distance: ${distanceDiff.toFixed(1)}km ${distanceDiff <= 2 ? '✅' : '⚠️'} from target`);
  console.log(`      Gain per km: ${gainDiff.toFixed(1)}m/km ${gainDiff <= 15 ? '✅' : '⚠️'} from target`);
});

if (bestRoutes.length === 0) {
  console.log('\n❌ No routes found that closely match your specifications.');
  console.log('💡 Try adjusting your criteria or check available trails above.');
}

// Show overall statistics
const totalTrails = db.prepare('SELECT COUNT(DISTINCT trail_name) as count FROM routing_edges').get().count;
const avgGainPerKm = db.prepare(`
  SELECT ROUND(AVG(elevation_gain / distance_km), 1) as avg_gain_per_km
  FROM routing_edges 
  WHERE distance_km > 0
`).get().avg_gain_per_km;

console.log(`\n📊 DATASET STATISTICS:`);
console.log(`   Total unique trails: ${totalTrails}`);
console.log(`   Average gain per km: ${avgGainPerKm}m/km`);
console.log(`   High-gain segments (≥50m/km): ${highGainSegments.length}`);

db.close(); 