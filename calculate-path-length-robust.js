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

// Extract coordinates from malformed JSON
function extractCoordinates(data) {
    const coordinates = [];
    
    // Find all coordinate triplets [lon, lat, elev]
    const coordPattern = /\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/g;
    let match;
    let currentLineString = [];
    
    while ((match = coordPattern.exec(data)) !== null) {
        const lon = parseFloat(match[1]);
        const lat = parseFloat(match[2]);
        const elev = parseFloat(match[3]);
        
        currentLineString.push([lon, lat, elev]);
        
        // Check if this is the end of a line string (look for closing brackets)
        const afterMatch = data.substring(match.index + match[0].length);
        if (afterMatch.trim().startsWith(']') || afterMatch.trim().startsWith('],')) {
            if (currentLineString.length > 0) {
                coordinates.push(currentLineString);
                currentLineString = [];
            }
        }
    }
    
    // Add the last line string if it exists
    if (currentLineString.length > 0) {
        coordinates.push(currentLineString);
    }
    
    return coordinates;
}

try {
    // Read the GeoJSON file
    const data = fs.readFileSync('test-output/tmp.geojson', 'utf8');
    
    console.log('📊 Reading and parsing GeoJSON file...');
    console.log(`   File size: ${data.length} characters`);
    
    // Try to parse the JSON first
    let geojson;
    try {
        geojson = JSON.parse(data);
        console.log('✅ Successfully parsed as valid JSON');
    } catch (parseError) {
        console.log('⚠️  JSON parsing failed, extracting coordinates manually...');
        
        // Extract coordinates manually
        const coordinates = extractCoordinates(data);
        console.log(`   Extracted ${coordinates.length} line strings`);
        
        if (coordinates.length === 0) {
            throw new Error('No coordinates found in file');
        }
        
        // Create a proper GeoJSON structure
        geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'MultiLineString',
                    coordinates: coordinates
                }
            }]
        };
    }
    
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
    console.log(`   Found ${geometry.coordinates.length} line strings`);
    
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
    
    // Calculate elevation gain per km
    const gainPerKm = totalLength > 0 ? (totalElevationGain / totalLength) : 0;
    const lossPerKm = totalLength > 0 ? (totalElevationLoss / totalLength) : 0;
    console.log(`   • Elevation Gain per km: ${gainPerKm.toFixed(1)} m/km`);
    console.log(`   • Elevation Loss per km: ${lossPerKm.toFixed(1)} m/km`);
    
} catch (error) {
    console.error('❌ Error analyzing path:', error.message);
    console.error(error.stack);
}
