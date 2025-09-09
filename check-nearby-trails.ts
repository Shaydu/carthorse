#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function checkNearbyTrails() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node check-nearby-trails.ts <schema>');
    process.exit(1);
  }

  console.log(`🔍 Checking nearby trails for schema: ${schema}`);

  const targetPoint = {
    lng: -105.295095,
    lat: 39.990015,
    elevation: 2176.841796875
  };

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('✅ Connected to database');

    // Find all trails within 50 meters of the point
    const query = `
      SELECT 
        id,
        app_uuid,
        name,
        trail_type,
        ST_Distance(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) * 111320 as distance_meters,
        ST_AsText(ST_ClosestPoint(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))) as closest_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE ST_DWithin(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        0.0005  -- ~50 meters
      )
      ORDER BY ST_Distance(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      );
    `;

    const result = await pool.query(query, [targetPoint.lng, targetPoint.lat]);

    console.log(`\n📍 Target point: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);
    console.log(`\n🛤️  Found ${result.rows.length} trails within 50 meters:`);

    result.rows.forEach((trail, index) => {
      console.log(`\n   ${index + 1}. "${trail.name || 'Unnamed'}" (${trail.trail_type || 'Unknown type'})`);
      console.log(`      ID: ${trail.id}, UUID: ${trail.app_uuid}`);
      console.log(`      Distance: ${trail.distance_meters.toFixed(2)} meters`);
      console.log(`      Length: ${trail.length_meters.toFixed(2)} meters`);
      console.log(`      Closest point: ${trail.closest_point}`);
    });

    // Check if any trail contains "Flatiron" in the name
    const flatironTrails = result.rows.filter(trail => 
      trail.name && trail.name.toLowerCase().includes('flatiron')
    );

    if (flatironTrails.length > 0) {
      console.log(`\n🏔️  Flatiron trails found:`);
      flatironTrails.forEach((trail, index) => {
        console.log(`   ${index + 1}. "${trail.name}" - ${trail.distance_meters.toFixed(2)}m away`);
      });
    } else {
      console.log(`\n⚠️  No trails with "Flatiron" in the name found nearby`);
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

checkNearbyTrails().catch(console.error);
