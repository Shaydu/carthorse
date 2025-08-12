const fs = require('fs');

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function analyzeMesaTrails() {
  try {
    const data = JSON.parse(fs.readFileSync('test-output/degree1-joining.geojson', 'utf8'));
    
    const mesaTrails = data.features.filter(f => 
      f.properties && f.properties.name === 'Mesa Trail' && f.geometry.type === 'LineString'
    );
    
    console.log(`🔍 Found ${mesaTrails.length} Mesa Trail segments`);
    
    mesaTrails.forEach((trail, index) => {
      const coords = trail.geometry.coordinates;
      const start = coords[0];
      const end = coords[coords.length - 1];
      
      console.log(`\n📍 Mesa Trail ${index + 1} (ID: ${trail.properties.id}):`);
      console.log(`  Start: [${start[0].toFixed(6)}, ${start[1].toFixed(6)}]`);
      console.log(`  End: [${end[0].toFixed(6)}, ${end[1].toFixed(6)}]`);
      console.log(`  Length: ${trail.properties.length_km}km`);
    });
    
    // Calculate distances between all endpoints
    console.log('\n📏 Distances between Mesa Trail endpoints:');
    for (let i = 0; i < mesaTrails.length; i++) {
      for (let j = i + 1; j < mesaTrails.length; j++) {
        const trail1 = mesaTrails[i];
        const trail2 = mesaTrails[j];
        
        const coords1 = trail1.geometry.coordinates;
        const coords2 = trail2.geometry.coordinates;
        
        const start1 = coords1[0];
        const end1 = coords1[coords1.length - 1];
        const start2 = coords2[0];
        const end2 = coords2[coords2.length - 1];
        
        const distances = [
          calculateDistance(start1[1], start1[0], start2[1], start2[0]),
          calculateDistance(start1[1], start1[0], end2[1], end2[0]),
          calculateDistance(end1[1], end1[0], start2[1], start2[0]),
          calculateDistance(end1[1], end1[0], end2[1], end2[0])
        ];
        
        const minDistance = Math.min(...distances);
        console.log(`  Trail ${i+1} ↔ Trail ${j+1}: ${minDistance.toFixed(1)}m`);
        
        if (minDistance < 50) { // Highlight close gaps
          console.log(`    🎯 CLOSE GAP: ${minDistance.toFixed(1)}m`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

analyzeMesaTrails();
