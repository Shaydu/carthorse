#!/usr/bin/env node
/**
 * Lookup Holly Berry Trail in public.trails table
 */

const { Client } = require('pg');

async function lookupHollyBerryTrail() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Search for Holly Berry Trail (case insensitive)
    const result = await client.query(`
      SELECT 
        id,
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
        source,
        region,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        created_at,
        updated_at
      FROM public.trails 
      WHERE name ILIKE '%holly berry%'
      ORDER BY name
    `);

    console.log(`\n🔍 Found ${result.rows.length} trail(s) matching "Holly Berry":`);
    
    if (result.rows.length === 0) {
      console.log('❌ No trails found with "Holly Berry" in the name');
      
      // Let's also search for partial matches
      const partialResult = await client.query(`
        SELECT 
          id,
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
          source,
          region,
          created_at
        FROM public.trails 
        WHERE name ILIKE '%holly%' OR name ILIKE '%berry%'
        ORDER BY name
        LIMIT 10
      `);
      
      if (partialResult.rows.length > 0) {
        console.log(`\n🔍 Found ${partialResult.rows.length} trail(s) with "holly" or "berry" in the name:`);
        partialResult.rows.forEach((trail, index) => {
          console.log(`\n  ${index + 1}. ${trail.name}`);
          console.log(`     ID: ${trail.id}`);
          console.log(`     UUID: ${trail.app_uuid}`);
          console.log(`     Type: ${trail.trail_type || 'N/A'}`);
          console.log(`     Surface: ${trail.surface || 'N/A'}`);
          console.log(`     Difficulty: ${trail.difficulty || 'N/A'}`);
          console.log(`     Length: ${trail.length_km ? `${trail.length_km.toFixed(2)} km` : 'N/A'}`);
          console.log(`     Elevation Gain: ${trail.elevation_gain ? `${trail.elevation_gain.toFixed(0)} m` : 'N/A'}`);
          console.log(`     Region: ${trail.region || 'N/A'}`);
          console.log(`     Source: ${trail.source || 'N/A'}`);
        });
      }
    } else {
      result.rows.forEach((trail, index) => {
        console.log(`\n  ${index + 1}. ${trail.name}`);
        console.log(`     ID: ${trail.id}`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Type: ${trail.trail_type || 'N/A'}`);
        console.log(`     Surface: ${trail.surface || 'N/A'}`);
        console.log(`     Difficulty: ${trail.difficulty || 'N/A'}`);
        console.log(`     Length: ${trail.length_km ? `${trail.length_km.toFixed(2)} km` : 'N/A'}`);
        console.log(`     Elevation Gain: ${trail.elevation_gain ? `${trail.elevation_gain.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Elevation Loss: ${trail.elevation_loss ? `${trail.elevation_loss.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Max Elevation: ${trail.max_elevation ? `${trail.max_elevation.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Min Elevation: ${trail.min_elevation ? `${trail.min_elevation.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Avg Elevation: ${trail.avg_elevation ? `${trail.avg_elevation.toFixed(0)} m` : 'N/A'}`);
        console.log(`     Region: ${trail.region || 'N/A'}`);
        console.log(`     Source: ${trail.source || 'N/A'}`);
        console.log(`     Bbox: [${trail.bbox_min_lng?.toFixed(4) || 'N/A'}, ${trail.bbox_min_lat?.toFixed(4) || 'N/A'}, ${trail.bbox_max_lng?.toFixed(4) || 'N/A'}, ${trail.bbox_max_lat?.toFixed(4) || 'N/A'}]`);
        console.log(`     Created: ${trail.created_at}`);
        console.log(`     Updated: ${trail.updated_at}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

lookupHollyBerryTrail();
