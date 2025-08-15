import * as fs from 'fs';

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

async function countNCARSegments() {
  const geojsonPath = 'test-output/boulder-fixed-tolerance-layer1-trails.geojson';
  
  if (!fs.existsSync(geojsonPath)) {
    console.log('❌ GeoJSON file not found:', geojsonPath);
    return;
  }
  
  const geojson: GeoJSON = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  
  // Count NCAR Trail segments
  const ncarTrailSegments = geojson.features.filter(f => 
    f.properties.name?.toLowerCase().includes('ncar trail') && 
    !f.properties.name?.toLowerCase().includes('water tank')
  );
  
  const ncarWaterTankSegments = geojson.features.filter(f => 
    f.properties.name?.toLowerCase().includes('ncar water tank road')
  );
  
  console.log('📊 NCAR Trail segments found:', ncarTrailSegments.length);
  console.log('📊 NCAR Water Tank Road segments found:', ncarWaterTankSegments.length);
  
  if (ncarTrailSegments.length > 0) {
    console.log('\n📍 NCAR Trail segment details:');
    ncarTrailSegments.forEach((segment, index) => {
      console.log(`   ${index + 1}. ID: ${segment.properties.id}`);
      console.log(`      Name: ${segment.properties.name}`);
      console.log(`      Coordinates: ${segment.geometry.coordinates.length} points`);
      console.log(`      Start: [${segment.geometry.coordinates[0][0].toFixed(6)}, ${segment.geometry.coordinates[0][1].toFixed(6)}]`);
      console.log(`      End: [${segment.geometry.coordinates[segment.geometry.coordinates.length - 1][0].toFixed(6)}, ${segment.geometry.coordinates[segment.geometry.coordinates.length - 1][1].toFixed(6)}]`);
      console.log('');
    });
  }
  
  if (ncarWaterTankSegments.length > 0) {
    console.log('📍 NCAR Water Tank Road segment details:');
    ncarWaterTankSegments.forEach((segment, index) => {
      console.log(`   ${index + 1}. ID: ${segment.properties.id}`);
      console.log(`      Name: ${segment.properties.name}`);
      console.log(`      Coordinates: ${segment.geometry.coordinates.length} points`);
      console.log(`      Start: [${segment.geometry.coordinates[0][0].toFixed(6)}, ${segment.geometry.coordinates[0][1].toFixed(6)}]`);
      console.log(`      End: [${segment.geometry.coordinates[segment.geometry.coordinates.length - 1][0].toFixed(6)}, ${segment.geometry.coordinates[segment.geometry.coordinates.length - 1][1].toFixed(6)}]`);
      console.log('');
    });
  }
}

countNCARSegments().catch(console.error);
