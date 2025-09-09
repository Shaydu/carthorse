#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function addYIntersectionPoint() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node add-y-intersection-point.ts <schema>');
    process.exit(1);
  }

  console.log(`🎯 Adding Y intersection point for schema: ${schema}`);

  // The point you want to add as a Y intersection
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

    // First, find the nearest existing node
    const findNearestNodeQuery = `
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
      ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326),
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      )
      LIMIT 1;
    `;

    const nearestNodeResult = await pool.query(findNearestNodeQuery, [targetPoint.lng, targetPoint.lat]);
    
    if (nearestNodeResult.rows.length === 0) {
      console.log('❌ No nodes found in routing_nodes table');
      return;
    }

    const nearestNode = nearestNodeResult.rows[0];
    console.log(`\n📍 Target point: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);
    console.log(`\n🎯 Nearest existing node:`);
    console.log(`   Node ID: ${nearestNode.id}`);
    console.log(`   Node UUID: ${nearestNode.node_uuid}`);
    console.log(`   Coordinates: ${nearestNode.lng}, ${nearestNode.lat}, ${nearestNode.elevation}`);
    console.log(`   Distance: ${nearestNode.distance_meters.toFixed(2)} meters`);
    console.log(`   Current type: ${nearestNode.node_type}`);
    console.log(`   Connected trails: ${nearestNode.connected_trails}`);

    // Check if this node already has a prediction using coordinates
    const existingPredictionQuery = `
      SELECT gp.prediction, gp.confidence 
      FROM ${schema}.graphsage_predictions gp
      JOIN ${schema}.routing_nodes rn ON gp.node_id = rn.id
      WHERE rn.lat = $1 AND rn.lng = $2;
    `;

    const existingPrediction = await pool.query(existingPredictionQuery, [nearestNode.lat, nearestNode.lng]);

    if (existingPrediction.rows.length > 0) {
      const currentPrediction = existingPrediction.rows[0];
      console.log(`\n📊 Current prediction: ${currentPrediction.prediction} (confidence: ${currentPrediction.confidence})`);
      
      // Update the prediction to Y intersection (label 2) with high confidence using coordinates
      const updateQuery = `
        UPDATE ${schema}.graphsage_predictions 
        SET prediction = 2, confidence = 1.0
        WHERE node_id = (
          SELECT id FROM ${schema}.routing_nodes 
          WHERE lat = $1 AND lng = $2
        );
      `;
      
      await pool.query(updateQuery, [nearestNode.lat, nearestNode.lng]);
      console.log(`✅ Updated prediction to Y intersection (label 2) with confidence 1.0`);
    } else {
      // Insert new prediction using coordinates
      const insertQuery = `
        INSERT INTO ${schema}.graphsage_predictions (node_id, prediction, confidence)
        SELECT id, 2, 1.0
        FROM ${schema}.routing_nodes 
        WHERE lat = $1 AND lng = $2;
      `;
      
      await pool.query(insertQuery, [nearestNode.lat, nearestNode.lng]);
      console.log(`✅ Added new prediction: Y intersection (label 2) with confidence 1.0`);
    }

    // Also update the node type to indicate it should be a Y intersection using coordinates
    const updateNodeTypeQuery = `
      UPDATE ${schema}.routing_nodes 
      SET node_type = 'y_intersection'
      WHERE lat = $1 AND lng = $2;
    `;
    
    await pool.query(updateNodeTypeQuery, [nearestNode.lat, nearestNode.lng]);
    console.log(`✅ Updated node type to 'y_intersection'`);

    console.log(`\n🎯 Summary:`);
    console.log(`   • Point ${targetPoint.lng}, ${targetPoint.lat} is ${nearestNode.distance_meters.toFixed(2)}m from nearest node`);
    console.log(`   • Node at ${nearestNode.lng}, ${nearestNode.lat} marked for Y intersection split`);
    console.log(`   • Prediction: Split Y/T (label 2) with confidence 1.0`);
    console.log(`   • Node type: y_intersection`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

addYIntersectionPoint().catch(console.error);
