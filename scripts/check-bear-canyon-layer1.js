const fs = require('fs');

function checkBearCanyonLayer1() {
  console.log('🔍 Checking Bear Canyon Trail Segment 1 in layer1 file...\n');

  try {
    // Read the layer1 file
    const layer1File = 'test-output/boulder-expanded-bbox-test-fixed-splitting-layer1-trails.geojson';
    const data = JSON.parse(fs.readFileSync(layer1File, 'utf8'));

    console.log(`📋 Total features in layer1: ${data.features.length}\n`);

    // Find Bear Canyon Trail Segment 1 features
    const bearCanyonFeatures = data.features.filter(feature => 
      feature.properties.name === 'Bear Canyon Trail Segment 1'
    );

    console.log(`🐻 Found ${bearCanyonFeatures.length} Bear Canyon Trail Segment 1 features:\n`);

    bearCanyonFeatures.forEach((feature, index) => {
      const props = feature.properties;
      console.log(`Feature ${index + 1}:`);
      console.log(`  - ID: ${props.id}`);
      console.log(`  - UUID: ${props.app_uuid}`);
      console.log(`  - Name: ${props.name}`);
      console.log(`  - Length: ${props.length_km}km`);
      console.log(`  - Elevation gain: ${props.elevation_gain}m`);
      console.log(`  - Elevation loss: ${props.elevation_loss}m`);
      console.log(`  - Source: ${props.source}`);
      console.log(`  - Geometry type: ${feature.geometry.type}`);
      console.log(`  - Coordinates count: ${feature.geometry.coordinates.length}`);
      
      // Check geometry validity
      if (feature.geometry.coordinates.length >= 2) {
        const firstCoord = feature.geometry.coordinates[0];
        const lastCoord = feature.geometry.coordinates[feature.geometry.coordinates.length - 1];
        console.log(`  - Start point: [${firstCoord[0]}, ${firstCoord[1]}]`);
        console.log(`  - End point: [${lastCoord[0]}, ${lastCoord[1]}]`);
        
        // Calculate approximate length
        const dx = lastCoord[0] - firstCoord[0];
        const dy = lastCoord[1] - firstCoord[1];
        const approxLengthMeters = Math.sqrt(dx*dx + dy*dy) * 111000; // rough conversion
        console.log(`  - Approximate length: ${approxLengthMeters.toFixed(1)}m`);
      }
      
      console.log('');
    });

    // Check for any features with very short lengths
    console.log('📏 Checking for very short trails that might be filtered out...\n');
    
    const shortTrails = data.features.filter(feature => {
      const props = feature.properties;
      const lengthKm = parseFloat(props.length_km);
      return lengthKm < 0.001; // Less than 1 meter
    });

    console.log(`Found ${shortTrails.length} trails shorter than 1 meter:`);
    shortTrails.slice(0, 5).forEach((feature, index) => {
      const props = feature.properties;
      console.log(`  ${index + 1}. ${props.name} (${props.length_km}km, ${props.elevation_gain}m gain)`);
    });

    // Check for trails with null or invalid geometry
    console.log('\n🔍 Checking for trails with geometry issues...\n');
    
    const invalidGeometryTrails = data.features.filter(feature => {
      return !feature.geometry || 
             !feature.geometry.coordinates || 
             feature.geometry.coordinates.length < 2;
    });

    console.log(`Found ${invalidGeometryTrails.length} trails with geometry issues:`);
    invalidGeometryTrails.slice(0, 5).forEach((feature, index) => {
      const props = feature.properties;
      console.log(`  ${index + 1}. ${props.name} - geometry: ${feature.geometry ? feature.geometry.type : 'null'}`);
    });

    // Check for trails with null elevation data
    console.log('\n📊 Checking for trails with null elevation data...\n');
    
    const nullElevationTrails = data.features.filter(feature => {
      const props = feature.properties;
      return props.elevation_gain === null || props.elevation_gain === undefined ||
             props.elevation_loss === null || props.elevation_loss === undefined;
    });

    console.log(`Found ${nullElevationTrails.length} trails with null elevation data:`);
    nullElevationTrails.slice(0, 5).forEach((feature, index) => {
      const props = feature.properties;
      console.log(`  ${index + 1}. ${props.name} - gain: ${props.elevation_gain}, loss: ${props.elevation_loss}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkBearCanyonLayer1();
