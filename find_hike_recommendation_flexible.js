const Database = require('better-sqlite3');

console.log('🏔️ Finding 20km hike with flexible elevation criteria...');

// Open the SQLite database
const db = new Database('./test-export-no-split-trails.db');

// Target specifications (more flexible)
const targetDistance = 20.0; // km
const targetGainPerKm = 70.0; // m/km (but we'll be flexible)
const targetTotalGain = targetDistance * targetGainPerKm; // 1400m total gain

console.log(`\n🎯 TARGET SPECIFICATIONS:`);
console.log(`   Distance: ${targetDistance}km`);
console.log(`   Gain per km: ${targetGainPerKm}m/km`);
console.log(`   Total gain: ${targetTotalGain}m`);

// First, let's see what elevation ranges we actually have
console.log('\n📊 ANALYZING ELEVATION RANGES IN OUR DATA...');

const elevationRanges = db.prepare(`
  SELECT 
    CASE 
      WHEN elevation_gain / distance_km < 50 THEN 'Low (<50m/km)'
      WHEN elevation_gain / distance_km < 100 THEN 'Moderate (50-100m/km)'
      WHEN elevation_gain / distance_km < 200 THEN 'High (100-200m/km)'
      WHEN elevation_gain / distance_km < 300 THEN 'Very High (200-300m/km)'
      ELSE 'Extreme (>300m/km)'
    END as elevation_category,
    COUNT(*) as segment_count,
    ROUND(AVG(elevation_gain / distance_km), 1) as avg_gain_per_km,
    ROUND(SUM(distance_km), 1) as total_distance
  FROM routing_edges 
  WHERE distance_km > 0
  GROUP BY 
    CASE 
      WHEN elevation_gain / distance_km < 50 THEN 'Low (<50m/km)'
      WHEN elevation_gain / distance_km < 100 THEN 'Moderate (50-100m/km)'
      WHEN elevation_gain / distance_km < 200 THEN 'High (100-200m/km)'
      WHEN elevation_gain / distance_km < 300 THEN 'Very High (200-300m/km)'
      ELSE 'Extreme (>300m/km)'
    END
  ORDER BY avg_gain_per_km
`).all();

console.log('\n📈 ELEVATION DISTRIBUTION:');
elevationRanges.forEach(range => {
  console.log(`   ${range.elevation_category}: ${range.segment_count} segments, ${range.total_distance}km total, avg ${range.avg_gain_per_km}m/km`);
});

// Find trails that could work for a 20km route
console.log('\n🔍 SEARCHING FOR 20KM ROUTE CANDIDATES...');

// Strategy 1: Find individual long trails that could be the main component
const longTrails = db.prepare(`
  SELECT 
    trail_name,
    COUNT(*) as segment_count,
    ROUND(SUM(distance_km), 1) as total_distance,
    ROUND(SUM(elevation_gain), 0) as total_gain,
    ROUND(SUM(elevation_gain) / SUM(distance_km), 1) as gain_per_km
  FROM routing_edges 
  GROUP BY trail_name
  HAVING SUM(distance_km) >= 15  -- At least 15km long
  ORDER BY gain_per_km ASC  -- Start with lower elevation trails
  LIMIT 10
`).all();

console.log('\n🏃 LONG TRAILS (≥15km):');
longTrails.forEach((trail, index) => {
  console.log(`${index + 1}. ${trail.trail_name}`);
  console.log(`   Distance: ${trail.total_distance}km, Gain: ${trail.total_gain}m (${trail.gain_per_km}m/km)`);
  console.log(`   Segments: ${trail.segment_count}`);
});

// Strategy 2: Find moderate elevation trails that could be combined
const moderateTrails = db.prepare(`
  SELECT 
    trail_name,
    COUNT(*) as segment_count,
    ROUND(SUM(distance_km), 1) as total_distance,
    ROUND(SUM(elevation_gain), 0) as total_gain,
    ROUND(SUM(elevation_gain) / SUM(distance_km), 1) as gain_per_km
  FROM routing_edges 
  GROUP BY trail_name
  HAVING SUM(distance_km) >= 5  -- At least 5km long
    AND SUM(elevation_gain) / SUM(distance_km) <= 150  -- Moderate elevation
  ORDER BY gain_per_km ASC
  LIMIT 15
`).all();

console.log('\n🏃 MODERATE ELEVATION TRAILS (5-15km, ≤150m/km):');
moderateTrails.forEach((trail, index) => {
  console.log(`${index + 1}. ${trail.trail_name}`);
  console.log(`   Distance: ${trail.total_distance}km, Gain: ${trail.total_gain}m (${trail.gain_per_km}m/km)`);
});

// Strategy 3: Build a route using the longest moderate trail as base
console.log('\n🎯 BUILDING ROUTE RECOMMENDATIONS...');

// Find the best base trail
const bestBaseTrail = moderateTrails.find(trail => trail.total_distance >= 10);
if (bestBaseTrail) {
  console.log(`\n🥇 RECOMMENDED BASE TRAIL: ${bestBaseTrail.trail_name}`);
  console.log(`   Distance: ${bestBaseTrail.total_distance}km`);
  console.log(`   Gain: ${bestBaseTrail.total_gain}m (${bestBaseTrail.gain_per_km}m/km)`);
  
  // Find complementary trails to reach 20km
  const remainingDistance = targetDistance - bestBaseTrail.total_distance;
  console.log(`\n📏 Need ${remainingDistance.toFixed(1)}km more to reach ${targetDistance}km`);
  
  // Find trails that could complement this route
  const complementaryTrails = db.prepare(`
    SELECT 
      trail_name,
      COUNT(*) as segment_count,
      ROUND(SUM(distance_km), 1) as total_distance,
      ROUND(SUM(elevation_gain), 0) as total_gain,
      ROUND(SUM(elevation_gain) / SUM(distance_km), 1) as gain_per_km
    FROM routing_edges 
    GROUP BY trail_name
    HAVING SUM(distance_km) >= ? 
      AND SUM(distance_km) <= ?
      AND SUM(elevation_gain) / SUM(distance_km) <= 150
    ORDER BY gain_per_km ASC
    LIMIT 5
  `).all(remainingDistance * 0.7, remainingDistance * 1.3);
  
  console.log('\n🔗 COMPLEMENTARY TRAILS:');
  complementaryTrails.forEach((trail, index) => {
    console.log(`${index + 1}. ${trail.trail_name}`);
    console.log(`   Distance: ${trail.total_distance}km, Gain: ${trail.total_gain}m (${trail.gain_per_km}m/km)`);
  });
  
  // Calculate combined route specs
  if (complementaryTrails.length > 0) {
    const bestComplement = complementaryTrails[0];
    const combinedDistance = bestBaseTrail.total_distance + bestComplement.total_distance;
    const combinedGain = bestBaseTrail.total_gain + bestComplement.total_gain;
    const combinedGainPerKm = combinedGain / combinedDistance;
    
    console.log(`\n🏆 RECOMMENDED ROUTE:`);
    console.log(`   📏 Total Distance: ${combinedDistance.toFixed(1)}km`);
    console.log(`   ⬆️  Total Gain: ${combinedGain}m`);
    console.log(`   📈 Gain per km: ${combinedGainPerKm.toFixed(1)}m/km`);
    console.log(`   🏔️  Trails: ${bestBaseTrail.trail_name} + ${bestComplement.trail_name}`);
    
    // Compare to target
    const distanceDiff = Math.abs(combinedDistance - targetDistance);
    const gainDiff = Math.abs(combinedGainPerKm - targetGainPerKm);
    
    console.log(`\n✅ SPECIFICATION MATCH:`);
    console.log(`   Distance: ${distanceDiff.toFixed(1)}km ${distanceDiff <= 3 ? '✅' : '⚠️'} from target`);
    console.log(`   Gain per km: ${gainDiff.toFixed(1)}m/km ${gainDiff <= 50 ? '✅' : '⚠️'} from target`);
    
    // Show detailed breakdown
    console.log(`\n📋 ROUTE BREAKDOWN:`);
    console.log(`   1. ${bestBaseTrail.trail_name}: ${bestBaseTrail.total_distance}km, +${bestBaseTrail.total_gain}m (${bestBaseTrail.gain_per_km}m/km)`);
    console.log(`   2. ${bestComplement.trail_name}: ${bestComplement.total_distance}km, +${bestComplement.total_gain}m (${bestComplement.gain_per_km}m/km)`);
  }
}

// Strategy 4: Find the trail closest to your target specifications
console.log('\n🎯 ALTERNATIVE: SINGLE TRAIL CLOSEST TO TARGET...');

const closestTrail = db.prepare(`
  SELECT 
    trail_name,
    COUNT(*) as segment_count,
    ROUND(SUM(distance_km), 1) as total_distance,
    ROUND(SUM(elevation_gain), 0) as total_gain,
    ROUND(SUM(elevation_gain) / SUM(distance_km), 1) as gain_per_km,
    ABS(SUM(distance_km) - ?) as distance_diff,
    ABS(SUM(elevation_gain) / SUM(distance_km) - ?) as gain_diff
  FROM routing_edges 
  GROUP BY trail_name
  HAVING SUM(distance_km) >= 15
  ORDER BY distance_diff + gain_diff
  LIMIT 5
`).all(targetDistance, targetGainPerKm);

console.log('\n🏆 TOP 5 TRAILS CLOSEST TO YOUR SPECIFICATIONS:');
closestTrail.forEach((trail, index) => {
  console.log(`\n${index + 1}. ${trail.trail_name}`);
  console.log(`   Distance: ${trail.total_distance}km (${trail.distance_diff.toFixed(1)}km from target)`);
  console.log(`   Gain: ${trail.total_gain}m (${trail.gain_per_km}m/km, ${trail.gain_diff.toFixed(1)}m/km from target)`);
  console.log(`   Segments: ${trail.segment_count}`);
});

// Show overall statistics
const totalTrails = db.prepare('SELECT COUNT(DISTINCT trail_name) as count FROM routing_edges').get().count;
const avgGainPerKm = db.prepare(`
  SELECT ROUND(AVG(elevation_gain / distance_km), 1) as avg_gain_per_km
  FROM routing_edges 
  WHERE distance_km > 0
`).get().avg_gain_per_km;

console.log(`\n📊 DATASET INSIGHTS:`);
console.log(`   Total unique trails: ${totalTrails}`);
console.log(`   Average gain per km: ${avgGainPerKm}m/km`);
console.log(`   Note: Our trails are much steeper than your target of ${targetGainPerKm}m/km`);
console.log(`   Most trails have 150-300m/km gain, which is typical for mountain trails`);

db.close(); 