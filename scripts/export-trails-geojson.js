#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754992253411';

async function exportTrailsGeoJSON() {
  try {
    await client.connect();
    console.log('📦 Exporting trails as GeoJSON...');

    // Get all trails with their geometries
    const trailsResult = await client.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${STAGING_SCHEMA}.trails 
      WHERE geometry IS NOT NULL
      ORDER BY name, app_uuid
    `);

    console.log(`📊 Found ${trailsResult.rows.length} trails`);

    // Create GeoJSON features
    const features = trailsResult.rows.map(trail => {
      let geometry;
      try {
        geometry = JSON.parse(trail.geojson);
      } catch (e) {
        console.warn(`⚠️ Invalid GeoJSON for trail ${trail.app_uuid}: ${trail.geojson}`);
        return null;
      }

      return {
        type: 'Feature',
        properties: {
          trail_id: trail.app_uuid,
          name: trail.name,
          trail_type: trail.trail_type,
          surface: trail.surface,
          difficulty: trail.difficulty,
          length_km: trail.length_km,
          elevation_gain: trail.elevation_gain,
          elevation_loss: trail.elevation_loss,
          max_elevation: trail.max_elevation,
          min_elevation: trail.min_elevation,
          avg_elevation: trail.avg_elevation,
          start_point: trail.start_point,
          end_point: trail.end_point,
          // Highlight the fixed trails
          is_fixed_trail: trail.app_uuid === '6357ecb0-b5b6-4aa8-ba49-27bf6106595b' || 
                         trail.app_uuid === 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377',
          // Styling for visualization
          color: (trail.app_uuid === '6357ecb0-b5b6-4aa8-ba49-27bf6106595b' || 
                  trail.app_uuid === 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377') ? '#ff0000' : '#00ff00',
          weight: (trail.app_uuid === '6357ecb0-b5b6-4aa8-ba49-27bf6106595b' || 
                   trail.app_uuid === 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377') ? 4 : 2
        },
        geometry: geometry
      };
    }).filter(feature => feature !== null);

    // Create GeoJSON collection
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };

    // Write to file
    const filename = 'test-output/trails-with-fixed-gap.geojson';
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));

    console.log(`✅ Exported to ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`  - Total trails: ${features.length}`);
    
    // Show the fixed trails specifically
    const fixedTrails = features.filter(f => f.properties.is_fixed_trail);
    console.log(`  - Fixed trails: ${fixedTrails.length}`);
    
    fixedTrails.forEach(trail => {
      console.log(`    🎯 ${trail.properties.name} (${trail.properties.trail_id})`);
      console.log(`       Length: ${trail.properties.length_km.toFixed(3)}km`);
      console.log(`       Start: ${trail.properties.start_point}`);
      console.log(`       End: ${trail.properties.end_point}`);
    });

    console.log(`\n🌐 Open ${filename} in geojson.io to visualize the trails`);
    console.log(`\n🎨 Color coding:`);
    console.log(`  - 🔴 Red lines: Fixed trails (the ones we connected)`);
    console.log(`  - 🟢 Green lines: Other trails`);

  } catch (error) {
    console.error('❌ Error exporting trails:', error);
  } finally {
    await client.end();
  }
}

exportTrailsGeoJSON();
