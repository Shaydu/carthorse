import * as fs from 'fs';
import * as path from 'path';

async function analyzeCustomSplittingResults() {
  const geojsonPath = 'test-output/boulder-with-snapping.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found:', geojsonPath);
    return;
  }

  console.log('🔍 Analyzing custom T-intersection detection results...');
  
  const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  console.log(`📊 Total features: ${geojsonData.features.length}`);
  
  // Check for sub-segments (indicating splitting occurred)
  const featuresWithSubId = geojsonData.features.filter((feature: any) => 
    feature.properties.sub_id !== undefined && feature.properties.sub_id !== null
  );
  
  console.log(`📊 Features with sub_id (split segments): ${featuresWithSubId.length}`);
  
  if (featuresWithSubId.length > 0) {
    console.log(`\n📍 Split segments found:`);
    featuresWithSubId.forEach((feature: any, index: number) => {
      console.log(`   ${index + 1}. ${feature.properties.name} (ID: ${feature.properties.id}, Sub: ${feature.properties.sub_id})`);
    });
  }
  
  // Find Mesa Trail specifically
  const mesaTrailFeatures = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase() === 'mesa trail'
  );
  
  console.log(`\n📊 Mesa Trail Analysis:`);
  console.log(`   Total Mesa Trail features: ${mesaTrailFeatures.length}`);
  
  if (mesaTrailFeatures.length > 0) {
    console.log(`\n📍 Mesa Trail features:`);
    mesaTrailFeatures.forEach((feature: any, index: number) => {
      console.log(`   ${index + 1}. Mesa Trail (ID: ${feature.properties.id})`);
      if (feature.properties.sub_id !== undefined) {
        console.log(`      Sub-segment ID: ${feature.properties.sub_id}`);
      }
      const coords = feature.geometry.coordinates;
      console.log(`      Points: ${coords.length}`);
      console.log(`      Start: [${coords[0][0].toFixed(6)}, ${coords[0][1].toFixed(6)}]`);
      console.log(`      End: [${coords[coords.length-1][0].toFixed(6)}, ${coords[coords.length-1][1].toFixed(6)}]`);
    });
  }
  
  // Find Kohler Mesa Trail specifically
  const kohlerMesaFeatures = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase() === 'kohler mesa trail'
  );
  
  console.log(`\n📊 Kohler Mesa Trail Analysis:`);
  console.log(`   Total Kohler Mesa Trail features: ${kohlerMesaFeatures.length}`);
  
  if (kohlerMesaFeatures.length > 0) {
    console.log(`\n📍 Kohler Mesa Trail features:`);
    kohlerMesaFeatures.forEach((feature: any, index: number) => {
      console.log(`   ${index + 1}. Kohler Mesa Trail (ID: ${feature.properties.id})`);
      if (feature.properties.sub_id !== undefined) {
        console.log(`      Sub-segment ID: ${feature.properties.sub_id}`);
      }
      const coords = feature.geometry.coordinates;
      console.log(`      Points: ${coords.length}`);
      console.log(`      Start: [${coords[0][0].toFixed(6)}, ${coords[0][1].toFixed(6)}]`);
      console.log(`      End: [${coords[coords.length-1][0].toFixed(6)}, ${coords[coords.length-1][1].toFixed(6)}]`);
    });
  }
  
  // Check if any trails have multiple sub-segments (indicating they were split)
  const trailGroups = new Map();
  featuresWithSubId.forEach((feature: any) => {
    const key = feature.properties.id;
    if (!trailGroups.has(key)) {
      trailGroups.set(key, []);
    }
    trailGroups.get(key).push(feature);
  });
  
  const trailsWithMultipleSegments = Array.from(trailGroups.entries())
    .filter(([id, features]) => features.length > 1)
    .map(([id, features]) => ({ id, features }));
  
  console.log(`\n📊 Trails with multiple segments (indicating splitting):`);
  console.log(`   Total trails split: ${trailsWithMultipleSegments.length}`);
  
  if (trailsWithMultipleSegments.length > 0) {
    console.log(`\n📍 Split trails:`);
    trailsWithMultipleSegments.forEach(({ id, features }) => {
      const firstFeature = features[0];
      console.log(`   Trail: ${firstFeature.properties.name} (ID: ${id})`);
      console.log(`   Segments: ${features.length}`);
      features.forEach((feature: any, index: number) => {
        console.log(`     ${index + 1}. Sub-segment ${feature.properties.sub_id}`);
      });
    });
  }
  
  // Check if Mesa Trail was among the split trails
  const mesaTrailSplit = trailsWithMultipleSegments.find(({ id }) => 
    mesaTrailFeatures.some((f: any) => f.properties.id === id)
  );
  
  if (mesaTrailSplit) {
    console.log(`\n✅ Mesa Trail was split into ${mesaTrailSplit.features.length} segments!`);
  } else {
    console.log(`\n❌ Mesa Trail was not split`);
  }
}

analyzeCustomSplittingResults().catch(console.error);
