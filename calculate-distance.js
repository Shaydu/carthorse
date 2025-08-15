// Calculate distance between two points using Haversine formula
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Enchanted Mesa Trail endpoint
const enchantedMesaEnd = {
    lat: 39.987574,
    lon: -105.285645
};

// Enchanted-Kohler Spur Trail endpoint  
const enchantedKohlerEnd = {
    lat: 39.988581,
    lon: -105.282387
};

const distance = haversineDistance(
    enchantedMesaEnd.lat, enchantedMesaEnd.lon,
    enchantedKohlerEnd.lat, enchantedKohlerEnd.lon
);

console.log(`Distance between endpoints: ${distance.toFixed(2)} meters`);
console.log(`Within 3-meter tolerance: ${distance <= 3.0}`);
console.log(`Enchanted Mesa Trail endpoint: [${enchantedMesaEnd.lon}, ${enchantedMesaEnd.lat}]`);
console.log(`Enchanted-Kohler Spur Trail endpoint: [${enchantedKohlerEnd.lon}, ${enchantedKohlerEnd.lat}]`);
