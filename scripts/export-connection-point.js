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

async function exportConnectionPoint() {
  try {
    await client.connect();
    console.log('📦 Exporting connection point area...');

    // Get the specific trails and nearby trails
    const trailsResult = await client.query(`
      WITH connection_point AS (
        SELECT ST_SetSRID(ST_MakePoint(-105.2845093, 39.9796464), 4326) as point
      ),
      nearby_trails AS (
        SELECT 
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_AsGeoJSON(geometry, 6, 0) as geojson,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point,
          ST_Distance(geometry::geography, cp.point::geography) as distance_to_connection
        FROM ${STAGING_SCHEMA}.trails t, connection_point cp
        WHERE ST_DWithin(geometry::geography, cp.point::geography, 100)  -- Within 100m
        ORDER BY distance_to_connection
      )
      SELECT * FROM nearby_trails
    `);

    console.log(`📊 Found ${trailsResult.rows.length} trails near connection point`);

    // Create GeoJSON features
    const features = trailsResult.rows.map(trail => {
      let geometry;
      try {
        geometry = JSON.parse(trail.geojson);
      } catch (e) {
        console.warn(`⚠️ Invalid GeoJSON for trail ${trail.app_uuid}: ${trail.geojson}`);
        return null;
      }

      const isFixedTrail = trail.app_uuid === '6357ecb0-b5b6-4aa8-ba49-27bf6106595b' || 
                          trail.app_uuid === 'd8ec6e2b-dfd5-49f4-baf7-10c55a6a4377';

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
          start_point: trail.start_point,
          end_point: trail.end_point,
          distance_to_connection: trail.distance_to_connection,
          is_fixed_trail: isFixedTrail,
          // Styling for visualization
          color: isFixedTrail ? '#ff0000' : '#00ff00',
          weight: isFixedTrail ? 4 : 2,
          opacity: isFixedTrail ? 1.0 : 0.7
        },
        geometry: geometry
      };
    }).filter(feature => feature !== null);

    // Add the connection point as a marker
    features.push({
      type: 'Feature',
      properties: {
        name: 'Connection Point',
        description: 'Where the two Mesa Trail segments now meet',
        color: '#0000ff',
        size: 8,
        marker: true
      },
      geometry: {
        type: 'Point',
        coordinates: [-105.2845093, 39.9796464, 1898.367]
      }
    });

    // Create GeoJSON collection
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };

    // Write to file
    const filename = 'test-output/connection-point-area.geojson';
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));

    console.log(`✅ Exported to ${filename}`);
    console.log(`📊 Summary:`);
    console.log(`  - Total trails: ${features.length - 1}`); // -1 for the marker
    
    // Show the fixed trails specifically
    const fixedTrails = features.filter(f => f.properties.is_fixed_trail);
    console.log(`  - Fixed trails: ${fixedTrails.length}`);
    
    fixedTrails.forEach(trail => {
      console.log(`    🎯 ${trail.properties.name} (${trail.properties.trail_id})`);
      console.log(`       Length: ${trail.properties.length_km.toFixed(3)}km`);
      console.log(`       Distance to connection: ${trail.properties.distance_to_connection.toFixed(2)}m`);
      console.log(`       Start: ${trail.properties.start_point}`);
      console.log(`       End: ${trail.properties.end_point}`);
    });

    console.log(`\n🌐 Open ${filename} in geojson.io to visualize the connection`);
    console.log(`\n🎨 Color coding:`);
    console.log(`  - 🔴 Red lines: Fixed trails (connected at the blue marker)`);
    console.log(`  - 🟢 Green lines: Other nearby trails`);
    console.log(`  - 🔵 Blue marker: Connection point where trails now meet`);

  } catch (error) {
    console.error('❌ Error exporting connection point:', error);
  } finally {
    await client.end();
  }
}

exportConnectionPoint();
