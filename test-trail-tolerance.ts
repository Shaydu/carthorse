#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function testTrailTolerance() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-trail-tolerance.ts <schema>');
    process.exit(1);
  }

  console.log(`🧪 Testing trail tolerance for schema: ${schema}`);

  // Test coordinates from the trail geometry
  const testPoints = [
    [-105.294825, 39.99024], // Start
    [-105.295074, 39.990002], // Middle
    [-105.289335, 39.99177]   // End
  ];

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('✅ Connected to database');

    for (const [lng, lat] of testPoints) {
      console.log(`\n🔍 Testing point: ${lng}, ${lat}`);

      // Test different tolerances
      const tolerances = [0.0001, 0.0005, 0.001, 0.005]; // ~10m, ~50m, ~100m, ~500m

      for (const tolerance of tolerances) {
        const query = `
          SELECT 
            id,
            node_uuid,
            lat,
            lng,
            elevation,
            node_type,
            connected_trails,
            ST_Distance(
              ST_SetSRID(ST_MakePoint(lng, lat), 4326),
              ST_SetSRID(ST_MakePoint($1, $2), 4326)
            ) * 111320 as distance_meters
          FROM ${schema}.routing_nodes 
          WHERE ST_DWithin(
            ST_SetSRID(ST_MakePoint(lng, lat), 4326),
            ST_SetSRID(ST_MakePoint($1, $2), 4326),
            $3
          )
          ORDER BY distance_meters
          LIMIT 3;
        `;

        const result = await pool.query(query, [lng, lat, tolerance]);
        
        console.log(`   Tolerance ${tolerance} (~${(tolerance * 111320).toFixed(0)}m): ${result.rows.length} nodes`);
        
        if (result.rows.length > 0) {
          result.rows.forEach(node => {
            console.log(`     • Node ${node.id}: ${node.distance_meters.toFixed(2)}m away, type: ${node.node_type}, trails: ${node.connected_trails}`);
          });
        }
      }
    }

    // Test the specific point we added earlier
    console.log(`\n🎯 Testing our Y intersection point: -105.295095, 39.990015`);
    const yIntersectionQuery = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(lng, lat), 4326),
          ST_SetSRID(ST_MakePoint(-105.295095, 39.990015), 4326)
        ) * 111320 as distance_meters
      FROM ${schema}.routing_nodes 
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326),
        ST_SetSRID(ST_MakePoint(-105.295095, 39.990015), 4326),
        0.0001
      )
      ORDER BY distance_meters;
    `;

    const yResult = await pool.query(yIntersectionQuery);
    console.log(`   Found ${yResult.rows.length} nodes near our Y intersection point`);
    
    if (yResult.rows.length > 0) {
      yResult.rows.forEach(node => {
        console.log(`     • Node ${node.id}: ${node.distance_meters.toFixed(2)}m away, type: ${node.node_type}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

testTrailTolerance().catch(console.error);
