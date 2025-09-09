const fs = require('fs');

// Haversine formula for calculating distance between two points on Earth
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Calculate 3D distance including elevation
function calculate3DDistance(lat1, lon1, elev1, lat2, lon2, elev2) {
    const horizontalDistance = haversineDistance(lat1, lon1, lat2, lon2);
    const verticalDistance = Math.abs(elev2 - elev1) / 1000; // Convert meters to kilometers
    return Math.sqrt(horizontalDistance * horizontalDistance + verticalDistance * verticalDistance);
}

// Read and parse the GeoJSON file
const geojsonData = JSON.parse(fs.readFileSync('test-output/tmp.geojson', 'utf8'));

let totalLength = 0;
let segmentCount = 0;
let pointCount = 0;

console.log('🔍 Analyzing path geometry...');

if (geojsonData.geometry && geojsonData.geometry.type === 'MultiLineString') {
    const coordinates = geojsonData.geometry.coordinates;
    
    coordinates.forEach((lineString, lineIndex) => {
        console.log(`   📍 Processing LineString ${lineIndex + 1} with ${lineString.length} points`);
        
        for (let i = 0; i < lineString.length - 1; i++) {
            const [lon1, lat1, elev1] = lineString[i];
            const [lon2, lat2, elev2] = lineString[i + 1];
            
            const segmentLength = calculate3DDistance(lat1, lon1, elev1, lat2, lon2, elev2);
            totalLength += segmentLength;
            segmentCount++;
            pointCount++;
        }
        pointCount++; // Count the last point of each line
    });
    
    console.log('\n📊 PATH ANALYSIS RESULTS:');
    console.log(`   • Total segments: ${segmentCount}`);
    console.log(`   • Total points: ${pointCount}`);
    console.log(`   • Total length: ${totalLength.toFixed(6)} km`);
    console.log(`   • Total length: ${(totalLength * 1000).toFixed(2)} meters`);
    console.log(`   • Total length: ${(totalLength * 0.621371).toFixed(6)} miles`);
    
    // Calculate elevation statistics
    let allElevations = [];
    coordinates.forEach(lineString => {
        lineString.forEach(([lon, lat, elev]) => {
            allElevations.push(elev);
        });
    });
    
    const minElev = Math.min(...allElevations);
    const maxElev = Math.max(...allElevations);
    const avgElev = allElevations.reduce((a, b) => a + b, 0) / allElevations.length;
    
    console.log(`\n🏔️  ELEVATION STATISTICS:`);
    console.log(`   • Minimum elevation: ${minElev.toFixed(2)} meters`);
    console.log(`   • Maximum elevation: ${maxElev.toFixed(2)} meters`);
    console.log(`   • Elevation gain: ${(maxElev - minElev).toFixed(2)} meters`);
    console.log(`   • Average elevation: ${avgElev.toFixed(2)} meters`);
    
} else {
    console.log('❌ Error: Expected MultiLineString geometry');
    console.log(`   Found: ${geojsonData.geometry ? geojsonData.geometry.type : 'No geometry'}`);
}
