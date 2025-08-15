import * as fs from 'fs';

async function checkEnchantedMesaTrail() {
  const geojsonPath = 'test-output/boulder-with-snapping.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found:', geojsonPath);
    return;
  }

  console.log('🔍 Checking for Enchanted Mesa Trail segments...');
  
  const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Find all Enchanted Mesa Trail segments
  const enchantedMesaTrailSegments = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase().includes('enchanted mesa trail')
  );
  
  console.log(`\n📊 Enchanted Mesa Trail Analysis:`);
  console.log(`   Total Enchanted Mesa Trail segments found: ${enchantedMesaTrailSegments.length}`);
  
  if (enchantedMesaTrailSegments.length > 0) {
    console.log('\n📍 Enchanted Mesa Trail segments:');
    enchantedMesaTrailSegments.forEach((feature: any, index: number) => {
      const coords = feature.geometry.coordinates;
      console.log(`   ${index + 1}. Enchanted Mesa Trail (ID: ${feature.properties.id})`);
      console.log(`      Points: ${coords.length}`);
      console.log(`      Start: [${coords[0][0].toFixed(6)}, ${coords[0][1].toFixed(6)}]`);
      console.log(`      End: [${coords[coords.length-1][0].toFixed(6)}, ${coords[coords.length-1][1].toFixed(6)}]`);
      if (feature.properties.sub_id !== undefined) {
        console.log(`      Sub ID: ${feature.properties.sub_id} (SPLIT SEGMENT!)`);
      }
    });
  } else {
    console.log('❌ No Enchanted Mesa Trail segments found in the output');
  }
  
  // Also check for any trails with sub_id (indicating splitting)
  const splitSegments = geojsonData.features.filter((feature: any) => 
    feature.properties.sub_id !== undefined
  );
  
  console.log(`\n📊 Split Segments Analysis:`);
  console.log(`   Total split segments: ${splitSegments.length}`);
  
  if (splitSegments.length > 0) {
    console.log('\n📍 Split segments:');
    splitSegments.forEach((feature: any, index: number) => {
      console.log(`   ${index + 1}. ${feature.properties.name} (ID: ${feature.properties.id}, Sub ID: ${feature.properties.sub_id})`);
    });
  } else {
    console.log('❌ No split segments found - no intersections were detected');
  }
}

checkEnchantedMesaTrail().catch(console.error);
