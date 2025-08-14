const { Client } = require('pg');

async function testTiffCoverage() {
  console.log('🔍 Testing TIFF coverage for trail 166 coordinates...');
  
  // Trail 166 coordinates
  const coordinates = [
    [-105.20359490179, 40.0107940328715],
    [-105.2036728899, 40.0107518499129],
    [-105.203672676844, 40.0106797720674]
  ];
  
  // Our TIFF coverage areas
  const tiffCoverage = [
    {
      name: 'USGS_13_n39w105_20230602.tif',
      minLng: -105.0006,
      maxLng: -103.9994,
      minLat: 37.9994,
      maxLat: 39.0006
    },
    {
      name: 'USGS_13_n39w106_20230602_renamed.tif',
      minLng: -106.0006,
      maxLng: -104.9994,
      minLat: 38.9994,
      maxLat: 40.0006
    },
    {
      name: 'USGS_13_n39w107_20220331.tif',
      minLng: -107.0006,
      maxLng: -105.9994,
      minLat: 37.9994,
      maxLat: 39.0006
    },
    {
      name: 'USGS_13_n40w105_20230602.tif',
      minLng: -105.0006,
      maxLng: -103.9994,
      minLat: 38.9994,
      maxLat: 40.0006
    },
    {
      name: 'USGS_13_n40w106_20230314_renamed.tif',
      minLng: -106.0006,
      maxLng: -104.9994,
      minLat: 39.9994,
      maxLat: 41.0006
    },
    {
      name: 'USGS_13_n40w107_20220216.tif',
      minLng: -107.0006,
      maxLng: -105.9994,
      minLat: 38.9994,
      maxLat: 40.0006
    }
  ];
  
  coordinates.forEach((coord, i) => {
    const [lng, lat] = coord;
    console.log(`\nPoint ${i}: [${lng}, ${lat}]`);
    
    let found = false;
    tiffCoverage.forEach(tiff => {
      const inCoverage = lng >= tiff.minLng && lng <= tiff.maxLng && lat >= tiff.minLat && lat <= tiff.maxLat;
      if (inCoverage) {
        console.log(`  ✅ Found in: ${tiff.name}`);
        found = true;
      }
    });
    
    if (!found) {
      console.log(`  ❌ Not found in any TIFF coverage`);
    }
  });
}

testTiffCoverage();
