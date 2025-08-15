import * as fs from 'fs';

async function checkNCARTrails() {
  const geojsonPath = 'test-output/boulder-endpoint-midpoint.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found:', geojsonPath);
    return;
  }

  console.log('🔍 Checking for NCAR Trail and NCAR Water Tank Road...');
  
  const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Find NCAR Trail segments
  const ncarTrailSegments = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase().includes('ncar trail') &&
    !feature.properties.name.toLowerCase().includes('water tank')
  );
  
  // Find NCAR Water Tank Road segments
  const ncarWaterTankSegments = geojsonData.features.filter((feature: any) => 
    feature.properties.name && 
    feature.properties.name.toLowerCase().includes('ncar water tank road')
  );

  console.log(`\n📊 Results:`);
  console.log(`   NCAR Trail segments: ${ncarTrailSegments.length}`);
  console.log(`   NCAR Water Tank Road segments: ${ncarWaterTankSegments.length}`);

  if (ncarTrailSegments.length > 0) {
    console.log(`\n🔍 NCAR Trail segments:`);
    ncarTrailSegments.forEach((segment: any, index: number) => {
      console.log(`   ${index + 1}. ID: ${segment.properties.id}, sub_id: ${segment.properties.sub_id || 'none'}`);
    });
  }

  if (ncarWaterTankSegments.length > 0) {
    console.log(`\n🔍 NCAR Water Tank Road segments:`);
    ncarWaterTankSegments.forEach((segment: any, index: number) => {
      console.log(`   ${index + 1}. ID: ${segment.properties.id}, sub_id: ${segment.properties.sub_id || 'none'}`);
    });
  }

  // Check if any segments have sub_id (indicating splitting)
  const allSegments = [...ncarTrailSegments, ...ncarWaterTankSegments];
  const splitSegments = allSegments.filter((segment: any) => segment.properties.sub_id);
  
  console.log(`\n✂️ Split segments: ${splitSegments.length}`);
  if (splitSegments.length > 0) {
    splitSegments.forEach((segment: any) => {
      console.log(`   ${segment.properties.name} - ID: ${segment.properties.id}, sub_id: ${segment.properties.sub_id}`);
    });
  }
}

checkNCARTrails().catch(console.error);
