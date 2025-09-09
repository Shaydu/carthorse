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

try {
    // Read the GeoJSON file
    const data = fs.readFileSync('test-output/tmp.geojson', 'utf8');
    
    console.log('📊 Reading and parsing GeoJSON file...');
    
    // Try to parse the JSON, handling potential formatting issues
    let geojson;
    try {
        geojson = JSON.parse(data);
    } catch (parseError) {
        console.log('⚠️  JSON parsing failed, attempting to clean the data...');
        
        // Try to extract just the coordinates array using regex
        const coordMatch = data.match(/\[\[\[[\d\.,\s-]+\]\]\]/);
        if (coordMatch) {
            const coords = JSON.parse(coordMatch[0]);
            geojson = {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'MultiLineString',
                        coordinates: coords
                    }
                }]
            };
        } else {
            throw new Error('Could not extract coordinates from file');
        }
    }
    
    console.log(`✅ Successfully parsed GeoJSON`);
    console.log(`   Type: ${geojson.type}`);
    console.log(`   Features: ${geojson.features ? geojson.features.length : 'N/A'}`);
    
    let totalLength = 0;
    let totalElevationGain = 0;
    let totalElevationLoss = 0;
    let minElevation = Infinity;
    let maxElevation = -Infinity;
    let pointCount = 0;
    let segmentCount = 0;
    
    // Handle both FeatureCollection and direct geometry
    let geometry;
    if (geojson.features && geojson.features.length > 0) {
        geometry = geojson.features[0].geometry;
    } else if (geojson.geometry) {
        geometry = geojson.geometry;
    } else {
        throw new Error('No geometry found in GeoJSON');
    }
    
    console.log(`\n📍 Processing ${geometry.type} geometry...`);
    
    if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach((lineString, lineIndex) => {
            console.log(`   LineString ${lineIndex + 1}: ${lineString.length} points`);
            pointCount += lineString.length;
            
            for (let i = 0; i < lineString.length - 1; i++) {
                const [lon1, lat1, elev1] = lineString[i];
                const [lon2, lat2, elev2] = lineString[i + 1];
                
                const distance = calculate3DDistance(lat1, lon1, elev1, lat2, lon2, elev2);
                totalLength += distance;
                segmentCount++;
                
                // Track elevation changes
                if (elev2 > elev1) {
                    totalElevationGain += (elev2 - elev1);
                } else {
                    totalElevationLoss += (elev1 - elev2);
                }
                
                // Track min/max elevation
                minElevation = Math.min(minElevation, elev1, elev2);
                maxElevation = Math.max(maxElevation, elev1, elev2);
            }
        });
    } else {
        throw new Error(`Unsupported geometry type: ${geometry.type}`);
    }
    
    console.log('\n📏 PATH ANALYSIS RESULTS:');
    console.log(`   • Total Length: ${totalLength.toFixed(2)} km`);
    console.log(`   • Total Length: ${(totalLength * 1000).toFixed(0)} meters`);
    console.log(`   • Total Length: ${(totalLength * 0.621371).toFixed(2)} miles`);
    console.log(`   • Total Segments: ${segmentCount}`);
    console.log(`   • Total Points: ${pointCount}`);
    
    console.log('\n🏔️  ELEVATION ANALYSIS:');
    console.log(`   • Total Elevation Gain: ${totalElevationGain.toFixed(1)} m`);
    console.log(`   • Total Elevation Loss: ${totalElevationLoss.toFixed(1)} m`);
    console.log(`   • Net Elevation Change: ${(totalElevationGain - totalElevationLoss).toFixed(1)} m`);
    console.log(`   • Min Elevation: ${minElevation.toFixed(1)} m`);
    console.log(`   • Max Elevation: ${maxElevation.toFixed(1)} m`);
    console.log(`   • Elevation Range: ${(maxElevation - minElevation).toFixed(1)} m`);
    
    // Calculate average grade
    const avgGrade = totalLength > 0 ? ((totalElevationGain - totalElevationLoss) / (totalLength * 1000)) * 100 : 0;
    console.log(`   • Average Grade: ${avgGrade.toFixed(2)}%`);
    
} catch (error) {
    console.error('❌ Error analyzing path:', error.message);
    
    // Try to read the file and show some diagnostic info
    try {
        const data = fs.readFileSync('test-output/tmp.geojson', 'utf8');
        console.log('\n🔍 File diagnostic info:');
        console.log(`   File size: ${data.length} characters`);
        console.log(`   First 200 characters: ${data.substring(0, 200)}`);
        console.log(`   Last 200 characters: ${data.substring(data.length - 200)}`);
        
        // Look for coordinate patterns
        const coordMatches = data.match(/\[[\d\.,\s-]+\]/g);
        if (coordMatches) {
            console.log(`   Found ${coordMatches.length} coordinate-like patterns`);
            console.log(`   First coordinate: ${coordMatches[0]}`);
        }
    } catch (fallbackError) {
        console.error('Fallback diagnostic also failed:', fallbackError.message);
    }
}
