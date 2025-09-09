#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function verifySplitResults() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node verify-split-results.ts <schema>');
    process.exit(1);
  }

  console.log(`🔍 Verifying split results for schema: ${schema}`);

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

    // Check the intersection node we created
    console.log(`\n🎯 Checking intersection node at target point:`);
    const nodeQuery = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails
      FROM ${schema}.routing_nodes 
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326),
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        0.0001  -- ~10 meters
      )
      ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326),
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      );
    `;

    const nodeResult = await pool.query(nodeQuery, [targetPoint.lng, targetPoint.lat]);
    
    if (nodeResult.rows.length > 0) {
      const node = nodeResult.rows[0];
      console.log(`   Node ${node.id}: ${node.lng}, ${node.lat}, ${node.elevation}`);
      console.log(`   Type: ${node.node_type}, Connected trails: ${node.connected_trails}`);
    } else {
      console.log(`   ❌ No intersection node found at target point`);
    }

    // Check for any trails that might be near our target point
    console.log(`\n🛤️  Checking for trails near target point:`);
    const trailsQuery = `
      SELECT 
        id,
        name,
        app_uuid,
        original_trail_uuid,
        ST_Distance(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) * 111320 as distance_meters,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${schema}.trails 
      WHERE ST_DWithin(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        0.001  -- ~100 meters
      )
      ORDER BY ST_Distance(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      );
    `;

    const trailsResult = await pool.query(trailsQuery, [targetPoint.lng, targetPoint.lat]);
    
    console.log(`   Found ${trailsResult.rows.length} trails within 100 meters:`);
    trailsResult.rows.forEach((trail, index) => {
      console.log(`\n   ${index + 1}. "${trail.name || 'Unnamed'}" (ID: ${trail.id})`);
      console.log(`      Distance: ${trail.distance_meters.toFixed(2)}m`);
      console.log(`      Length: ${trail.length_meters.toFixed(2)}m`);
      console.log(`      UUID: ${trail.app_uuid}`);
      if (trail.original_trail_uuid) {
        console.log(`      Original UUID: ${trail.original_trail_uuid}`);
      }
      console.log(`      Start: ${trail.start_point}`);
      console.log(`      End: ${trail.end_point}`);
    });

    // Check if any of these trails have endpoints very close to our target point
    console.log(`\n📍 Checking for trails with endpoints at target point:`);
    const endpointQuery = `
      SELECT 
        id,
        name,
        ST_Distance(ST_StartPoint(geometry), ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111320 as distance_to_start,
        ST_Distance(ST_EndPoint(geometry), ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111320 as distance_to_end,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${schema}.trails 
      WHERE ST_Distance(ST_StartPoint(geometry), ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111320 < 10
         OR ST_Distance(ST_EndPoint(geometry), ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111320 < 10
      ORDER BY LEAST(
        ST_Distance(ST_StartPoint(geometry), ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111320,
        ST_Distance(ST_EndPoint(geometry), ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111320
      );
    `;

    const endpointResult = await pool.query(endpointQuery, [targetPoint.lng, targetPoint.lat]);
    
    if (endpointResult.rows.length > 0) {
      console.log(`   Found ${endpointResult.rows.length} trails with endpoints near target point:`);
      endpointResult.rows.forEach((trail, index) => {
        console.log(`\n   ${index + 1}. "${trail.name || 'Unnamed'}" (ID: ${trail.id})`);
        console.log(`      Distance to start: ${trail.distance_to_start.toFixed(2)}m`);
        console.log(`      Distance to end: ${trail.distance_to_end.toFixed(2)}m`);
        console.log(`      Start: ${trail.start_point}`);
        console.log(`      End: ${trail.end_point}`);
      });
    } else {
      console.log(`   ❌ No trails found with endpoints near target point`);
    }

    // Summary
    console.log(`\n📊 Summary:`);
    console.log(`   Target point: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);
    console.log(`   Intersection node: ${nodeResult.rows.length > 0 ? 'Found' : 'Not found'}`);
    console.log(`   Nearby trails: ${trailsResult.rows.length}`);
    console.log(`   Trails with endpoints at target: ${endpointResult.rows.length}`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

verifySplitResults().catch(console.error);
