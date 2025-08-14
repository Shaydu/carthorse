const fs = require('fs');

// Read the GeoJSON file
const geojsonPath = 'test-output/boulder-layer1-only.geojson';
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

console.log('🔍 Analyzing T-intersection detection...\n');

// Find trails that might have T-intersections
const trails = data.features.filter(f => f.properties && f.properties.name);
console.log(`📊 Total trails: ${trails.length}`);

// Look for potential T-intersections
let tIntersectionCandidates = [];

for (let i = 0; i < trails.length; i++) {
  for (let j = i + 1; j < trails.length; j++) {
    const trail1 = trails[i];
    const trail2 = trails[j];
    
    if (!trail1.geometry.coordinates || !trail2.geometry.coordinates) continue;
    
    // Get endpoints of both trails
    const trail1Start = trail1.geometry.coordinates[0];
    const trail1End = trail1.geometry.coordinates[trail1.geometry.coordinates.length - 1];
    const trail2Start = trail2.geometry.coordinates[0];
    const trail2End = trail2.geometry.coordinates[trail2.geometry.coordinates.length - 1];
    
    // Check if any endpoint of trail1 is close to any point on trail2
    const tolerance = 0.0001; // ~10 meters
    
    // Check trail1 endpoints against trail2 points
    const trail1StartNearTrail2 = trail2.geometry.coordinates.some(coord => {
      const distance = Math.sqrt(
        Math.pow(trail1Start[0] - coord[0], 2) + 
        Math.pow(trail1Start[1] - coord[1], 2)
      );
      return distance < tolerance;
    });
    
    const trail1EndNearTrail2 = trail2.geometry.coordinates.some(coord => {
      const distance = Math.sqrt(
        Math.pow(trail1End[0] - coord[0], 2) + 
        Math.pow(trail1End[1] - coord[1], 2)
      );
      return distance < tolerance;
    });
    
    // Check trail2 endpoints against trail1 points
    const trail2StartNearTrail1 = trail1.geometry.coordinates.some(coord => {
      const distance = Math.sqrt(
        Math.pow(trail2Start[0] - coord[0], 2) + 
        Math.pow(trail2Start[1] - coord[1], 2)
      );
      return distance < tolerance;
    });
    
    const trail2EndNearTrail1 = trail1.geometry.coordinates.some(coord => {
      const distance = Math.sqrt(
        Math.pow(trail2End[0] - coord[0], 2) + 
        Math.pow(trail2End[1] - coord[1], 2)
      );
      return distance < tolerance;
    });
    
    if (trail1StartNearTrail2 || trail1EndNearTrail2 || trail2StartNearTrail1 || trail2EndNearTrail1) {
      tIntersectionCandidates.push({
        trail1: trail1.properties.name,
        trail2: trail2.properties.name,
        trail1StartNearTrail2,
        trail1EndNearTrail2,
        trail2StartNearTrail1,
        trail2EndNearTrail1,
        trail1Start: trail1Start,
        trail1End: trail1End,
        trail2Start: trail2Start,
        trail2End: trail2End
      });
    }
  }
}

console.log(`🎯 Found ${tIntersectionCandidates.length} potential T-intersection candidates:`);

tIntersectionCandidates.slice(0, 10).forEach((candidate, i) => {
  console.log(`\n${i + 1}. ${candidate.trail1} ↔ ${candidate.trail2}`);
  
  if (candidate.trail1StartNearTrail2) {
    console.log(`   T-intersection: ${candidate.trail1} START near ${candidate.trail2}`);
    console.log(`   Location: [${candidate.trail1Start[0]}, ${candidate.trail1Start[1]}]`);
  }
  if (candidate.trail1EndNearTrail2) {
    console.log(`   T-intersection: ${candidate.trail1} END near ${candidate.trail2}`);
    console.log(`   Location: [${candidate.trail1End[0]}, ${candidate.trail1End[1]}]`);
  }
  if (candidate.trail2StartNearTrail1) {
    console.log(`   T-intersection: ${candidate.trail2} START near ${candidate.trail1}`);
    console.log(`   Location: [${candidate.trail2Start[0]}, ${candidate.trail2Start[1]}]`);
  }
  if (candidate.trail2EndNearTrail1) {
    console.log(`   T-intersection: ${candidate.trail2} END near ${candidate.trail1}`);
    console.log(`   Location: [${candidate.trail2End[0]}, ${candidate.trail2End[1]}]`);
  }
});

if (tIntersectionCandidates.length > 10) {
  console.log(`\n... and ${tIntersectionCandidates.length - 10} more candidates`);
}

console.log('\n💡 ANALYSIS:');
console.log('The current intersection detection logic only finds:');
console.log('1. ✅ True geometric intersections (trails crossing)');
console.log('2. ✅ Endpoint near-misses (endpoints within tolerance)');
console.log('3. ❌ T-intersections (one trail ending at another trail)');
console.log('\nT-intersections are being missed because they require:');
console.log('- Checking if trail endpoints are close to ANY point on another trail');
console.log('- Not just endpoint-to-endpoint proximity');
console.log('- A different spatial relationship than ST_Intersects()');
