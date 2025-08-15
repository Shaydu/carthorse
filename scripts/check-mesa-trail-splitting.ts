import * as fs from 'fs';
import * as path from 'path';

async function analyzeMesaTrailSplitting() {
  const geojsonPath = 'test-output/boulder-custom-t-intersection.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found:', geojsonPath);
    return;
  }

  console.log('🔍 Analyzing custom T-intersection detection results...');
  
  const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Find all Mesa Trail segments
  const mesaTrailSegments = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase().includes('mesa trail')
  );
  
  console.log(`\n📊 Mesa Trail Analysis:`);
  console.log(`   Total Mesa Trail segments found: ${mesaTrailSegments.length}`);
  
  if (mesaTrailSegments.length > 0) {
    console.log(`\n📍 Mesa Trail segments:`);
    mesaTrailSegments.forEach((segment: any, index: number) => {
      console.log(`   ${index + 1}. ${segment.properties.name} (ID: ${segment.properties.id})`);
      if (segment.properties.sub_id) {
        console.log(`      Sub-segment ID: ${segment.properties.sub_id}`);
      }
    });
  }
  
  // Find Kohler Mesa Trail segments
  const kohlerMesaSegments = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase().includes('kohler mesa')
  );
  
  console.log(`\n📊 Kohler Mesa Trail Analysis:`);
  console.log(`   Total Kohler Mesa Trail segments found: ${kohlerMesaSegments.length}`);
  
  if (kohlerMesaSegments.length > 0) {
    console.log(`\n📍 Kohler Mesa Trail segments:`);
    kohlerMesaSegments.forEach((segment: any, index: number) => {
      console.log(`   ${index + 1}. ${segment.properties.name} (ID: ${segment.properties.id})`);
      if (segment.properties.sub_id) {
        console.log(`      Sub-segment ID: ${segment.properties.sub_id}`);
      }
    });
  }
  
  // Check if Mesa Trail has multiple segments (indicating it was split)
  const mesaTrailIds = new Set(mesaTrailSegments.map((s: any) => s.properties.id));
  const kohlerMesaIds = new Set(kohlerMesaSegments.map((s: any) => s.properties.id));
  
  console.log(`\n🔍 Splitting Analysis:`);
  console.log(`   Unique Mesa Trail IDs: ${mesaTrailIds.size}`);
  console.log(`   Unique Kohler Mesa Trail IDs: ${kohlerMesaIds.size}`);
  
  if (mesaTrailSegments.length > mesaTrailIds.size) {
    console.log(`   ✅ Mesa Trail appears to be split (${mesaTrailSegments.length} segments from ${mesaTrailIds.size} original trails)`);
  } else {
    console.log(`   ❌ Mesa Trail does not appear to be split`);
  }
  
  // Show some sample coordinates for verification
  if (mesaTrailSegments.length > 0) {
    console.log(`\n📍 Sample Mesa Trail coordinates:`);
    const firstSegment = mesaTrailSegments[0];
    const coords = firstSegment.geometry.coordinates;
    console.log(`   Start: [${coords[0][0].toFixed(6)}, ${coords[0][1].toFixed(6)}]`);
    console.log(`   End: [${coords[coords.length-1][0].toFixed(6)}, ${coords[coords.length-1][1].toFixed(6)}]`);
    console.log(`   Total points: ${coords.length}`);
  }
}

analyzeMesaTrailSplitting().catch(console.error);
