#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function snapAndSplitPoint() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node snap-and-split-point.ts <schema>');
    process.exit(1);
  }

  console.log(`🎯 Snapping and splitting point for schema: ${schema}`);

  // The point to snap and split
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

    console.log(`\n📍 Target point: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);

    // Step 1: Find the nearest trail to this point
    const findNearestTrailQuery = `
      SELECT 
        id,
        name,
        trail_type,
        ST_AsText(geometry) as geom_text,
        ST_Distance(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) * 111320 as distance_meters,
        ST_ClosestPoint(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) as closest_point
      FROM ${schema}.trails 
      ORDER BY ST_Distance(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      )
      LIMIT 1;
    `;

    const nearestTrailResult = await pool.query(findNearestTrailQuery, [targetPoint.lng, targetPoint.lat]);

    if (nearestTrailResult.rows.length === 0) {
      console.log('❌ No trails found');
      return;
    }

    const nearestTrail = nearestTrailResult.rows[0];
    console.log(`\n🛤️  Nearest trail:`);
    console.log(`   Trail ID: ${nearestTrail.id}`);
    console.log(`   Name: ${nearestTrail.name || 'Unnamed'}`);
    console.log(`   Type: ${nearestTrail.trail_type || 'Unknown'}`);
    console.log(`   Distance: ${nearestTrail.distance_meters.toFixed(2)} meters`);

    // Step 2: Find the closest point on the trail
    const closestPointQuery = `
      SELECT 
        ST_X(closest_point) as lng,
        ST_Y(closest_point) as lat,
        ST_Z(closest_point) as elevation
      FROM (
        SELECT ST_ClosestPoint(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) as closest_point
        FROM ${schema}.trails 
        WHERE id = $3
      ) as cp;
    `;

    const closestPointResult = await pool.query(closestPointQuery, [targetPoint.lng, targetPoint.lat, nearestTrail.id]);
    const closestPoint = closestPointResult.rows[0];

    console.log(`\n📍 Closest point on trail:`);
    console.log(`   Coordinates: ${closestPoint.lng}, ${closestPoint.lat}, ${closestPoint.elevation}`);

    // Step 3: Find existing nodes near this closest point
    const findNearbyNodesQuery = `
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
        0.0001  -- ~10 meters
      )
      ORDER BY distance_meters;
    `;

    const nearbyNodesResult = await pool.query(findNearbyNodesQuery, [closestPoint.lng, closestPoint.lat]);

    console.log(`\n🎯 Nodes near closest point on trail:`);
    console.log(`   Found ${nearbyNodesResult.rows.length} nodes within 10 meters`);

    if (nearbyNodesResult.rows.length > 0) {
      // Use the closest existing node
      const targetNode = nearbyNodesResult.rows[0];
      console.log(`\n   Using closest node:`);
      console.log(`   Node ID: ${targetNode.id}`);
      console.log(`   Node UUID: ${targetNode.node_uuid}`);
      console.log(`   Coordinates: ${targetNode.lng}, ${targetNode.lat}, ${targetNode.elevation}`);
      console.log(`   Distance from closest point: ${targetNode.distance_meters.toFixed(2)} meters`);
      console.log(`   Current type: ${targetNode.node_type}`);
      console.log(`   Connected trails: ${targetNode.connected_trails}`);

      // Step 4: Mark this node for degree-3 intersection (split Y/T)
      const updatePredictionQuery = `
        INSERT INTO ${schema}.graphsage_predictions (node_id, prediction, confidence)
        VALUES ($1, 2, 1.0)
        ON CONFLICT (node_id) DO UPDATE SET
          prediction = 2,
          confidence = 1.0;
      `;

      await pool.query(updatePredictionQuery, [targetNode.id]);

      // Update node type to indicate it should be a degree-3 intersection
      const updateNodeTypeQuery = `
        UPDATE ${schema}.routing_nodes 
        SET node_type = 'degree3_intersection'
        WHERE id = $1;
      `;

      await pool.query(updateNodeTypeQuery, [targetNode.id]);

      console.log(`\n✅ Successfully marked node for snap and split:`);
      console.log(`   • Node ${targetNode.id} will be snapped to trail intersection`);
      console.log(`   • Prediction: Split Y/T (label 2) with confidence 1.0`);
      console.log(`   • Node type: degree3_intersection`);
      console.log(`   • This will create a degree-3 intersection where the point meets the trail`);

    } else {
      console.log(`\n⚠️  No existing nodes found near the closest point on the trail`);
      console.log(`   The snap and split operation would need to create a new node`);
      console.log(`   Closest point: ${closestPoint.lng}, ${closestPoint.lat}, ${closestPoint.elevation}`);
    }

    console.log(`\n🎯 Summary:`);
    console.log(`   • Original point: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);
    console.log(`   • Nearest trail: ${nearestTrail.distance_meters.toFixed(2)}m away`);
    console.log(`   • Closest point on trail: ${closestPoint.lng}, ${closestPoint.lat}, ${closestPoint.elevation}`);
    console.log(`   • Snap and split operation: Create degree-3 intersection`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

snapAndSplitPoint().catch(console.error);
