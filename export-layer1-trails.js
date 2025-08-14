#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');

// Database configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function exportLayer1Trails() {
  const stagingSchema = 'carthorse_1755111011295'; // Most recent staging schema with gap bridging
  
  console.log(`🗺️ Exporting Layer 1 trails from schema: ${stagingSchema}`);
  
  try {
    // Query trails from the staging schema
    const trailsResult = await pool.query(`
      SELECT 
        id,
        app_uuid,
        name,
        region,
        trail_type,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsGeoJSON(geometry, 6) as geojson,
        created_at
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
      ORDER BY name
    `);
    
    const trails = trailsResult.rows;
    console.log(`📊 Found ${trails.length} trails`);
    
    // Create GeoJSON features
    const features = trails.map(trail => {
      let geometry;
      try {
        geometry = JSON.parse(trail.geojson);
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
        geometry: geometry
      };
    }).filter(feature => feature !== null);
    
    // Create combined GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    // Write to file
    const filename = `layer1-trails-${stagingSchema}-${Date.now()}.geojson`;
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported to ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`  - Trails: ${features.length}`);
    console.log(`  - Total features: ${geojson.features.length}`);
    console.log(`\n🌐 Open ${filename} in geojson.io to visualize the trails`);
    console.log(`\n🎨 Color coding:`);
    console.log(`  - 🟠 Orange lines: Trail geometries (after endpoint consolidation)`);
    
    // Show some trail names for reference
    console.log(`\n📋 Sample trails:`);
    features.slice(0, 10).forEach(feature => {
      console.log(`  - ${feature.properties.name} (${feature.properties.length_km}km)`);
    });
    
    if (features.length > 10) {
      console.log(`  ... and ${features.length - 10} more trails`);
    }
    
  } catch (error) {
    console.error(`❌ Error exporting trails: ${error}`);
  } finally {
    await pool.end();
  }
}

exportLayer1Trails();
