const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

async function exportTrailsGeoJSON() {
  const dbPath = './boulder';
  
  // Define the bbox filter with a small buffer for context
  const bbox = {
    minLng: -105.28117783804319 - 0.01,
    minLat: 40.06826860792208 - 0.01,
    maxLng: -105.2481870337762 + 0.01,
    maxLat: 40.08430159634801 + 0.01
  };
  
  try {
    console.log(`🔗 Opening SQLite database: ${dbPath}`);
    console.log(`🗺️ Filtering trails to bbox: ${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}`);
    
    const db = new sqlite3.Database(dbPath);
    
    // Get trail count in bbox
    const trailCount = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count 
        FROM trails 
        WHERE geojson LIKE '%"coordinates":%'
        AND (
          geojson LIKE '%${bbox.minLng}%' OR 
          geojson LIKE '%${bbox.maxLng}%' OR 
          geojson LIKE '%${bbox.minLat}%' OR 
          geojson LIKE '%${bbox.maxLat}%'
        )
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    console.log(`🛤️ Found ${trailCount} trails in bbox`);
    
    // Export trails as GeoJSON
    const trails = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          id,
          app_uuid,
          name,
          region,
          trail_type,
          length_km,
          elevation_gain,
          elevation_loss,
          geojson,
          created_at
        FROM trails
        WHERE geojson LIKE '%"coordinates":%'
        AND (
          geojson LIKE '%${bbox.minLng}%' OR 
          geojson LIKE '%${bbox.maxLng}%' OR 
          geojson LIKE '%${bbox.minLat}%' OR 
          geojson LIKE '%${bbox.maxLat}%'
        )
        ORDER BY name
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Create GeoJSON features for trails
    const trailFeatures = trails.map(trail => {
      let geojson;
      try {
        geojson = JSON.parse(trail.geojson);
      } catch (e) {
        console.warn(`⚠️ Invalid GeoJSON for trail ${trail.id}: ${trail.geojson}`);
        return null;
      }
      
      return {
        type: 'Feature',
        properties: {
          id: trail.id,
          app_uuid: trail.app_uuid,
          name: trail.name,
          region: trail.region,
          trail_type: trail.trail_type,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          created_at: trail.created_at,
          // Styling for visualization
          color: '#ff6600', // Orange for trails
          weight: 3
        },
        geometry: geojson.geometry
      };
    }).filter(feature => feature !== null);
    
    // Create combined GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: trailFeatures
    };
    
    // Write to file
    const filename = `boulder-trails-bbox-${Date.now()}.geojson`;
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported to ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`  - Trails: ${trailFeatures.length}`);
    console.log(`  - Total features: ${geojson.features.length}`);
    console.log(`\n🌐 Open ${filename} in geojson.io to visualize the trails`);
    console.log(`\n🎨 Color coding:`);
    console.log(`  - 🟠 Orange lines: Trail geometries`);
    console.log(`\n📍 Bbox area: ${bbox.minLng}, ${bbox.minLat} to ${bbox.maxLng}, ${bbox.maxLat}`);
    
    // Show trail names
    if (trailFeatures.length > 0) {
      console.log(`\n🛤️ Trails in this area:`);
      trailFeatures.forEach((feature, index) => {
        console.log(`  ${index + 1}. ${feature.properties.name} (${feature.properties.length_km.toFixed(2)}km)`);
      });
    } else {
      console.log(`\n⚠️ No trails found in this area`);
    }
    
    db.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the export
exportTrailsGeoJSON().catch(console.error); 