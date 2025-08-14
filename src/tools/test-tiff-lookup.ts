#!/usr/bin/env node
import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';

async function testTiffLookup() {
  console.log('🧪 Testing TIFF lookup for Boulder coordinates...');
  
  const atomicInserter = new AtomicTrailInserter('trail_master_db');
  
  try {
    await atomicInserter.connect();
    console.log('✅ Connected to elevation processing system');

    // Test coordinates in Boulder area
    const testCoordinates = [
      [-105.270359473048, 39.9856467720278], // From CPW data
      [-105.22424918327, 40.0259920201405],  // From CPW data
      [-105.298810873948, 40.0132202070287], // From CPW data
      [-105.255785138226, 40.0113874893245], // From CPW data
      [-105.28165645768887, 39.99499525679705], // From CPW data
    ];

    console.log('\n🔍 Testing individual coordinate lookups:');
    for (let i = 0; i < testCoordinates.length; i++) {
      const [lng, lat] = testCoordinates[i];
      console.log(`\n   Coordinate ${i + 1}: [${lng}, ${lat}]`);
      
      try {
        const elevation = await atomicInserter.getElevationFromTiff(lng, lat);
        console.log(`   ✅ Elevation: ${elevation}`);
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }

    console.log('\n🔍 Testing batch elevation processing:');
    try {
      const elevationData = await atomicInserter.processTrailElevation(testCoordinates);
      console.log(`   ✅ Batch result:`);
      console.log(`      - Elevations: ${elevationData.elevations.map(e => e || 'null').join(', ')}`);
      console.log(`      - Elevation gain: ${elevationData.elevation_gain}`);
      console.log(`      - Max elevation: ${elevationData.max_elevation}`);
      console.log(`      - Min elevation: ${elevationData.min_elevation}`);
      console.log(`      - Avg elevation: ${elevationData.avg_elevation}`);
    } catch (error) {
      console.log(`   ❌ Batch error: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await atomicInserter.disconnect();
  }
}

if (require.main === module) {
  testTiffLookup();
}
